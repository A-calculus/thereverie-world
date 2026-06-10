import cargoTemplate from '@/content/official-templates/cargo-climate-guard.json';
import climateTemplate from '@/content/official-templates/global-climate-crisis-response.json';
import cryptoTemplate from '@/content/official-templates/crypto-market-intelligence.v1.json';
import sportsTemplate from '@/content/official-templates/sports-prediction-league.v1.json';
import kingdomTemplate from '@/content/official-templates/living-kingdom-lite.v1.json';
import { applyLiveBuilderAgentDefaults } from '@/lib/shared/live-agent-step-defaults';
import { normalizeWithRuntimeFoundation } from '@/lib/shared/world-builder/runtime-foundation';
import type { TemplateSummary, WorldBuilderConfig } from '@/lib/shared/types';

type TemplateCategory = TemplateSummary['category'];

export type OfficialBuilderTemplate = {
  slug: string;
  name: string;
  description: string;
  category: TemplateCategory;
  officialTemplate: string;
  extraConfig?: Record<string, unknown>;
  builder: WorldBuilderConfig;
};

type MutableAgentStep = WorldBuilderConfig['agentChain'][number] & Record<string, unknown>;

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

function cloneBuilder(builder: WorldBuilderConfig): WorldBuilderConfig {
  return JSON.parse(JSON.stringify(builder)) as WorldBuilderConfig;
}

function strictLlmPrompt(step: MutableAgentStep, domainInstruction: string) {
  const original = typeof step.inputTemplate === 'string' ? step.inputTemplate : '';
  return [
    `Task: ${domainInstruction}`,
    original ? `Configured instruction: ${original}` : '',
    'Use resolved runtime inputs, source data, and previous step result only.',
    'Return JSON only with this shape: {"status":"ok|warning|stop","decision":"...","confidence":0-1,"summary":"...","stateEffect":{"target":"zone|faction|world_state|event","value":"..."},"nextAction":"continue|reroute|stop|settle|record"}.',
  ].filter(Boolean).join('\n');
}

function sharedContextTemplate() {
  return [
    'Runtime inputs: {{runtime.inputs}}',
    'Trigger payload: {{trigger.payload}}',
    'Source value: {{source.value}}',
    'Previous step result: {{previous.output}}',
  ].join('\n');
}

function enrichJsonApiStep(step: MutableAgentStep, slug: string) {
  const id = String(step.id ?? '');
  const jsonDefaults: Record<string, { urlTemplate: string; selector: string; resultAlias: string }> = {
    'weather-sampler': {
      urlTemplate: 'https://api.open-meteo.com/v1/forecast?latitude=1.29&longitude=103.85&current=temperature_2m,wind_speed_10m,precipitation,weather_code',
      selector: 'current.weather_code',
      resultAlias: 'cargoWeatherCode',
    },
    'weather-reader': {
      urlTemplate: 'https://api.open-meteo.com/v1/forecast?latitude=51.5072&longitude=-0.1276&current=temperature_2m,wind_speed_10m,precipitation,weather_code',
      selector: 'current.weather_code',
      resultAlias: 'regionalWeatherCode',
    },
    'market-data-reader': {
      urlTemplate: 'https://api.binance.com/api/v3/ticker/24hr?symbol={{runtime.inputs.marketPair}}',
      selector: 'lastPrice',
      resultAlias: 'marketLastPrice',
    },
    'match-data-reader': {
      urlTemplate: '/api/demo/sports-prediction/matches?matchId={{runtime.inputs.matchId}}',
      selector: 'match.status',
      resultAlias: 'matchStatus',
    },
    'world-feed-reader': {
      urlTemplate: 'https://api.open-meteo.com/v1/forecast?latitude=54.5973&longitude=-5.9301&current=temperature_2m,wind_speed_10m,precipitation,weather_code',
      selector: 'current.weather_code',
      resultAlias: 'kingdomWeatherCode',
    },
  };
  const fallback = {
    urlTemplate: slug === 'sports-prediction-league'
      ? '/api/demo/sports-prediction/matches?matchId={{runtime.inputs.matchId}}'
      : 'https://api.open-meteo.com/v1/forecast?latitude=6.5244&longitude=3.3792&current=weather_code',
    selector: slug === 'sports-prediction-league' ? 'match.status' : 'current.weather_code',
    resultAlias: `${id || 'json'}Result`,
  };
  const defaults = jsonDefaults[id] ?? fallback;
  step.urlTemplate = typeof step.urlTemplate === 'string' && step.urlTemplate.trim() ? step.urlTemplate : defaults.urlTemplate;
  step.selector = typeof step.selector === 'string' && step.selector.trim() ? step.selector : defaults.selector;
  step.resultAlias = typeof step.resultAlias === 'string' && step.resultAlias.trim() ? step.resultAlias : defaults.resultAlias;
  step.inputTemplate = `Fetch ${step.resultAlias} from ${step.urlTemplate} using selector "${step.selector}". Previous step result is context only: {{previous.output}}.`;
}

function enrichLlmStep(step: MutableAgentStep, slug: string) {
  const id = String(step.id ?? '');
  const instructions: Record<string, string> = {
    'port-resolver': 'Validate the selected cargo ports against the cargo-routes-v1 route graph and decide whether route validation can continue.',
    'maritime-risk': 'Score cargo route weather risk from the route context and weather JSON result.',
    'reroute-arbiter': 'Choose CONTINUE_ROUTE, REROUTE, or STOP_WORLD from the accumulated maritime risk evidence.',
    'stakeholder-impact': 'Map the route decision into concise morale and operational state deltas for the attached factions.',
    'severity-assessor': 'Classify climate crisis severity and produce a region update recommendation.',
    'agency-readiness': 'Map climate severity into government, NGO, private sector, and insurance readiness deltas.',
    'market-risk-analyst': 'Classify market climate and recommend HOLD, REDUCE, ACCUMULATE, or WATCH.',
    'strategy-morale': 'Map the market signal into Bull, Bear, and Hedge faction confidence deltas.',
    'prediction-locker': 'Create or evaluate a timestamped sports prediction from match status and user prediction.',
    'settlement-analyst': 'Compare the locked prediction against the final score and classify accuracy.',
    'team-morale': 'Update team and prediction faction morale after the result settlement.',
    'kingdom-event-synthesizer': 'Turn real-world signals or player input into one concise fantasy world event.',
    'faction-morale': 'Recalculate faction morale from the latest world event and existing faction context.',
  };
  step.systemPrompt = typeof step.systemPrompt === 'string' && step.systemPrompt.trim() ? step.systemPrompt : JSON_ONLY_SYSTEM;
  step.contextTemplate = typeof step.contextTemplate === 'string' && step.contextTemplate.trim() ? step.contextTemplate : sharedContextTemplate();
  step.resultAlias = typeof step.resultAlias === 'string' && step.resultAlias.trim() ? step.resultAlias : `${id || slug}Decision`;
  step.inputTemplate = strictLlmPrompt(step, instructions[id] ?? `Execute the ${step.name ?? id} step for ${slug}.`);
}

function enrichCustomStep(step: MutableAgentStep, slug: string) {
  const id = String(step.id ?? '');
  const isChronicle = id.includes('chronicle') || String(step.name ?? '').toLowerCase().includes('chronicle');
  step.systemPrompt = typeof step.systemPrompt === 'string' && step.systemPrompt.trim()
    ? step.systemPrompt
    : isChronicle
      ? 'You are the REVERIE Chronicle writer. Return one concise receipt-backed world history entry.'
      : CONCISE_SYSTEM;
  step.contextTemplate = typeof step.contextTemplate === 'string' && step.contextTemplate.trim() ? step.contextTemplate : sharedContextTemplate();
  step.resultAlias = typeof step.resultAlias === 'string' && step.resultAlias.trim() ? step.resultAlias : `${id || slug}Result`;
  if (isChronicle) {
    step.inputTemplate = [
      'Write a concise Chronicle entry from the accumulated workflow context.',
      'Include the decision, affected zone/faction/world state, and proof-friendly summary.',
      'Previous step result: {{previous.output}}',
    ].join('\n');
  } else {
    step.inputTemplate = strictLlmPrompt(step, `Apply the ${step.name ?? id} state update for ${slug}.`);
  }
}

function enrichOfficialBuilder(builder: WorldBuilderConfig, slug: string): WorldBuilderConfig {
  const next = cloneBuilder(builder);
  next.agentChain = (next.agentChain ?? []).map((step) => {
    const enriched = { ...step } as MutableAgentStep;
    if (enriched.agentType === 'native_json_api') enrichJsonApiStep(enriched, slug);
    else if (enriched.agentType === 'native_llm') enrichLlmStep(enriched, slug);
    else enrichCustomStep(enriched, slug);
    return enriched as WorldBuilderConfig['agentChain'][number];
  });
  return next;
}

export const officialBuilderTemplates: OfficialBuilderTemplate[] = [
  {
    slug: 'cargo-climate-guard',
    name: 'Cargo Climate Guard',
    description: 'Sea-route weather system with rerouting, on-chain reactivity, receipts, and STOP_WORLD behavior for unsafe realtime routes.',
    category: 'supply_chain',
    officialTemplate: 'cargo-autonomous-template-v2',
    extraConfig: { routeSourceVersion: 'cargo-routes-v2' },
    builder: normalizeWithRuntimeFoundation(applyLiveBuilderAgentDefaults(enrichOfficialBuilder(cargoTemplate as WorldBuilderConfig, 'cargo-climate-guard'), 'cargo-climate-guard')),
  },
  {
    slug: 'global-climate-crisis-response',
    name: 'Global Climate Crisis Response',
    description: 'Weather-triggered crisis response world with regional zones, agency factions, Chronicle logs, and receipts.',
    category: 'insurance',
    officialTemplate: 'climate-crisis-response-v2',
    builder: normalizeWithRuntimeFoundation(applyLiveBuilderAgentDefaults(climateTemplate as WorldBuilderConfig, 'global-climate-crisis-response')),
  },
  {
    slug: 'crypto-market-intelligence',
    name: 'Crypto Market Intelligence Arena',
    description: 'Token-price risk world with strategy factions, market-scan triggers, Chronicle entries, and receipts.',
    category: 'defi_automation',
    officialTemplate: 'crypto-market-intelligence-v1',
    builder: normalizeWithRuntimeFoundation(applyLiveBuilderAgentDefaults(enrichOfficialBuilder(cryptoTemplate as WorldBuilderConfig, 'crypto-market-intelligence'), 'crypto-market-intelligence')),
  },
  {
    slug: 'sports-prediction-league',
    name: 'Sports Prediction League',
    description: 'Prepared sports prediction world with locked predictions, result settlement, team morale, and Chronicle receipts.',
    category: 'prediction_market',
    officialTemplate: 'sports-prediction-league-v1',
    builder: normalizeWithRuntimeFoundation(applyLiveBuilderAgentDefaults(enrichOfficialBuilder(sportsTemplate as WorldBuilderConfig, 'sports-prediction-league'), 'sports-prediction-league')),
  },
  {
    slug: 'living-kingdom-lite',
    name: 'Living Kingdom Lite',
    description: 'Fantasy world template with zones, factions, manual quest events, conflict resolution, and Chronicle updates.',
    category: 'gaming',
    officialTemplate: 'living-kingdom-lite-v1',
    builder: normalizeWithRuntimeFoundation(applyLiveBuilderAgentDefaults(enrichOfficialBuilder(kingdomTemplate as WorldBuilderConfig, 'living-kingdom-lite'), 'living-kingdom-lite')),
  },
];

export function getOfficialBuilderTemplate(slug: string | null | undefined) {
  if (!slug) return null;
  return officialBuilderTemplates.find((template) => template.slug === slug) ?? null;
}

export function buildOfficialWorldConfig(template: OfficialBuilderTemplate) {
  return {
    officialTemplate: template.officialTemplate,
    ...(template.extraConfig ?? {}),
    worldState: {
      template: template.slug,
      templateSlug: template.slug,
      worldSlug: template.slug,
      agents: [],
      zones: template.builder.zones ?? [],
      factions: template.builder.factions ?? [],
      builder: template.builder,
    },
  };
}
