import type { WorldBuilderAgentStep, WorldBuilderConfig } from '@/lib/shared/types';

type MutableStep = WorldBuilderAgentStep & Record<string, unknown>;

const JSON_ONLY_SYSTEM = [
  'You are a REVERIE autonomous world agent.',
  'Return only compact valid JSON with no markdown.',
  'Include status, confidence, summary, stateEffect, and nextAction keys when applicable.',
].join(' ');

const CONCISE_SYSTEM = [
  'You are a REVERIE autonomous world agent.',
  'Return a concise operational result that the next workflow step can consume.',
  'Do not include markdown unless the prompt explicitly asks for narrative text.',
].join(' ');

function keyFor(step: MutableStep) {
  return `${step.id ?? ''} ${step.agentId ?? ''} ${step.name ?? ''} ${step.purpose ?? ''} ${String(step.sourceTemplateAgentId ?? '')}`.toLowerCase();
}

function has(key: string, ...needles: string[]) {
  return needles.some((needle) => key.includes(needle.toLowerCase()));
}

function sharedContextTemplate() {
  return [
    'Runtime inputs: {{runtime.inputs}}',
    'Trigger payload: {{trigger.payload}}',
    'Source value: {{source.value}}',
    'Cargo route plan: {{dataSources.routePlan.body.routePlan}}',
    'Cargo progress projection: {{dataSources.routeProgress.body.progress}}',
    'Cargo weather sample: {{dataSources.weatherSample.body}}',
    'Previous step result: {{previous.output}}',
  ].join('\n');
}

function strictLlmPrompt(step: MutableStep, domainInstruction: string) {
  const original = typeof step.inputTemplate === 'string' ? step.inputTemplate : '';
  return [
    `Task: ${domainInstruction}`,
    original ? `Configured instruction: ${original}` : '',
    'Use resolved runtime inputs, source data, and previous step result only.',
    'Return JSON only with this shape: {"status":"ok|warning|stop","decision":"...","confidence":0-1,"summary":"...","stateEffect":{"target":"zone|faction|world_state|event","value":"..."},"nextAction":"continue|reroute|stop|settle|record"}.',
  ].filter(Boolean).join('\n');
}

function jsonDefaults(step: MutableStep, slug: string) {
  const key = keyFor(step);
  if (has(key, 'weather-sampler', 'weather sampler')) {
    return {
      urlTemplate: 'https://api.open-meteo.com/v1/forecast?latitude={{dataSources.routeProgress.body.progress.projectedPosition.latitude}}&longitude={{dataSources.routeProgress.body.progress.projectedPosition.longitude}}&current=temperature_2m,wind_speed_10m,precipitation,weather_code',
      selector: 'current',
      resultAlias: 'projectedWeather',
    };
  }
  if (has(key, 'weather-reader', 'weather reader')) {
    return {
      urlTemplate: 'https://api.open-meteo.com/v1/forecast?latitude=51.5072&longitude=-0.1276&current=temperature_2m,wind_speed_10m,precipitation,weather_code',
      selector: 'current.weather_code',
      resultAlias: 'regionalWeatherCode',
    };
  }
  if (has(key, 'market-data-reader', 'market data reader')) {
    return {
      urlTemplate: 'https://api.binance.com/api/v3/ticker/24hr?symbol={{runtime.inputs.marketPair}}',
      selector: 'lastPrice',
      resultAlias: 'marketLastPrice',
    };
  }
  if (has(key, 'match-data-reader', 'match data reader')) {
    return {
      urlTemplate: '/api/demo/sports-prediction/matches?matchId={{runtime.inputs.matchId}}',
      selector: 'match.status',
      resultAlias: 'matchStatus',
    };
  }
  if (has(key, 'world-feed-reader', 'world feed reader')) {
    return {
      urlTemplate: 'https://api.open-meteo.com/v1/forecast?latitude=54.5973&longitude=-5.9301&current=temperature_2m,wind_speed_10m,precipitation,weather_code',
      selector: 'current.weather_code',
      resultAlias: 'kingdomWeatherCode',
    };
  }
  return {
    urlTemplate: slug === 'sports-prediction-league'
      ? '/api/demo/sports-prediction/matches?matchId={{runtime.inputs.matchId}}'
      : 'https://api.open-meteo.com/v1/forecast?latitude=6.5244&longitude=3.3792&current=weather_code',
    selector: slug === 'sports-prediction-league' ? 'match.status' : 'current.weather_code',
    resultAlias: `${String(step.id ?? 'json')}Result`,
  };
}

function enrichJsonStep(step: MutableStep, slug: string) {
  const defaults = jsonDefaults(step, slug);
  const forceCargoWeather = slug === 'cargo-climate-guard' && has(keyFor(step), 'weather-sampler', 'weather sampler');
  step.urlTemplate = !forceCargoWeather && typeof step.urlTemplate === 'string' && step.urlTemplate.trim() ? step.urlTemplate : defaults.urlTemplate;
  step.selector = !forceCargoWeather && typeof step.selector === 'string' && step.selector.trim() ? step.selector : defaults.selector;
  step.resultAlias = typeof step.resultAlias === 'string' && step.resultAlias.trim() ? step.resultAlias : defaults.resultAlias;
  const current = typeof step.inputTemplate === 'string' ? step.inputTemplate : '';
  if (forceCargoWeather || !current || current.startsWith('Fetch ') || current.toLowerCase().includes('fetch temperature') || current.toLowerCase().includes('inspect')) {
    step.inputTemplate = `Fetch ${step.resultAlias} from ${step.urlTemplate} using selector "${step.selector}". Previous step result is context only: {{previous.output}}.`;
  }
}

function enrichLlmStep(step: MutableStep, slug: string) {
  const key = keyFor(step);
  const instructions: Array<[string[], string]> = [
    [['port-resolver', 'port resolver', 'route-planner', 'route planner'], 'Choose the best cargo route and alternatives from the bundled cargo-routes-v1 graph. Return JSON with decision, activeRouteId, route legs, fallback route IDs, summary, and nextAction.'],
    [['position-projector', 'position projector'], 'Project where the cargo will be in 2 hours from the selected route, current position, speed, segment distance, and next stop. Return JSON with currentPosition, projectedPosition, currentSegment, nextStopId, etaHours, arrivalProgress, and nextCheckAt.'],
    [['maritime-risk', 'maritime risk', 'weather-risk', 'weather risk'], 'Score whether the projected route segment is safe, risky, blocked, or arrived using route context and live weather JSON. Return JSON with decision, confidence, summary, weather, stateEffect, and nextAction.'],
    [['reroute-arbiter', 'reroute arbiter', 'route-decision', 'route decision'], 'Choose continue, reroute, wait_next_day, arrived, or stop from accumulated route, position, weather, and attempted route evidence. Return JSON with decision, activeRouteId, currentPosition, nextStopId, attemptedRouteIds, nextCheckAt, summary, and stateEffects.'],
    [['stakeholder-impact', 'stakeholder impact'], 'Map the cargo route decision into concise Safety Authority, Carrier Operations, Cargo Owner, and Port Network morale/state deltas.'],
    [['severity-assessor', 'severity assessment'], 'Classify climate crisis severity and produce a region update recommendation.'],
    [['agency-readiness', 'agency readiness'], 'Map climate severity into government, NGO, private sector, and insurance readiness deltas.'],
    [['market-risk-analyst', 'market risk'], 'Classify market climate and recommend HOLD, REDUCE, ACCUMULATE, or WATCH.'],
    [['strategy-morale', 'strategy morale'], 'Map the market signal into Bull, Bear, and Hedge faction confidence deltas.'],
    [['prediction-locker', 'prediction lock'], 'Create or evaluate a timestamped sports prediction from match status and user prediction.'],
    [['settlement-analyst', 'settlement analyst'], 'Compare the locked prediction against the final score and classify accuracy.'],
    [['team-morale', 'team morale'], 'Update team and prediction faction morale after the result settlement.'],
    [['kingdom-event-synthesizer', 'kingdom event'], 'Turn real-world signals or player input into one concise fantasy world event.'],
    [['faction-morale', 'faction morale'], 'Recalculate faction morale from the latest world event and existing faction context.'],
  ];
  const instruction = instructions.find(([needles]) => has(key, ...needles))?.[1] ?? `Execute the ${step.name ?? step.id} step for ${slug}.`;
  step.systemPrompt = typeof step.systemPrompt === 'string' && step.systemPrompt.trim() ? step.systemPrompt : JSON_ONLY_SYSTEM;
  step.contextTemplate = typeof step.contextTemplate === 'string' && step.contextTemplate.trim() ? step.contextTemplate : sharedContextTemplate();
  step.resultAlias = typeof step.resultAlias === 'string' && step.resultAlias.trim() ? step.resultAlias : `${String(step.id ?? slug)}Decision`;
  const current = typeof step.inputTemplate === 'string' ? step.inputTemplate : '';
  if (slug === 'cargo-climate-guard' || !current.startsWith('Task:')) step.inputTemplate = strictLlmPrompt(step, instruction);
}

function enrichCustomStep(step: MutableStep, slug: string) {
  const key = keyFor(step);
  const isChronicle = has(key, 'chronicle');
  step.systemPrompt = typeof step.systemPrompt === 'string' && step.systemPrompt.trim()
    ? step.systemPrompt
    : isChronicle
      ? 'You are the REVERIE Chronicle writer. Return one concise receipt-backed world history entry.'
      : CONCISE_SYSTEM;
  step.contextTemplate = typeof step.contextTemplate === 'string' && step.contextTemplate.trim() ? step.contextTemplate : sharedContextTemplate();
  step.resultAlias = typeof step.resultAlias === 'string' && step.resultAlias.trim() ? step.resultAlias : `${String(step.id ?? slug)}Result`;
  if (isChronicle && !(typeof step.inputTemplate === 'string' && step.inputTemplate.startsWith('Write a concise Chronicle entry'))) {
    step.inputTemplate = [
      'Write a concise Chronicle entry from the accumulated workflow context.',
      'Include the decision, affected zone/faction/world state, and proof-friendly summary.',
      'Previous step result: {{previous.output}}',
    ].join('\n');
  }
}

export function applyLiveAgentStepDefaults(step: WorldBuilderAgentStep, slug = 'custom'): WorldBuilderAgentStep {
  const next = { ...step } as MutableStep;
  if (next.agentType === 'native_json_api') enrichJsonStep(next, slug);
  else if (next.agentType === 'native_llm') enrichLlmStep(next, slug);
  else enrichCustomStep(next, slug);
  return next as WorldBuilderAgentStep;
}

export function applyLiveBuilderAgentDefaults(builder: WorldBuilderConfig, slug = builder.uiSlug || 'custom'): WorldBuilderConfig {
  if (slug === 'cargo-climate-guard' || builder.uiSlug === 'cargo-climate-guard') {
    return applyCargoAutonomyDefaults(builder, slug);
  }
  return {
    ...builder,
    agentChain: (builder.agentChain ?? []).map((step) => applyLiveAgentStepDefaults(step, slug)),
  };
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function cargoStep(id: string, name: string, purpose: string): WorldBuilderAgentStep {
  return {
    id,
    name,
    agentType: 'native_llm',
    agentId: id,
    purpose,
    inputTemplate: purpose,
    contextTemplate: sharedContextTemplate(),
    resultAlias: `${id.replace(/-/g, '')}Result`,
    persistResult: true,
  };
}

function cargoChainIds(existing: WorldBuilderConfig): string[] {
  const ids = new Set((existing.agentChain ?? []).map((step) => step.id));
  const routePlanner = ids.has('route-planner') ? 'route-planner' : 'port-resolver';
  const weatherRisk = ids.has('weather-risk') ? 'weather-risk' : 'maritime-risk';
  const routeDecision = ids.has('route-decision') ? 'route-decision' : 'reroute-arbiter';
  const chronicle = ids.has('chronicle-state') ? 'chronicle-state' : 'chronicle';
  return [
    routePlanner,
    'position-projector',
    'weather-sampler',
    weatherRisk,
    routeDecision,
    'stakeholder-impact',
    chronicle,
  ].filter((id) => id === 'position-projector' || ids.has(id));
}

function applyCargoAutonomyDefaults(builder: WorldBuilderConfig, slug: string): WorldBuilderConfig {
  const routePlanUrl = '/api/demo/cargo-climate/route-plan?startPortId={{runtime.inputs.startPortId}}&destinationPortId={{runtime.inputs.destinationPortId}}&speedKnots={{runtime.inputs.speedKnots}}&alternatives=true';
  const routeProgressUrl = '/api/demo/cargo-climate/progress?startPortId={{runtime.inputs.startPortId}}&destinationPortId={{runtime.inputs.destinationPortId}}&speedKnots={{runtime.inputs.speedKnots}}&hours=2';
  const weatherSampleUrl = '/api/demo/cargo-climate/weather-sample?lat={{dataSources.routeProgress.body.progress.projectedPosition.latitude}}&lon={{dataSources.routeProgress.body.progress.projectedPosition.longitude}}&hourOffset=2';
  const baseSteps = (builder.agentChain ?? []).map((step) => applyLiveAgentStepDefaults(step, slug));
  const steps = uniqueById([
    ...baseSteps,
    cargoStep(
      'position-projector',
      'Position Projector Agent',
      'Project the cargo position two hours ahead from the selected route, speed, segment distance, and current voyage state.',
    ),
  ]).map((step) => applyLiveAgentStepDefaults(step, slug));
  const chain = cargoChainIds({ ...builder, agentChain: steps });
  const hasManualStart = (builder.triggers ?? []).some((trigger) => trigger.id === 'manual-start-route');

  return {
    ...builder,
    dataSources: uniqueById([
      ...(builder.dataSources ?? []).filter((source) => !['routePlan', 'routeProgress', 'weatherSample'].includes(source.id)),
      { id: 'routePlan', name: 'Cargo route plan', type: 'route_plan', url: routePlanUrl, method: 'GET' },
      { id: 'routeProgress', name: 'Two-hour cargo progress', type: 'route_progress', url: routeProgressUrl, method: 'GET' },
      { id: 'weatherSample', name: 'Projected weather sample', type: 'weather', url: weatherSampleUrl, method: 'GET' },
    ]),
    agentChain: steps,
    triggers: (builder.triggers ?? []).map((trigger) => {
      const isCargoStart = trigger.id === 'start-cargo-route' || trigger.id === 'manual-start-route';
      const isCargoManual = trigger.id === 'manual-route-check' || trigger.id === 'manual-start-route';
      const isCargoSchedule = trigger.id === 'scheduled-route-watch' || trigger.id === 'scheduled-voyage-tick';
      const isCanonicalManualStart = trigger.id === 'manual-start-route';
      const condition = {
        ...(trigger.condition ?? {}),
        ...(hasManualStart ? { isStartTrigger: isCanonicalManualStart } : {}),
      };
      if (!isCargoStart && !isCargoManual && !isCargoSchedule) {
        return hasManualStart ? {
          ...trigger,
          isStartTrigger: isCanonicalManualStart,
          condition,
        } : trigger;
      }
      const defaultPayloadTemplate = [
        '{',
        '  "voyage": {',
        '    "status": "active",',
        '    "origin": "{{runtime.inputs.startPortId}}",',
        '    "destination": "{{runtime.inputs.destinationPortId}}",',
        '    "speedKnots": "{{runtime.inputs.speedKnots}}"',
        '  },',
        '  "routePlan": {{dataSources.routePlan.body.routePlan}},',
        '  "progress": {{dataSources.routeProgress.body.progress}},',
        '  "source": {{source.value}}',
        '}',
      ].join('\n');
      return {
        ...trigger,
        type: isCanonicalManualStart ? 'manual_action' : trigger.type,
        isStartTrigger: hasManualStart ? isCanonicalManualStart : (trigger as typeof trigger & { isStartTrigger?: boolean }).isStartTrigger,
        condition,
        name: isCargoSchedule ? 'Scheduled Voyage Tick' : isCargoManual ? 'Manual Start Route' : 'Start Cargo Route Runtime',
        sourceConfig: trigger.sourceConfig ?? {
          kind: 'data_source',
          sourceId: 'routeProgress',
          path: 'body.progress',
          includeInAgentInput: true,
        },
        typeConfig: {
          ...(isCargoSchedule ? { cronExpression: '0 */2 * * *', timezone: 'UTC' as const } : {}),
          ...(trigger.typeConfig ?? {}),
          payloadTemplate: trigger.typeConfig?.payloadTemplate ?? defaultPayloadTemplate,
        },
        inputParser: trigger.inputParser ?? defaultPayloadTemplate,
        agentChain: trigger.agentChain?.length ? trigger.agentChain : isCargoSchedule ? chain.slice(1) : chain,
        outputMapping: trigger.outputMapping?.length ? trigger.outputMapping : [
          { target: 'world_state' as const, path: 'voyage.latestDecision', valueTemplate: '{{previous.output}}', priorityPercent: 100 },
          { target: 'zone' as const, targetId: 'suez-red-sea-corridor', path: 'climateState', valueTemplate: '{{previous.output}}', priorityPercent: 35 },
          { target: 'faction' as const, targetId: 'carrier-operations', path: 'narrative', valueTemplate: '{{previous.output}}', priorityPercent: 25 },
          { target: 'event' as const, targetId: 'cargo-voyage-event', path: 'chronicle', valueTemplate: '{{previous.output}}', priorityPercent: 100 },
        ],
      };
    }),
    graph: builder.graph ? {
      ...builder.graph,
      nodes: uniqueById([
        ...(builder.graph.nodes ?? []),
        { id: 'dataSource:routePlan', type: 'dataSource', refId: 'routePlan', label: 'Route Plan' },
        { id: 'dataSource:routeProgress', type: 'dataSource', refId: 'routeProgress', label: 'Route Progress' },
        { id: 'agent:position-projector', type: 'agent', refId: 'position-projector', label: 'Position Projector' },
      ]),
      edges: uniqueById([
        ...(builder.graph.edges ?? []),
        { id: 'route-plan-to-planner', source: 'dataSource:routePlan', target: 'agent:port-resolver', label: 'route context', weightPercent: 100 },
        { id: 'progress-to-position', source: 'dataSource:routeProgress', target: 'agent:position-projector', label: '2h projection', weightPercent: 100 },
        { id: 'position-to-weather', source: 'agent:position-projector', target: 'agent:weather-sampler', label: 'coordinates', weightPercent: 100 },
      ]),
    } : builder.graph,
  };
}
