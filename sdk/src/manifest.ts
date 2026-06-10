import { encodeFunctionData, isAddress, keccak256, toBytes } from "viem";

export const MANIFEST_STEP_KIND = {
  llmString: 0,
  jsonString: 1,
  webParseString: 2,
  chronicle: 3,
  applyClimate: 4,
  applyConflict: 5,
  factionNarrative: 6,
  llmToolsChat: 7,
  worldStateEffect: 8,
  zoneEffect: 9,
  factionEffect: 10,
} as const;

export interface WorldManifestZone {
  sourceId: string;
  zoneId: `0x${string}`;
  name: string;
  dangerLevel: bigint;
  faction: string;
}

export interface WorldManifestFaction {
  sourceId: string;
  factionId: string;
  name: string;
  morale: bigint;
  narrative: string;
}

export interface WorldManifestTrigger {
  triggerId: `0x${string}`;
  active: boolean;
  triggerType: number;
  emitter: `0x${string}`;
  topic0: `0x${string}`;
  topic1: `0x${string}`;
  gasLimit: bigint;
  cooldownSeconds: bigint;
  scheduleIntervalSeconds: bigint;
  scheduleNextTimestampMs: bigint;
  firstStep: bigint;
  stepCount: bigint;
  schedule?: {
    cronExpression: string;
    nextTimestampMs: number;
    intervalSeconds: number;
  };
}

export interface WorldManifestStep {
  kind: number;
  zoneId: `0x${string}`;
  factionId: string;
  prompt: string;
  system: string;
  url: string;
  selector: string;
  payload: `0x${string}`;
}

export interface WorldManifestRelationship {
  sourceId: string;
  sourceType: string;
  targetId: string;
  targetType: string;
  weightBps: bigint;
  label: string;
}

export interface WorldManifestDecisionContinuation {
  triggerId: `0x${string}`;
  matchValue: string;
  nextTriggerId: `0x${string}`;
  terminal: boolean;
}

export interface CompiledWorldManifest {
  manifestHash: `0x${string}`;
  zones: WorldManifestZone[];
  factions: WorldManifestFaction[];
  triggers: WorldManifestTrigger[];
  steps: WorldManifestStep[];
  relationships: WorldManifestRelationship[];
  decisionContinuations: WorldManifestDecisionContinuation[];
  unsupported: string[];
  summary: {
    zoneCount: number;
    factionCount: number;
    triggerCount: number;
    stepCount: number;
    relationshipCount: number;
  };
}

const ZERO_BYTES32 = `0x${"0".repeat(64)}` as `0x${string}`;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as `0x${string}`;
const SCHEDULE_TOPIC0 = keccak256(toBytes("Schedule(uint256)"));

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function arrayValue(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => stringValue(item)).filter(Boolean)
    : [];
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function percentBps(value: unknown, fallback = 100): bigint {
  const percent = Math.max(0, Math.min(100, numberValue(value, fallback)));
  return BigInt(Math.round(percent * 100));
}

function bytes32Value(value: unknown, seed: string): `0x${string}` {
  if (typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value)) {
    return value as `0x${string}`;
  }
  return keccak256(toBytes(seed));
}

function addressValue(value: unknown): `0x${string}` {
  return typeof value === "string" && isAddress(value) ? value as `0x${string}` : ZERO_ADDRESS;
}

function topicValue(value: unknown): `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value)
    ? value as `0x${string}`
    : ZERO_BYTES32;
}

function hasUnresolvedTemplate(value: string): boolean {
  return /\{\{\s*[^}]+?\s*\}\}/.test(value);
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function missingRequiredQueryParams(value: string, params: string[]): string[] {
  if (params.length === 0) return [];
  try {
    const url = new URL(value);
    return params.filter((param) => {
      const next = url.searchParams.get(param);
      return next === null || next.trim() === "";
    });
  } catch {
    return params;
  }
}

function defaultRequiredQueryParams(value: string): string[] {
  if (!value.includes("open-meteo.com")) return [];
  return ["latitude", "longitude"];
}

function bytes32FromUint(value: bigint): `0x${string}` {
  const hex = value.toString(16).padStart(64, "0");
  return `0x${hex}` as `0x${string}`;
}

function triggerType(value: unknown): number {
  if (value === "manual_action") return 0;
  if (value === "contract_event") return 1;
  if (value === "scheduled") return 2;
  if (value === "data_condition") return 3;
  return 0;
}

const MONTH_ALIASES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const DOW_ALIASES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

function normalizeCronToken(token: string, aliases: Record<string, number>) {
  return token.toLowerCase().replace(/[a-z]{3}/g, (match) => aliases[match]?.toString() ?? match);
}

function validCronField(field: string, min: number, max: number, aliases: Record<string, number> = {}) {
  const normalized = normalizeCronToken(field, aliases);
  const atom = `(?:\\*|\\d{1,2}|\\d{1,2}-\\d{1,2})`;
  const piece = new RegExp(`^${atom}(?:/${atom.replace("\\*", "\\d{1,2}")})?$`);
  return normalized.split(",").every((part) => {
    if (!piece.test(part)) return false;
    const values = part.match(/\d{1,2}/g)?.map(Number) ?? [];
    return values.every((value) => value >= min && value <= max);
  });
}

function parseSingleNumber(field: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(field)) return null;
  const value = Number(field);
  return value >= min && value <= max ? value : null;
}

function parseSingleDayOfWeek(field: string): number | null {
  const normalized = normalizeCronToken(field, DOW_ALIASES);
  const value = parseSingleNumber(normalized, 0, 7);
  if (value === null) return null;
  return value === 7 ? 0 : value;
}

function parseStep(field: string, fullMin: number, fullMax: number): number | null {
  const wildcard = field.match(/^\*\/(\d+)$/);
  if (wildcard) {
    const value = Number(wildcard[1]);
    return value > 0 ? value : null;
  }
  const ranged = field.match(/^(\d+)-(\d+)\/(\d+)$/);
  if (!ranged) return null;
  const from = Number(ranged[1]);
  const to = Number(ranged[2]);
  const step = Number(ranged[3]);
  return from === fullMin && to === fullMax && step > 0 ? step : null;
}

function cronParts(cronExpression: string): string[] | null {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  if (
    !validCronField(minute, 0, 59) ||
    !validCronField(hour, 0, 23) ||
    !validCronField(dayOfMonth, 1, 31) ||
    !validCronField(month, 1, 12, MONTH_ALIASES) ||
    !validCronField(dayOfWeek, 0, 7, DOW_ALIASES)
  ) {
    return null;
  }
  return parts;
}

function cronIntervalSeconds(cronExpression: string): number | null {
  const parts = cronParts(cronExpression);
  if (!parts) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  if (dayOfMonth !== "*" || month !== "*") return null;
  const fixedMinuteForWeekly = parseSingleNumber(minute, 0, 59);
  const fixedHourForWeekly = parseSingleNumber(hour, 0, 23);
  if (dayOfWeek !== "*") {
    return fixedMinuteForWeekly !== null && fixedHourForWeekly !== null && parseSingleDayOfWeek(dayOfWeek) !== null
      ? 7 * 24 * 3600
      : null;
  }
  const minuteStep = parseStep(minute, 0, 59);
  if (minuteStep && hour === "*") return minuteStep * 60;
  if (minute === "*" && hour === "*") return 60;
  const fixedMinute = parseSingleNumber(minute, 0, 59);
  if (fixedMinute !== null && hour === "*") return 3600;
  const hourStep = parseStep(hour, 0, 23);
  if (fixedMinute !== null && hourStep) return hourStep * 3600;
  if (fixedMinute !== null && parseSingleNumber(hour, 0, 23) !== null) return 86400;
  return null;
}

function cronFieldMatches(field: string, value: number, min: number, max: number, aliases: Record<string, number> = {}) {
  const normalized = normalizeCronToken(field, aliases);
  return normalized.split(",").some((part) => {
    if (part === "*") return true;
    const step = parseStep(part, min, max);
    if (step) return value % step === 0;
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) return value >= Number(range[1]) && value <= Number(range[2]);
    return parseSingleNumber(part, min, max) === value;
  });
}

function nextCronTimestampMs(cronExpression: string, from = Date.now()): number | null {
  const intervalSeconds = cronIntervalSeconds(cronExpression);
  if (!intervalSeconds) return null;
  const parts = cronParts(cronExpression);
  if (!parts) return null;
  const [minute, hour, _dayOfMonth, _month, dayOfWeek] = parts;
  const earliest = from + 12_000;
  const cursor = new Date(earliest);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  for (let i = 0; i < 60 * 24 * 370; i += 1) {
    const m = cursor.getMinutes();
    const h = cursor.getHours();
    const dow = cursor.getDay();
    const minuteMatches = cronFieldMatches(minute, m, 0, 59);
    const hourMatches = cronFieldMatches(hour, h, 0, 23);
    const dowMatches = cronFieldMatches(dayOfWeek, dow, 0, 7, DOW_ALIASES) || (dow === 0 && cronFieldMatches(dayOfWeek, 7, 0, 7, DOW_ALIASES));
    if (minuteMatches && hourMatches && dowMatches) return cursor.getTime();
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return from + Math.max(12_000, intervalSeconds * 1000);
}

function emptyStep(kind: number): WorldManifestStep {
  return {
    kind,
    zoneId: ZERO_BYTES32,
    factionId: "",
    prompt: "",
    system: "",
    url: "",
    selector: "",
    payload: "0x",
  };
}

function nodeType(value: string): string {
  const [prefix] = value.split(":");
  return prefix || "unknown";
}

function nodeRef(value: string): string {
  return value.includes(":") ? value.slice(value.indexOf(":") + 1) : value;
}

function relationshipFromGraphEdge(edge: Record<string, unknown>): WorldManifestRelationship | null {
  const source = stringValue(edge.source);
  const target = stringValue(edge.target);
  if (!source || !target) return null;
  return {
    sourceId: nodeRef(source),
    sourceType: nodeType(source),
    targetId: nodeRef(target),
    targetType: nodeType(target),
    weightBps: percentBps(edge.weightPercent ?? edge.priorityPercent ?? edge.allocationPercent, 100),
    label: stringValue(edge.label, "relationship"),
  };
}

function relationshipFromAllocation(item: Record<string, unknown>, type: "zone" | "faction"): WorldManifestRelationship | null {
  const id = stringValue(item.id, stringValue(item.name));
  const allocation = item.allocationPercent ?? objectValue(item.state).allocationPercent;
  if (!id || allocation === undefined) return null;
  return {
    sourceId: id,
    sourceType: type,
    targetId: "world",
    targetType: "world",
    weightBps: percentBps(allocation, 0),
    label: `${type}_allocation`,
  };
}

function relationshipFromOutputMapping(trigger: Record<string, unknown>, mapping: Record<string, unknown>): WorldManifestRelationship | null {
  const target = stringValue(mapping.target);
  if (target === "event") return null;
  const targetId = stringValue(mapping.targetId, target === "world_state" ? "world" : "");
  if (!target || !targetId) return null;
  return {
    sourceId: stringValue(trigger.id, stringValue(trigger.name, "trigger")),
    sourceType: "trigger",
    targetId,
    targetType: target,
    weightBps: percentBps(mapping.weightPercent ?? mapping.priorityPercent, 100),
    label: stringValue(mapping.path, "output"),
  };
}

function relationshipScope(relationship: WorldManifestRelationship): string {
  if (relationship.sourceType === "zone" && relationship.targetType === "faction") {
    return "zone:faction:" + relationship.targetId;
  }
  if (relationship.sourceType === "zone" && relationship.targetType === "world") {
    return "zone:world";
  }
  if (relationship.sourceType === "faction" && relationship.targetType === "world") {
    return "faction:world";
  }
  if (relationship.sourceType === "trigger") {
    return `trigger:${relationship.sourceId}:${relationship.targetType}:${relationship.targetId}`;
  }
  return `${relationship.sourceType}:${relationship.targetType}:${relationship.targetId}`;
}

function continuationRules(trigger: Record<string, unknown>): Record<string, unknown>[] {
  const condition = objectValue(trigger.condition);
  const typeConfig = objectValue(trigger.typeConfig ?? condition.typeConfig);
  return [
    ...arrayValue(trigger.decisionContinuations),
    ...arrayValue(typeConfig.decisionContinuations),
    ...arrayValue(condition.decisionContinuations),
  ];
}

function validateDeclaredLiveRequirements(builder: Record<string, unknown>, unsupported: string[]) {
  const config = objectValue(builder.config);
  const requirements = objectValue(config.liveRequirements);
  if (Object.keys(requirements).length === 0) return;

  const dataSources = arrayValue(builder.dataSources);
  const sourceById = new Map(dataSources.map((source) => [stringValue(source.id), source]));
  for (const requirement of arrayValue(requirements.dataSources)) {
    const id = stringValue(requirement.id);
    if (!id) continue;
    const label = stringValue(requirement.label, id);
    const mustResolveUrl = requirement.resolvedHttpUrl !== false;
    const source = sourceById.get(id);
    const url = stringValue(source?.url);
    if (!source) {
      unsupported.push(`Live manifest is missing required data source "${label}".`);
      continue;
    }
    if (mustResolveUrl && (!url || hasUnresolvedTemplate(url) || !validHttpUrl(url))) {
      unsupported.push(`Live data source "${label}" needs a resolved http(s) URL before deployment.`);
    }
    const missingParams = missingRequiredQueryParams(url, stringArrayValue(requirement.requiredUrlQueryParams));
    if (missingParams.length > 0) {
      unsupported.push(`Live data source "${label}" needs resolved URL query value(s): ${missingParams.join(", ")}.`);
    }
  }

  const steps = arrayValue(builder.agentChain);
  const stepById = new Map(steps.flatMap((step) => [
    [stringValue(step.id), step],
    [stringValue(step.agentId), step],
  ]));
  for (const requirement of arrayValue(requirements.agentSteps)) {
    const id = stringValue(requirement.id);
    if (!id) continue;
    const label = stringValue(requirement.label, id);
    const step = stepById.get(id);
    if (!step) {
      unsupported.push(`Live manifest is missing required agent step "${label}".`);
      continue;
    }
    const url = stringValue(step.urlTemplate, stringValue(step.url));
    const missingParams = missingRequiredQueryParams(url, stringArrayValue(requirement.requiredUrlQueryParams));
    if (missingParams.length > 0) {
      unsupported.push(`Agent step "${label}" needs resolved URL query value(s): ${missingParams.join(", ")}.`);
    }
  }

  const triggerById = new Map(arrayValue(builder.triggers).map((trigger) => [stringValue(trigger.id), trigger]));
  for (const requirement of arrayValue(requirements.triggers)) {
    const id = stringValue(requirement.id);
    if (!id) continue;
    const label = stringValue(requirement.label, id);
    const requiresContinuations = requirement.requiresDecisionContinuations === true;
    const trigger = triggerById.get(id);
    if (!trigger) {
      unsupported.push(`Live manifest is missing required trigger "${label}".`);
      continue;
    }
    if (requiresContinuations && continuationRules(trigger).length === 0) {
      unsupported.push(`Live trigger "${label}" needs decision continuation mappings before deployment.`);
    }
  }
}

function normalizeRelationshipWeights(rawRelationships: WorldManifestRelationship[]): WorldManifestRelationship[] {
  const deduped = new Map<string, WorldManifestRelationship>();
  for (const relationship of rawRelationships) {
    const key = [
      relationship.sourceType,
      relationship.sourceId,
      relationship.targetType,
      relationship.targetId,
      relationship.label,
    ].join(":");
    deduped.set(key, relationship);
  }

  const groups = new Map<string, WorldManifestRelationship[]>();
  for (const relationship of deduped.values()) {
    const scope = relationshipScope(relationship);
    groups.set(scope, [...(groups.get(scope) ?? []), relationship]);
  }

  const normalized: WorldManifestRelationship[] = [];
  for (const group of groups.values()) {
    const total = group.reduce((sum, relationship) => sum + relationship.weightBps, 0n);
    if (group.length <= 1 || total === 0n) {
      normalized.push(...group);
      continue;
    }
    let used = 0n;
    group.forEach((relationship, index) => {
      const nextWeight = index === group.length - 1
        ? 10_000n - used
        : (relationship.weightBps * 10_000n) / total;
      used += nextWeight;
      normalized.push({ ...relationship, weightBps: nextWeight });
    });
  }
  return normalized;
}

function targetZoneId(builder: Record<string, unknown>, trigger: Record<string, unknown>): `0x${string}` {
  const zones = arrayValue(builder.zones);
  const worldKey = stringValue(builder.uiSlug, "world");
  const outputMappings = arrayValue(trigger.outputMapping ?? objectValue(trigger.condition).outputMapping);
  const zoneMapping = outputMappings.find((mapping) => stringValue(mapping.target) === "zone" && stringValue(mapping.targetId));
  const source = objectValue(trigger.sourceConfig ?? objectValue(trigger.condition).sourceConfig);
  const sourceZoneId = stringValue(source.kind) === "zone_state" ? stringValue(source.sourceId) : "";
  const targetId = stringValue(zoneMapping?.targetId, sourceZoneId);
  const zone = zones.find((item) => stringValue(item.id) === targetId || stringValue(item.name) === targetId) ?? zones[0];
  return bytes32Value(targetId || zone?.id, `reverie:zone:${worldKey}:${stringValue(zone?.name, targetId || "zone")}`);
}

function targetFactionId(builder: Record<string, unknown>, trigger: Record<string, unknown>): string {
  const factions = arrayValue(builder.factions);
  const outputMappings = arrayValue(trigger.outputMapping ?? objectValue(trigger.condition).outputMapping);
  const factionMapping = outputMappings.find((mapping) => stringValue(mapping.target) === "faction" && stringValue(mapping.targetId));
  const source = objectValue(trigger.sourceConfig ?? objectValue(trigger.condition).sourceConfig);
  const sourceFactionId = stringValue(source.kind) === "faction_state" ? stringValue(source.sourceId) : "";
  const targetId = stringValue(factionMapping?.targetId, sourceFactionId);
  const faction = factions.find((item) => stringValue(item.id) === targetId || stringValue(item.name) === targetId) ?? factions[0];
  return targetId || stringValue(faction?.id, stringValue(faction?.name, "faction"));
}

function webParsePayload(agent: Record<string, unknown>, unsupported: string[]): `0x${string}` | null {
  const url = stringValue(agent.urlTemplate, stringValue(agent.url, stringValue(agent.inputTemplate)));
  if (!url || hasUnresolvedTemplate(url) || !validHttpUrl(url)) {
    unsupported.push(`Web Parse step "${stringValue(agent.name, stringValue(agent.id, "web-parse"))}" needs a resolved http(s) URL before live deployment.`);
    return null;
  }
  const key = stringValue(agent.resultAlias, stringValue(agent.id, "result"));
  const description = stringValue(agent.description, stringValue(agent.purpose, "Extract the requested field."));
  const prompt = stringValue(agent.prompt, stringValue(agent.inputTemplate, stringValue(agent.purpose, "Extract a concise value.")));
  return encodeFunctionData({
    abi: [{
      name: "ExtractString",
      type: "function",
      stateMutability: "nonpayable",
      inputs: [
        { name: "key", type: "string" },
        { name: "description", type: "string" },
        { name: "options", type: "string[]" },
        { name: "prompt", type: "string" },
        { name: "url", type: "string" },
        { name: "resolveUrl", type: "bool" },
        { name: "numPages", type: "uint8" },
        { name: "confidenceThreshold", type: "uint8" },
      ],
      outputs: [{ name: "output", type: "string" }],
    }],
    functionName: "ExtractString",
    args: [
      key,
      description,
      [],
      prompt,
      url,
      true,
      1,
      70,
    ],
  });
}

function compileAgentStep(
  builder: Record<string, unknown>,
  trigger: Record<string, unknown>,
  agent: Record<string, unknown>,
  unsupported: string[]
): WorldManifestStep[] {
  const agentType = stringValue(agent.agentType);
  const agentId = stringValue(agent.agentId, stringValue(agent.id));
  const name = stringValue(agent.name, agentId);
  if (stringValue(agent.stepType) === "tool" || agentType === "tool") {
    unsupported.push(`Tool step "${name}" requires a one-shot MCP capability URL. It is live-compatible only for owner-signed manual runs, not autonomous manifest workflows.`);
    return [];
  }
  const prompt = stringValue(agent.inputTemplate, stringValue(agent.purpose, "Use the trigger payload and world state."));
  const context = stringValue(agent.contextTemplate);
  const fullPrompt = context ? `${prompt}\n\nContext:\n${context}` : prompt;
  const system = stringValue(agent.systemPrompt, stringValue(agent.purpose, "You are an autonomous REVERIE world agent. Return a concise result."));
  const source = objectValue(trigger.sourceConfig ?? objectValue(trigger.condition).sourceConfig);
  const typeConfig = objectValue(trigger.typeConfig ?? objectValue(trigger.condition).typeConfig);
  const zoneId = targetZoneId(builder, trigger);
  const factionId = targetFactionId(builder, trigger);

  if (agentType === "native_llm") {
    if (hasUnresolvedTemplate(fullPrompt) || hasUnresolvedTemplate(system)) {
      unsupported.push(`LLM step "${name}" has unresolved template placeholders. Apply and arm with resolved runtime inputs before deployment.`);
      return [];
    }
    return [{ ...emptyStep(MANIFEST_STEP_KIND.llmString), prompt: fullPrompt, system }];
  }

  if (agentType === "native_json_api") {
    const url = stringValue(agent.urlTemplate, stringValue(agent.url));
    const selector = stringValue(agent.selector, stringValue(source.path, "value"));
    if (!url || hasUnresolvedTemplate(url) || !validHttpUrl(url)) {
      unsupported.push(`JSON API step "${name}" needs a resolved http(s) URL before live deployment.`);
      return [];
    }
    const missingParams = missingRequiredQueryParams(url, defaultRequiredQueryParams(url));
    if (missingParams.length > 0) {
      unsupported.push(`JSON API step "${name}" needs resolved URL query value(s): ${missingParams.join(", ")}.`);
      return [];
    }
    if (!selector || hasUnresolvedTemplate(selector)) {
      unsupported.push(`JSON API step "${name}" needs a resolved selector before live deployment.`);
      return [];
    }
    return [{
      ...emptyStep(MANIFEST_STEP_KIND.jsonString),
      url,
      selector,
    }];
  }

  if (agentType === "native_web_parse") {
    const payload = webParsePayload(agent, unsupported);
    return payload ? [{ ...emptyStep(MANIFEST_STEP_KIND.webParseString), payload }] : [];
  }

  if (agentId === "chronicle" || name.toLowerCase().includes("chronicle")) {
    return [
      { ...emptyStep(MANIFEST_STEP_KIND.llmString), prompt: fullPrompt, system },
      { ...emptyStep(MANIFEST_STEP_KIND.chronicle), prompt: "" },
    ];
  }

  if (agentId === "zoneClimate" || name.toLowerCase().includes("climate")) {
    return [
      {
        ...emptyStep(MANIFEST_STEP_KIND.jsonString),
        url: stringValue(typeConfig.url, stringValue(agent.url, "https://api.open-meteo.com/v1/forecast?latitude=6.5&longitude=3.4&current=weather_code")),
        selector: stringValue(typeConfig.selector, stringValue(agent.selector, "current.weather_code")),
      },
      { ...emptyStep(MANIFEST_STEP_KIND.llmString), zoneId, prompt: fullPrompt, system },
      { ...emptyStep(MANIFEST_STEP_KIND.applyClimate), zoneId },
    ];
  }

  if (agentId === "conflict" || name.toLowerCase().includes("conflict")) {
    return [
      { ...emptyStep(MANIFEST_STEP_KIND.llmString), zoneId, prompt: fullPrompt, system },
      { ...emptyStep(MANIFEST_STEP_KIND.applyConflict), zoneId },
    ];
  }

  if (agentId === "factionMorale" || name.toLowerCase().includes("morale")) {
    return [
      { ...emptyStep(MANIFEST_STEP_KIND.llmString), prompt: fullPrompt, system },
      {
        ...emptyStep(MANIFEST_STEP_KIND.factionNarrative),
        factionId,
      },
    ];
  }

  unsupported.push(`Agent "${name}" (${agentType || "unknown"}) cannot be compiled into a live on-chain workflow yet.`);
  return [];
}

function compileOutputMappingStep(
  builder: Record<string, unknown>,
  trigger: Record<string, unknown>,
  mapping: Record<string, unknown>,
  unsupported: string[]
): WorldManifestStep | null {
  const target = stringValue(mapping.target);
  const path = stringValue(mapping.path, "latestDecision");
  if (target === "event" || target === "world_state") {
    return { ...emptyStep(MANIFEST_STEP_KIND.worldStateEffect), prompt: target === "event" ? stringValue(mapping.targetId, "event") : `world_state:${path}` };
  }
  if (target === "zone") {
    const targetId = stringValue(mapping.targetId);
    if (!targetId) {
      unsupported.push(`Trigger "${stringValue(trigger.name, stringValue(trigger.id))}" has a zone output mapping without a target zone.`);
      return null;
    }
    return {
      ...emptyStep(MANIFEST_STEP_KIND.zoneEffect),
      zoneId: targetZoneId(builder, { ...trigger, outputMapping: [mapping] }),
      prompt: path,
    };
  }
  if (target === "faction") {
    const targetId = stringValue(mapping.targetId);
    if (!targetId) {
      unsupported.push(`Trigger "${stringValue(trigger.name, stringValue(trigger.id))}" has a faction output mapping without a target faction.`);
      return null;
    }
    return {
      ...emptyStep(MANIFEST_STEP_KIND.factionEffect),
      factionId: targetFactionId(builder, { ...trigger, outputMapping: [mapping] }),
      prompt: path,
    };
  }
  unsupported.push(`Trigger "${stringValue(trigger.name, stringValue(trigger.id))}" has unsupported output target "${target || "unknown"}".`);
  return null;
}

export function compileWorldManifest(rawBuilder: unknown): CompiledWorldManifest {
  const builder = objectValue(rawBuilder);
  const unsupported: string[] = [];
  const worldKey = stringValue(builder.uiSlug, stringValue(builder.displayName, "reverie-world"));
  const zones = arrayValue(builder.zones).map((zone, index) => ({
    sourceId: stringValue(zone.id, stringValue(zone.name, `zone-${index + 1}`)),
    zoneId: bytes32Value(zone.id, `reverie:zone:${worldKey}:${stringValue(zone.name, `zone-${index + 1}`)}`),
    name: stringValue(zone.name, `Zone ${index + 1}`),
    dangerLevel: BigInt(Math.max(0, Math.floor(numberValue(objectValue(zone.state).dangerLevel, 0)))),
    faction: stringValue(objectValue(zone.state).controllingFaction, "unassigned"),
  }));
  const factions = arrayValue(builder.factions).map((faction, index) => ({
    sourceId: stringValue(faction.id, stringValue(faction.name, `faction-${index + 1}`)),
    factionId: stringValue(faction.id, stringValue(faction.name, `faction-${index + 1}`)),
    name: stringValue(faction.name, `Faction ${index + 1}`),
    morale: BigInt(Math.floor(numberValue(objectValue(faction.state).morale, 0))),
    narrative: stringValue(objectValue(faction.state).narrative, "Initialized by REVERIE manifest."),
  }));
  const relationships = normalizeRelationshipWeights([
    ...arrayValue(objectValue(builder.graph).edges).map(relationshipFromGraphEdge).filter((item): item is WorldManifestRelationship => Boolean(item)),
    ...arrayValue(builder.zones).map((zone) => relationshipFromAllocation(zone, "zone")).filter((item): item is WorldManifestRelationship => Boolean(item)),
    ...arrayValue(builder.factions).map((faction) => relationshipFromAllocation(faction, "faction")).filter((item): item is WorldManifestRelationship => Boolean(item)),
    ...arrayValue(builder.triggers).flatMap((trigger) => arrayValue(trigger.outputMapping ?? objectValue(trigger.condition).outputMapping).map((mapping) => relationshipFromOutputMapping(trigger, mapping))).filter((item): item is WorldManifestRelationship => Boolean(item)),
  ]);
  const agentChain = arrayValue(builder.agentChain);
  const steps: WorldManifestStep[] = [];
  const triggers: WorldManifestTrigger[] = [];
  const triggerIdBySource = new Map<string, `0x${string}`>();
  const activeTriggers = arrayValue(builder.triggers).filter((trigger) => trigger.isActive !== false);
  validateDeclaredLiveRequirements(builder, unsupported);
  const startTriggerCount = activeTriggers.filter((trigger) => {
    const condition = objectValue(trigger.condition);
    return Boolean(condition.isStartTrigger) || Boolean(trigger.isStartTrigger);
  }).length;
  if (startTriggerCount === 0) {
    unsupported.push("A live world needs one active start trigger before manifest deployment.");
  } else if (startTriggerCount > 1) {
    unsupported.push("A live world can only have one active start trigger before manifest deployment.");
  }

  for (const trigger of activeTriggers) {
    if (trigger.isActive === false) continue;
    const firstStep = steps.length;
    const chainIds = Array.isArray(trigger.agentChain)
      ? trigger.agentChain.filter((item): item is string => typeof item === "string")
      : [];
    const hasToolStep = chainIds.some((id) => {
      const step = agentChain.find((item) => stringValue(item.id) === id || stringValue(item.agentId) === id || stringValue(item.toolId) === id);
      return stringValue(step?.stepType) === "tool" || stringValue(step?.agentType) === "tool";
    });
    if ((trigger.type === "scheduled" || trigger.type === "contract_event") && hasToolStep) {
      unsupported.push(`Trigger "${stringValue(trigger.name, stringValue(trigger.id))}" contains tool steps. Scheduled and contract-event workflows cannot mint one-shot MCP URLs autonomously; use manual live execution or remove the tool step.`);
      continue;
    }
    if (trigger.type === "manual_action" && hasToolStep) {
      continue;
    }
    for (const id of chainIds) {
      const agent = agentChain.find((item) => stringValue(item.id) === id || stringValue(item.agentId) === id || stringValue(item.toolId) === id);
      if (!agent) {
        unsupported.push(`Trigger "${stringValue(trigger.name, stringValue(trigger.id))}" references missing agent "${id}".`);
        continue;
      }
      steps.push(...compileAgentStep(builder, trigger, agent, unsupported));
    }
    for (const mapping of arrayValue(trigger.outputMapping ?? objectValue(trigger.condition).outputMapping)) {
      const outputStep = compileOutputMappingStep(builder, trigger, mapping, unsupported);
      if (outputStep) steps.push(outputStep);
    }
    const stepCount = steps.length - firstStep;
    if (stepCount === 0) {
      unsupported.push(`Trigger "${stringValue(trigger.name, stringValue(trigger.id))}" has no compilable agent steps.`);
      continue;
    }
    const typeConfig = objectValue(trigger.typeConfig ?? objectValue(trigger.condition).typeConfig);
    const contractEvent = objectValue(typeConfig.contractEvent);
    const cronExpression = stringValue(typeConfig.cronExpression, "* * * * *");
    const scheduleMode = stringValue(typeConfig.scheduleMode, "cron");
    const explicitTimestampMs = numberValue(typeConfig.scheduleTimestampMs, 0);
    const isCurrentTimestampSchedule = trigger.type === "scheduled" && scheduleMode === "current_timestamp";
    const cronNextTimestampMs = isCurrentTimestampSchedule
      ? Math.max(explicitTimestampMs || Date.now() + 15_000, Date.now() + 12_000)
      : nextCronTimestampMs(cronExpression);
    const cronInterval = isCurrentTimestampSchedule ? 0 : cronIntervalSeconds(cronExpression);
    const sourceTriggerId = stringValue(trigger.id, `trigger-${triggers.length + 1}`);
    const contractTriggerId = bytes32Value(sourceTriggerId, `reverie:trigger:${worldKey}:${stringValue(trigger.name, String(triggers.length))}`);
    triggerIdBySource.set(sourceTriggerId, contractTriggerId);
    triggers.push({
      triggerId: contractTriggerId,
      active: trigger.isActive !== false,
      triggerType: triggerType(trigger.type),
      emitter: trigger.type === "scheduled" ? ZERO_ADDRESS : addressValue(contractEvent.emitterAddress),
      topic0: trigger.type === "scheduled" ? SCHEDULE_TOPIC0 : topicValue(contractEvent.topic0),
      topic1: trigger.type === "scheduled"
        ? bytes32FromUint(BigInt(cronNextTimestampMs ?? 0))
        : topicValue(contractEvent.topic1),
      gasLimit: BigInt(Math.floor(numberValue(contractEvent.gasLimit, 500_000))),
      cooldownSeconds: BigInt(Math.floor(numberValue(trigger.cooldownSeconds, numberValue(trigger.cooldownMs, 0) / 1000))),
      scheduleIntervalSeconds: trigger.type === "scheduled"
        ? BigInt(cronInterval ?? 0)
        : 0n,
      scheduleNextTimestampMs: trigger.type === "scheduled"
        ? BigInt(cronNextTimestampMs ?? 0)
        : 0n,
      firstStep: BigInt(firstStep),
      stepCount: BigInt(stepCount),
      schedule: trigger.type === "scheduled"
        ? {
            cronExpression,
            nextTimestampMs: cronNextTimestampMs ?? 0,
            intervalSeconds: cronInterval ?? 0,
          }
        : undefined,
    });
    if (trigger.type === "scheduled" && !isCurrentTimestampSchedule && !cronInterval) {
      unsupported.push(`Scheduled trigger "${stringValue(trigger.name, stringValue(trigger.id))}" uses a valid cron shape that is not a fixed minute/hour/weekly interval for autonomous on-chain recurrence yet. Use patterns such as */5 * * * *, 0 * * * *, 15 */2 * * *, 0 */6 * * *, or 0 9 * * mon.`);
    }
  }

  const decisionContinuations: WorldManifestDecisionContinuation[] = [];
  for (const trigger of activeTriggers) {
    const sourceTriggerId = stringValue(trigger.id);
    const triggerId = triggerIdBySource.get(sourceTriggerId);
    if (!triggerId) continue;
    for (const rule of continuationRules(trigger)) {
      const matchValue = stringValue(rule.matchValue ?? rule.value ?? rule.decision);
      const terminal = Boolean(rule.terminal);
      const nextSourceId = stringValue(rule.nextTriggerId);
      if (!matchValue) {
        unsupported.push(`Trigger "${stringValue(trigger.name, sourceTriggerId)}" has a decision continuation without a match value.`);
        continue;
      }
      if (hasUnresolvedTemplate(matchValue)) {
        unsupported.push(`Trigger "${stringValue(trigger.name, sourceTriggerId)}" has an unresolved decision continuation match value.`);
        continue;
      }
      const nextTriggerId = terminal ? ZERO_BYTES32 : triggerIdBySource.get(nextSourceId);
      if (!nextTriggerId) {
        unsupported.push(`Trigger "${stringValue(trigger.name, sourceTriggerId)}" has a decision continuation to missing trigger "${nextSourceId}".`);
        continue;
      }
      decisionContinuations.push({
        triggerId,
        matchValue,
        nextTriggerId,
        terminal,
      });
    }
  }

  const hashInput = JSON.stringify({
    zones,
    factions,
    triggers,
    steps,
    relationships,
    decisionContinuations,
  }, (_key, value) => typeof value === "bigint" ? value.toString() : value);

  return {
    manifestHash: keccak256(toBytes(hashInput)),
    zones,
    factions,
    triggers,
    steps,
    relationships,
    decisionContinuations,
    unsupported: Array.from(new Set(unsupported)),
    summary: {
      zoneCount: zones.length,
      factionCount: factions.length,
      triggerCount: triggers.length,
      stepCount: steps.length,
      relationshipCount: relationships.length,
    },
  };
}
