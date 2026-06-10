import type {
  EventLog,
  ReceiptDetails,
  TemplateSummary,
  TriggerSummary,
  WorldState,
  WorldSummary,
} from './types';
export { officialSdkAgents as demoAgents } from './sdk-agents';

export const DEMO_NOW = '2026-06-02T10:00:00.000Z';
export const DEMO_WORLD_ADDRESS = '0x747F6b3afb75eA2D1e4c74540f11E8518Fc80162';

export const demoTemplates: TemplateSummary[] = [
  {
    id: 'cargo-climate-guard',
    slug: 'cargo-climate-guard',
    name: 'Cargo Climate Guard',
    author: 'REVERIE Official',
    downloads: '220',
    tags: ['Supply Chain', 'Weather', 'Live Checks'],
    description: 'Sea-route weather system with rerouting, 5-hour public JSON weather samples, and STOP_WORLD behavior for unsafe realtime routes.',
    features: ['Route graph JSON', '5 hour forecast', 'STOP_WORLD runtime'],
    category: 'supply_chain',
    featured: true,
  },
  {
    id: 'global-climate-crisis-response',
    slug: 'global-climate-crisis-response',
    name: 'Global Climate Crisis Response',
    author: 'REVERIE Official',
    downloads: '140',
    tags: ['Weather', 'Crisis', 'Zones'],
    description: 'Weather-triggered crisis response world with regional zones, agency factions, Chronicle logs, and receipts.',
    features: ['Weather data source', 'Manual crisis trigger', 'Zone and faction graph'],
    category: 'insurance',
    featured: true,
  },
  {
    id: 'crypto-market-intelligence',
    slug: 'crypto-market-intelligence',
    name: 'Crypto Market Intelligence Arena',
    author: 'REVERIE Official',
    downloads: '118',
    tags: ['DeFi', 'Risk', 'Market'],
    description: 'Token-price risk world with strategy factions, market-scan triggers, Chronicle entries, and receipts.',
    features: ['Token price source', 'Risk faction graph', 'Manual market scan'],
    category: 'defi_automation',
    featured: true,
  },
  {
    id: 'sports-prediction-league',
    slug: 'sports-prediction-league',
    name: 'Sports Prediction League',
    author: 'REVERIE Official',
    downloads: '104',
    tags: ['Sports', 'Prediction', 'Chronicle'],
    description: 'Prepared sports prediction world with locked predictions, result settlement, team morale, and Chronicle receipts.',
    features: ['Prepared match feed', 'Prediction lock', 'Settlement trigger'],
    category: 'prediction_market',
    featured: true,
  },
  {
    id: 'living-kingdom-lite',
    slug: 'living-kingdom-lite',
    name: 'Living Kingdom Lite',
    author: 'REVERIE Official',
    downloads: '96',
    tags: ['Gaming', 'Factions', 'Chronicle'],
    description: 'Fantasy world template with zones, factions, manual quest events, conflict resolution, and Chronicle updates.',
    features: ['Quest action', 'Faction graph', 'Chronicle runtime'],
    category: 'gaming',
    featured: true,
  },
];

export const demoWorlds: WorldSummary[] = [
  {
    id: 'glitchwoods',
    name: 'Cargo Climate Guard Earth',
    contractAddress: DEMO_WORLD_ADDRESS,
    template: 'Cargo Climate Guard',
    templateSlug: 'cargo-climate-guard',
    status: 'running',
    balance: '1.45 STT',
    activeAgents: 6,
    createdAt: '2026-05-31T10:00:00.000Z',
  },
];

export function formatWorldName(id: string): string {
  return id.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

export function getDemoWorldState(worldId: string): WorldState {
  const world = demoWorlds.find((item) => item.id === worldId || item.contractAddress.toLowerCase() === worldId.toLowerCase()) ?? {
    ...demoWorlds[0],
    id: worldId,
    name: formatWorldName(worldId),
  };

  return {
    ...world,
    weeklySpend: '0.3 STT',
    estimatedRunway: '~14 days',
    lastUpdated: DEMO_NOW,
    zones: [
      { id: 'z1', name: 'Northern Frontier', dangerLevel: 75, controller: 'Faction A', climate: 'Heavy Mist', entities: ['Knight1', 'Merchant2'] },
      { id: 'z2', name: 'Eastern Marshes', dangerLevel: 40, controller: 'Neutral', climate: 'Drizzle', entities: ['Trader3'] },
      { id: 'z3', name: 'Southern Wastes', dangerLevel: 90, controller: 'Faction B', climate: 'Storm', entities: [] },
    ],
    factions: [
      { name: 'Faction A', morale: 82, memberCount: 45 },
      { name: 'Faction B', morale: 61, memberCount: 32 },
      { name: 'Neutral', morale: 70, memberCount: 23 },
    ],
  };
}

export const demoTriggers: TriggerSummary[] = [
  {
    id: 'weather-climate',
    worldId: 'glitchwoods',
    name: 'Weather to Zone Climate',
    feedType: 'weather',
    conditionLabel: 'IF temperature < 10C',
    agentName: 'Zone Climate',
    executionLane: 'sdk',
    cooldownMs: 300_000,
    isActive: true,
    lastFiredAt: '2026-06-02T09:58:00.000Z',
  },
  {
    id: 'market-morale',
    worldId: 'glitchwoods',
    name: 'Market Shock Morale',
    feedType: 'token_price',
    conditionLabel: 'IF STT volatility > 8%',
    agentName: 'Faction Morale',
    executionLane: 'onchain',
    cooldownMs: 900_000,
    isActive: true,
    lastFiredAt: '2026-06-02T09:45:00.000Z',
  },
];

export const demoEvents: EventLog[] = [
  {
    id: 'evt-zone',
    worldId: 'glitchwoods',
    type: 'zone_updated',
    title: 'Glitchwoods Expanding',
    description: 'New cryptographic flora identified in sector 7G. Danger level increased.',
    timestamp: '2026-06-02T09:58:00.000Z',
  },
  {
    id: 'evt-climate',
    worldId: 'glitchwoods',
    type: 'agent_decision',
    title: 'Consensus Reached: Climate Shift',
    description: 'Zone Climate evaluated the weather feed and updated local parameters.',
    timestamp: '2026-06-02T09:45:00.000Z',
    agentId: 'zone-climate',
    cost: '0.24 STT',
    receiptId: '0xabc123',
    transactionHash: '0xabc123',
  },
  {
    id: 'evt-trigger',
    worldId: 'glitchwoods',
    type: 'trigger_fired',
    title: 'Weather Trigger Activated',
    description: 'Temperature dropped below the configured threshold.',
    timestamp: '2026-06-02T09:44:00.000Z',
  },
];

export function getDemoReceipt(receiptId: string): ReceiptDetails {
  return {
    id: receiptId,
    consensusStatus: 'agreed',
    request: 'inferString("Update the Zone Climate narrative from the latest weather trigger.")',
    result: 'The northern frontier shifts into heavy mist; travel risk increases for low-morale factions.',
    validators: [
      { address: '0x123...abc', status: 'Match' },
      { address: '0x456...def', status: 'Match' },
      { address: '0x789...ghi', status: 'Match' },
    ],
    explorerUrl: `https://agents.testnet.somnia.network/receipts/${receiptId}`,
  };
}
