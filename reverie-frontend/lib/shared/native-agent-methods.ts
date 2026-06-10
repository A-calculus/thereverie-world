import type { AgentType } from './types';

export type NativeAgentKind = 'llm' | 'json' | 'web';

export type NativeMethod =
  | 'inferString'
  | 'inferNumber'
  | 'inferChat'
  | 'inferToolsChat'
  | 'fetchString'
  | 'fetchUint'
  | 'fetchInt'
  | 'fetchBool'
  | 'fetchStringArray'
  | 'fetchUintArray'
  | 'ExtractString'
  | 'ExtractANumber';

export interface NativeAgentPrimitive {
  kind: NativeAgentKind;
  agentType: AgentType;
  title: string;
  agentId: string;
  deposit: string;
  description: string;
  methods: NativeMethod[];
}

export const nativeAgentPrimitives: Record<NativeAgentKind, NativeAgentPrimitive> = {
  llm: {
    kind: 'llm',
    agentType: 'native_llm',
    title: 'LLM Inference',
    agentId: '12847293847561029384',
    deposit: '0.24 STT',
    description: 'Qwen3-30B inference for text, bounded numbers, chat, and tool chat.',
    methods: ['inferString', 'inferNumber', 'inferChat', 'inferToolsChat'],
  },
  json: {
    kind: 'json',
    agentType: 'native_json_api',
    title: 'JSON API Request',
    agentId: '13174292974160097713',
    deposit: '0.12 STT',
    description: 'Fetch public JSON endpoints and extract values using selector paths.',
    methods: ['fetchString', 'fetchUint', 'fetchInt', 'fetchBool', 'fetchStringArray', 'fetchUintArray'],
  },
  web: {
    kind: 'web',
    agentType: 'native_web_parse',
    title: 'LLM Parse Website',
    agentId: '12875401142070969085',
    deposit: '0.33 STT',
    description: 'Search or scrape a URL and extract structured answers with AI.',
    methods: ['ExtractString', 'ExtractANumber'],
  },
};

export const nativeMethodLabels: Record<NativeMethod, string> = {
  inferString: 'Expected text response',
  inferNumber: 'Expected number response',
  inferChat: 'Continuous chat response',
  inferToolsChat: 'MCP/tool-calling chat response',
  fetchString: 'Expected JSON string',
  fetchUint: 'Expected unsigned JSON number',
  fetchInt: 'Expected signed JSON number',
  fetchBool: 'Expected JSON boolean',
  fetchStringArray: 'Expected JSON string array',
  fetchUintArray: 'Expected JSON unsigned number array',
  ExtractString: 'Expected website text extraction',
  ExtractANumber: 'Expected website number extraction',
};

export const defaultNativeMethod: Record<NativeAgentKind, NativeMethod> = {
  llm: 'inferString',
  json: 'fetchString',
  web: 'ExtractString',
};

export const nativeAgentKinds = Object.keys(nativeAgentPrimitives) as NativeAgentKind[];

export function methodBelongsToKind(kind: NativeAgentKind, method: NativeMethod): boolean {
  return nativeAgentPrimitives[kind].methods.includes(method);
}
