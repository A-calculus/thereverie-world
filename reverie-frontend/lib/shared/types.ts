export type AgentType = 'native_llm' | 'native_json_api' | 'native_web_parse' | 'reverie_custom';
export type WorldStatus = 'draft' | 'deployed' | 'running' | 'stopped';
export type ToolStatus = 'draft' | 'deployed';
export type ExecutionLane = 'sdk' | 'onchain';
export type FeedType = 'weather' | 'token_price' | 'web_scrape' | 'time';
export type WorldRuntimeEngineKey =
  | 'genericEventWorld'
  | 'climateCrisisResponse'
  | 'cryptoMarketArena'
  | 'livingKingdom';
export type TriggerType = 'contract_event' | 'scheduled' | 'manual_action' | 'data_condition';
export type ContractEventMode = 'world_abi' | 'custom_abi' | 'raw_topics';
export type TriggerSourceKind =
  | 'builder_input'
  | 'data_source'
  | 'zone_state'
  | 'faction_state'
  | 'runtime_state'
  | 'manual_payload'
  | 'schedule_time';

export interface TriggerSourceConfig {
  kind: TriggerSourceKind;
  sourceId?: string;
  path?: string;
  alias?: string;
  includeInAgentInput?: boolean;
  requestBodyTemplate?: string;
}

export interface TriggerTypeConfig {
  buttonLabel?: string;
  description?: string;
  payloadTemplate?: string;
  cronExpression?: string;
  scheduleMode?: 'cron' | 'current_timestamp';
  scheduleTimestampMs?: number;
  timezone?: 'UTC';
  conditionEnabled?: boolean;
  operator?: 'exists' | 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than';
  compareValue?: string;
  nextTriggerId?: string;
  decisionContinuations?: TriggerDecisionContinuation[];
  contractEventName?: string;
  contractEvent?: ContractEventConfig;
}

export interface ContractEventDataPointCondition {
  enabled?: boolean;
  operator?: 'exists' | 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than';
  compareValue?: string;
}

export interface ContractEventDataPoint {
  id: string;
  label?: string;
  path: string;
  alias: string;
  include: boolean;
  condition?: ContractEventDataPointCondition;
}

export interface ContractEventSubscriptionMetadata {
  emitterAddress?: string;
  eventSignature?: string;
  topic0?: string;
  gasLimit?: number;
  transactionHash?: string;
  subscriptionId?: string;
  subscribedAt?: string;
}

export interface ContractEventConfig {
  mode: ContractEventMode;
  emitterAddress?: string;
  eventName?: string;
  eventSignature?: string;
  abiJson?: string;
  topic0?: string;
  topic1?: string;
  topic2?: string;
  topic3?: string;
  gasLimit?: number;
  dataPoints?: ContractEventDataPoint[];
  subscription?: ContractEventSubscriptionMetadata;
}

export interface TriggerOutputMapping {
  target: 'world_state' | 'zone' | 'faction' | 'event';
  targetId?: string;
  path?: string;
  valueTemplate?: string;
  weightPercent?: number;
  priorityPercent?: number;
}

export interface TriggerDecisionContinuation {
  matchPath?: string;
  matchValue: string;
  nextTriggerId?: string;
  terminal?: boolean;
}

export interface ReverieUser {
  id: string;
  walletAddress: string;
  githubUsername?: string | null;
  fullName?: string | null;
  profilePicUrl?: string | null;
  email?: string | null;
  bio?: string | null;
  isPublicProfile: boolean;
  emailNotifications: boolean;
}

export interface AgentSummary {
  id: string;
  name: string;
  type: AgentType;
  description: string;
  status: 'ACTIVE' | 'INACTIVE';
  worldCount: number;
  createdAt: string;
  systemPrompt?: string | null;
  config?: Record<string, unknown>;
  isPublic?: boolean;
  isOfficial?: boolean;
  isOwner?: boolean;
  ownerId?: string;
  sdkAgent?: 'chronicle' | 'zoneClimate' | 'factionMorale' | 'conflict';
  assignedWorlds?: Array<{
    id: string;
    name: string;
    contractAddress?: string;
    triggerCount: number;
    stepCount: number;
  }>;
}

export interface TemplateSummary {
  id: string;
  slug: string;
  name: string;
  author: string;
  downloads: string;
  tags: string[];
  description: string;
  features: string[];
  category:
    | 'defi_automation'
    | 'gaming'
    | 'social_tokens'
    | 'ai_nft_evolution'
    | 'dao'
    | 'prediction_market'
    | 'insurance'
    | 'supply_chain'
    | 'virtual_world'
    | 'custom';
  featured: boolean;
  isPublic?: boolean;
  isOwner?: boolean;
  overview?: {
    inputs: Array<{ id: string; label: string; type?: string }>;
    dataSources: Array<{ id: string; name: string; type?: string; method?: string }>;
    zones: Array<{ id: string; name: string; description?: string }>;
    factions: Array<{ id: string; name: string; description?: string }>;
    agents: Array<{ id: string; name: string; type?: string; description?: string }>;
    triggers: Array<{ id: string; name: string; type?: string; agents: string[] }>;
    manualActions: Array<{ id: string; label: string; triggerId?: string }>;
  };
}

export interface ToolSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: ToolStatus;
  dependencies: string[];
  inputSample: unknown;
  expectedOutput: unknown;
  mcpMetadata?: ToolMcpMetadata;
  endpointPath?: string | null;
  endpointUrl?: string | null;
  createdAt: string;
  updatedAt?: string;
  isOwner?: boolean;
}

export interface ToolMcpMetadata {
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface ToolSecretRef {
  key: string;
  createdAt?: string;
}

export interface ToolRunResult {
  ok: boolean;
  output: unknown;
  error?: string;
  logs?: string[];
  durationMs?: number;
  dependencyPins?: string[];
  runtimeId?: string;
  isolatedRuntime?: boolean;
}

export interface WorldSummary {
  id: string;
  name: string;
  contractAddress: string;
  template: string;
  templateSlug: string;
  status: WorldStatus;
  balance: string;
  activeAgents: number;
  createdAt: string;
}

export interface WorldDeploymentRecord {
  mode: 'fallback' | 'live';
  contractAddress: string;
  callbackReceiverAddress: string;
  defaultEmitterAddress: string;
  worldWalletAddress?: string;
  transactionHash: string;
  deployedAt: string;
}

export interface RuntimeCostEstimate {
  minimumBalanceStt: number;
  recommendedBalanceStt: number;
  totalEstimatedCostStt: number;
  triggerCount: number;
  dataSourceCount: number;
  toolCallCount: number;
  agentStepCount: number;
  subscriptionCount?: number;
  graphWeightCount?: number;
  scheduledTickCount: number;
  receiptCount: number;
  buffers?: {
    agentBufferPct: number;
    reactivityBufferPct: number;
    minimumWorldBalanceStt: number;
  };
  warnings?: string[];
  breakdown: Array<{ label: string; count: number; unitCostStt: number; totalCostStt: number }>;
  note: string;
}

export interface WorldZone {
  id: string;
  compiledId?: string;
  name: string;
  dangerLevel: number;
  controller: string;
  climate: string;
  allocationPercent?: number;
  latestDecision?: string;
  entities: string[];
}

export interface WorldFaction {
  id?: string;
  name: string;
  morale: number;
  moraleDelta?: number;
  narrative?: string;
  allocationPercent?: number;
  memberCount: number;
}

export interface WorldState extends WorldSummary {
  weeklySpend: string;
  estimatedRunway: string;
  zones: WorldZone[];
  factions: WorldFaction[];
  lastUpdated: string;
}

export interface TriggerSummary {
  id: string;
  worldId: string;
  name: string;
  feedType: FeedType;
  triggerType?: TriggerType;
  conditionLabel: string;
  agentName: string;
  executionLane: ExecutionLane;
  cooldownMs: number;
  isActive: boolean;
  lastFiredAt?: string | null;
  graphNodeId?: string;
  chain?: string[];
  inputParser?: string;
  isStartTrigger?: boolean;
  graphPosition?: { x: number; y: number };
  sourceConfig?: TriggerSourceConfig;
  typeConfig?: TriggerTypeConfig;
  outputMapping?: TriggerOutputMapping[];
  nextTriggerIds?: string[];
  decisionContinuations?: TriggerDecisionContinuation[];
}

export interface EventLog {
  id: string;
  worldId: string;
  type: 'agent_decision' | 'chronicle_entry' | 'zone_updated' | 'trigger_fired';
  title: string;
  description: string;
  timestamp: string;
  agentId?: string;
  cost?: string;
  receiptId?: string;
  transactionHash?: string;
}

export interface ReceiptDetails {
  id: string;
  consensusStatus: 'pending' | 'agreed' | 'failed';
  request: string;
  result: string;
  validators: Array<{ address: string; status: 'Match' | 'Pending' | 'Failed' }>;
  explorerUrl: string;
}

export interface WorldBuilderSecretRef {
  key: string;
  description?: string;
}

export interface WorldBuilderDataSource {
  id: string;
  name: string;
  type: 'json' | 'weather' | 'route_graph' | 'route_plan' | 'route_progress' | 'custom';
  url?: string;
  method?: 'GET' | 'POST';
  requestBodyTemplate?: string;
  secretRefs?: WorldBuilderSecretRef[];
  sampleResponse?: unknown;
}

export interface WorldBuilderInputField {
  id: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'json';
  required: boolean;
  defaultValue?: string | number;
  options?: Array<{ label: string; value: string }>;
}

export interface WorldBuilderAgentStep {
  id: string;
  name: string;
  agentType: AgentType;
  stepType?: 'agent' | 'tool';
  agentId?: string;
  toolId?: string;
  toolSlug?: string;
  toolEndpointUrl?: string | null;
  purpose: string;
  inputTemplate: string;
  contextTemplate?: string;
  urlTemplate?: string;
  selector?: string;
  resultAlias?: string;
  toolInputTemplate?: string;
  consumePreviousOutput?: boolean;
  outputSchema?: Record<string, unknown>;
  persistResult?: boolean;
}

export interface RuntimeTimelineItem {
  id: string;
  kind: string;
  status: string;
  severity: 'info' | 'success' | 'warning' | 'error';
  createdAt: string;
  title: string;
  summary: string;
  worldId: string;
  transactionHash?: string;
  transactionUrl?: string;
  requestId?: string;
  receiptUrl?: string;
  triggerId?: string;
  stepIndex?: number;
  agentKind?: string;
  details?: Record<string, unknown>;
  raw?: unknown;
  costStt?: number;
}

export interface WorldBuilderRuntimeSection {
  id: string;
  title: string;
  kind: 'summary' | 'table' | 'timeline' | 'json' | 'agent_response' | 'receipt_list' | 'graph' | 'event_log' | 'manual_actions';
  source: string;
}

export interface WorldBuilderZone {
  id: string;
  name: string;
  description?: string;
  allocationPercent?: number;
  state?: Record<string, unknown>;
}

export interface WorldBuilderFaction {
  id: string;
  name: string;
  description?: string;
  allocationPercent?: number;
  state?: Record<string, unknown>;
}

export interface WorldBuilderTrigger {
  id: string;
  name: string;
  type: TriggerType;
  sourceId?: string;
  condition?: Record<string, unknown>;
  agentChain: string[];
  isActive: boolean;
  sourceConfig?: TriggerSourceConfig;
  typeConfig?: TriggerTypeConfig;
  inputParser?: string;
  conditionLabel?: string;
  executionLane?: ExecutionLane;
  cooldownMs?: number;
  graphPosition?: { x: number; y: number };
  outputMapping?: TriggerOutputMapping[];
  nextTriggerIds?: string[];
}

export interface WorldBuilderManualAction {
  id: string;
  label: string;
  description?: string;
  triggerId?: string;
  inputOverrides?: Record<string, unknown>;
  ownerOnly: boolean;
}

export interface WorldBuilderGraphNode {
  id: string;
  type: 'input' | 'dataSource' | 'agent' | 'zone' | 'faction' | 'trigger' | 'event' | 'manualAction';
  label: string;
  refId?: string;
  position?: { x: number; y: number };
}

export interface WorldBuilderGraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  weightPercent?: number;
  priorityPercent?: number;
}

export interface WorldBuilderGraph {
  nodes: WorldBuilderGraphNode[];
  edges: WorldBuilderGraphEdge[];
}

export interface WorldBuilderConfig {
  uiSlug: string;
  displayName: string;
  description: string;
  version: string;
  engine?: WorldRuntimeEngineKey;
  publicTypes: Record<string, unknown>;
  inputSchema: WorldBuilderInputField[];
  dataSources: WorldBuilderDataSource[];
  agentChain: WorldBuilderAgentStep[];
  zones?: WorldBuilderZone[];
  factions?: WorldBuilderFaction[];
  triggers?: WorldBuilderTrigger[];
  manualActions?: WorldBuilderManualAction[];
  graph?: WorldBuilderGraph;
  runtimeLayout: WorldBuilderRuntimeSection[];
  statusPolicy: {
    runningStatus: WorldStatus;
    stoppedStatus: Extract<WorldStatus, 'stopped'>;
    restartRequiresFreshInputs: boolean;
  };
  secrets: WorldBuilderSecretRef[];
  lastPublishedAt?: string | null;
  config?: Record<string, unknown>;
}

export interface WorldRuntimeEvent {
  id: string;
  type: EventLog['type'] | 'manual_action' | 'runtime_run';
  title: string;
  description: string;
  timestamp: string;
  receiptId?: string;
}

export interface WorldRuntimeRun {
  id: string;
  actionId: string;
  engine: WorldRuntimeEngineKey;
  status: 'pending' | 'complete' | 'stopped' | 'failed';
  inputs: Record<string, unknown>;
  summary: Record<string, unknown>;
  agentResponses: AgentExecutionRecord[];
  events: WorldRuntimeEvent[];
  receipts: Array<{ id: string; url: string; label: string }>;
  graph: WorldBuilderGraph;
  worldState: Record<string, unknown>;
  createdAt: string;
}

export interface WorldRuntimeMetadata {
  world: WorldSummary;
  builder: WorldBuilderConfig;
  publicState: Record<string, unknown>;
  balance: string;
  deployment?: WorldDeploymentRecord | null;
  costEstimate?: RuntimeCostEstimate | null;
  contract?: { address: string; addressUrl: string; hasCode: boolean } | null;
  capabilities: {
    canEdit: boolean;
    canRunManualActions: boolean;
    isOwner: boolean;
  };
  triggers: TriggerSummary[];
  latestRun?: WorldRuntimeRun | null;
  latestActivityAt?: string | null;
  latestActivityKind?: string | null;
  latestActivitySummary?: string | null;
}

export type CargoGuardDecision = 'CONTINUE_ROUTE' | 'REROUTE' | 'STOP_WORLD';

export interface CargoPort {
  id: string;
  name: string;
  country: string;
  latitude: number;
  longitude: number;
}

export interface CargoWaypoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  kind: 'port' | 'waypoint' | 'chokepoint';
}

export interface CargoRouteEdge {
  id: string;
  from: string;
  to: string;
  lane: string;
  distanceNm: number;
  zoneId: string;
  riskBias: number;
}

export interface CargoRouteGraph {
  version: string;
  ports: CargoPort[];
  waypoints: CargoWaypoint[];
  edges: CargoRouteEdge[];
}

export interface CargoRouteLeg {
  edgeId: string;
  from: CargoWaypoint;
  to: CargoWaypoint;
  lane: string;
  zoneId: string;
  distanceNm: number;
}

export interface CargoRoutePlan {
  routeId: string;
  startPortId: string;
  destinationPortId: string;
  speedKnots: number;
  totalDistanceNm: number;
  stopovers: string[];
  legs: CargoRouteLeg[];
  projectedPoints: ForecastPoint[];
  alternatives?: CargoRoutePlan[];
  progress?: CargoRouteProgress;
}

export interface ForecastPoint {
  hourOffset: number;
  latitude: number;
  longitude: number;
  distanceFromStartNm: number;
  lane: string;
  zoneId: string;
}

export interface CargoRouteProgress {
  routeId: string;
  hoursAhead: number;
  distanceTravelledNm: number;
  remainingDistanceNm: number;
  currentSegment: CargoRouteLeg;
  projectedPosition: ForecastPoint;
  nextStop: CargoWaypoint;
  etaHours: number;
  arrivalProgress: number;
  arrived: boolean;
}

export interface WeatherSample {
  hourOffset: number;
  latitude: number;
  longitude: number;
  temperatureC10: number;
  windKmh10: number;
  precipitationMm10: number;
  weatherCode: number;
  sampleTimeUtc: string;
  source: string;
}

export interface RiskAssessment {
  aggregateRisk: number;
  dangerous: boolean;
  decision: CargoGuardDecision;
  reason: string;
  pointRisks: Array<{
    hourOffset: number;
    risk: number;
    reason: string;
  }>;
}

export interface AgentExecutionRecord {
  id: string;
  name: string;
  agentType: AgentType;
  request: unknown;
  response: unknown;
  receiptUrl?: string;
  status: 'pending' | 'complete' | 'failed';
}

export interface CargoRerouteAttempt {
  attempt: number;
  route: CargoRoutePlan;
  weatherSamples: WeatherSample[];
  riskAssessment: RiskAssessment;
  agentResponses: AgentExecutionRecord[];
}

export interface CargoGuardSimulationRun {
  id: string;
  status: 'idle' | 'running' | 'stopped' | 'complete';
  startPortId: string;
  destinationPortId: string;
  speedKnots: number;
  maxAttempts: number;
  attempts: CargoRerouteAttempt[];
  finalDecision: CargoGuardDecision;
  createdAt: string;
  completedAt?: string;
}
