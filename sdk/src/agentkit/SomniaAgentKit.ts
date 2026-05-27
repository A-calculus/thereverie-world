import {
  createPublicClient,
  createWalletClient,
  http,
  custom,
  encodeFunctionData,
  decodeAbiParameters,
  type PublicClient,
  type WalletClient,
  type Account,
  type Transport,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { somniaTestnet } from "../constants.js";
import {
  getCallbackReceiverAddress,
  getDefaultSubcommitteeSize,
  getDefaultConfidenceThreshold,
} from "./contracts/addresses.js";
import {
  SdkConfigSchema,
  LLMOptionsSchema,
  JsonApiOptionsSchema,
  WebParseOptionsSchema,
  type SdkConfig,
  type AgentRequestOptions,
  type LLMInferStringOptions,
  type LLMInferNumberOptions,
  type LLMInferChatOptions,
  type LLMInferToolsChatOptions,
} from "./validation/schemas.js";
import { WebSocketManager } from "./utils/websocket.js";
import { submitAdvancedRequest, type AdvancedRequestResult } from "./utils/request.js";
import { pollAgentResult, type AgentWaitResult } from "./utils/result.js";
import { decodeStringResult } from "./utils/decode.js";
import {
  SomniaValidationError,
  SomniaWalletError,
  SomniaInsufficientFundsError,
  SomniaAgentFailedError,
} from "./errors.js";

interface AgentExecutionMeta {
  requestId: bigint;
  txHash: `0x${string}`;
  receiptUrl: string;
}

export interface LLMStringResult extends AgentExecutionMeta {
  method: "inferString" | "inferChat";
  text: string;
}

export interface LLMNumberResult extends AgentExecutionMeta {
  method: "inferNumber";
  value: bigint;
}

export interface OnchainTool {
  signature: string;
  description: string;
}

export interface LLMToolsChatResult extends AgentExecutionMeta {
  method: "inferToolsChat";
  finishReason: string;
  response: string;
  updatedRoles: string[];
  updatedMessages: string[];
  pendingToolCallIds: string[];
  pendingToolCalls: `0x${string}`[];
}

export type LLMResult = LLMStringResult | LLMNumberResult | LLMToolsChatResult;

export interface JsonApiResult extends AgentExecutionMeta {
  method:
    | "fetchString"
    | "fetchUint"
    | "fetchInt"
    | "fetchBool"
    | "fetchStringArray"
    | "fetchUintArray";
  value: string | bigint | boolean | string[] | bigint[];
  raw: `0x${string}`;
}

export interface WebParseStringResult extends AgentExecutionMeta {
  method: "ExtractString";
  text: string;
}

export interface WebParseNumberResult extends AgentExecutionMeta {
  method: "ExtractANumber";
  value: bigint;
}

export type WebParseResult = WebParseStringResult | WebParseNumberResult;

type LLMStringCallOptions = {
  method?: "inferString";
  prompt: string;
  systemPrompt?: string;
  chainOfThought?: boolean;
  allowedValues?: string[];
} & Partial<AgentRequestOptions>;
type LLMNumberCallOptions = {
  method: "inferNumber";
  prompt: string;
  systemPrompt?: string;
  minValue: bigint | number | string;
  maxValue: bigint | number | string;
  chainOfThought?: boolean;
} & Partial<AgentRequestOptions>;
type LLMChatCallOptions = {
  method: "inferChat";
  roles: string[];
  messages: string[];
  chainOfThought?: boolean;
} & Partial<AgentRequestOptions>;
type LLMToolsChatCallOptions = {
  method: "inferToolsChat";
  roles: string[];
  messages: string[];
  mcpServerUrls?: string[];
  onchainTools?: OnchainTool[];
  maxIterations?: bigint | number | string;
  chainOfThought?: boolean;
} & Partial<AgentRequestOptions>;

export class SomniaAgentKit {
  private readonly config: SdkConfig;
  private readonly publicClient: PublicClient;
  private readonly wsManagers = new Map<string, WebSocketManager>();
  private readonly defaultSubcommitteeSize: bigint;

  constructor(rawConfig: unknown) {
    const result = SdkConfigSchema.safeParse(rawConfig);
    if (!result.success) {
      throw new SomniaValidationError(
        "Invalid SDK configuration",
        result.error.issues
      );
    }
    this.config = result.data;
    this.defaultSubcommitteeSize =
      this.config.subcommitteeSize ?? getDefaultSubcommitteeSize();

    const rpcUrl =
      this.config.rpcUrl ?? "https://api.infra.testnet.somnia.network";
    this.publicClient = createPublicClient({
      chain: somniaTestnet,
      transport: http(rpcUrl),
    });
  }

  async executeLLM(rawOptions: LLMStringCallOptions): Promise<LLMStringResult>;
  async executeLLM(rawOptions: LLMNumberCallOptions): Promise<LLMNumberResult>;
  async executeLLM(rawOptions: LLMChatCallOptions): Promise<LLMStringResult>;
  async executeLLM(rawOptions: LLMToolsChatCallOptions): Promise<LLMToolsChatResult>;
  async executeLLM(rawOptions: unknown): Promise<LLMResult>;
  async executeLLM(rawOptions: unknown): Promise<LLMResult> {
    const parse = LLMOptionsSchema.safeParse(rawOptions);
    if (!parse.success) {
      throw new SomniaValidationError("Invalid executeLLM options", parse.error.issues);
    }
    const opts = parse.data;
    const callback = this.resolveCallback("llm");
    const payload = this.encodeLLMPayload(opts);

    const { walletClient, account } = await this.getWalletClient(opts);
    const request = await submitAdvancedRequest(
      this.publicClient,
      walletClient,
      account,
      this.buildRequestParams("llm", payload, callback, opts)
    );

    const timeout = opts.timeoutMs ?? this.config.timeoutMs;
    const { result } = await this.waitForAgentResult(request, callback, timeout);
    const meta = {
      requestId: request.requestId,
      txHash: request.txHash,
      receiptUrl: request.receiptUrl,
    };

    if (opts.method === "inferNumber") {
      return {
        method: opts.method,
        value: this.decodeAgentValue<bigint>(result, [{ type: "int256" }]),
        ...meta,
      };
    }

    if (opts.method === "inferToolsChat") {
      const [finishReason, response, updatedRoles, updatedMessages, pendingToolCallIds, pendingToolCalls] =
        this.decodeAgentTuple(result, [
          { type: "string" },
          { type: "string" },
          { type: "string[]" },
          { type: "string[]" },
          { type: "string[]" },
          { type: "bytes[]" },
        ]) as [string, string, string[], string[], string[], `0x${string}`[]];

      return {
        method: opts.method,
        finishReason,
        response,
        updatedRoles,
        updatedMessages,
        pendingToolCallIds,
        pendingToolCalls,
        ...meta,
      };
    }

    return {
      method: opts.method,
      text: this.decodeAgentString(result),
      ...meta,
    };
  }

  async executeJsonApi(rawOptions: unknown): Promise<JsonApiResult> {
    const parse = JsonApiOptionsSchema.safeParse(rawOptions);
    if (!parse.success) {
      throw new SomniaValidationError(
        "Invalid executeJsonApi options",
        parse.error.issues
      );
    }
    const opts = parse.data;
    const callback = this.resolveCallback("jsonApi");

    const needsDecimals =
      opts.method === "fetchUint" ||
      opts.method === "fetchInt" ||
      opts.method === "fetchUintArray";
    const inputs = needsDecimals
      ? [
          { name: "url", type: "string" },
          { name: "selector", type: "string" },
          { name: "decimals", type: "uint8" },
        ]
      : [
          { name: "url", type: "string" },
          { name: "selector", type: "string" },
        ];

    const payload = encodeFunctionData({
      abi: [
        {
          name: opts.method,
          type: "function",
          inputs,
          outputs: [],
          stateMutability: "nonpayable",
        },
      ],
      functionName: opts.method,
      args: needsDecimals
        ? [opts.url, opts.selector, opts.decimals]
        : [opts.url, opts.selector],
    });

    const { walletClient, account } = await this.getWalletClient(opts);
    const request = await submitAdvancedRequest(
      this.publicClient,
      walletClient,
      account,
      this.buildRequestParams("jsonApi", payload, callback, opts)
    );

    const timeout = opts.timeoutMs ?? this.config.timeoutMs;
    const { result } = await this.waitForAgentResult(request, callback, timeout);

    let value: JsonApiResult["value"];
    if (opts.method === "fetchString") {
      value = this.decodeAgentString(result);
    } else if (opts.method === "fetchUint") {
      value = this.decodeAgentValue<bigint>(result, [{ type: "uint256" }]);
    } else if (opts.method === "fetchInt") {
      value = this.decodeAgentValue<bigint>(result, [{ type: "int256" }]);
    } else if (opts.method === "fetchBool") {
      value = this.decodeAgentValue<boolean>(result, [{ type: "bool" }]);
    } else if (opts.method === "fetchStringArray") {
      const [v] = this.decodeAgentTuple(result, [{ type: "string[]" }]) as [string[]];
      value = v;
    } else {
      const [v] = this.decodeAgentTuple(result, [{ type: "uint256[]" }]) as [bigint[]];
      value = v;
    }

    return {
      method: opts.method,
      value,
      raw: result,
      requestId: request.requestId,
      txHash: request.txHash,
      receiptUrl: request.receiptUrl,
    };
  }

  async executeWebParse(rawOptions: unknown): Promise<WebParseResult> {
    const parse = WebParseOptionsSchema.safeParse(rawOptions);
    if (!parse.success) {
      throw new SomniaValidationError(
        "Invalid executeWebParse options",
        parse.error.issues
      );
    }
    const opts = parse.data;
    const confidence =
      opts.confidenceThreshold ?? getDefaultConfidenceThreshold();
    const callback = this.resolveCallback("webParse");

    const payload =
      opts.method === "ExtractANumber"
        ? encodeFunctionData({
            abi: [
              {
                name: "ExtractANumber",
                type: "function",
                inputs: [
                  { name: "key", type: "string" },
                  { name: "description", type: "string" },
                  { name: "min", type: "uint256" },
                  { name: "max", type: "uint256" },
                  { name: "prompt", type: "string" },
                  { name: "url", type: "string" },
                  { name: "resolveUrl", type: "bool" },
                  { name: "numPages", type: "uint8" },
                  { name: "confidenceThreshold", type: "uint8" },
                ],
                outputs: [{ name: "output", type: "uint256" }],
                stateMutability: "nonpayable",
              },
            ],
            functionName: "ExtractANumber",
            args: [
              opts.key,
              opts.description,
              opts.min,
              opts.max,
              opts.prompt,
              opts.url,
              opts.resolveUrl,
              opts.numPages,
              confidence,
            ],
          })
        : encodeFunctionData({
            abi: [
              {
                name: "ExtractString",
                type: "function",
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
                stateMutability: "nonpayable",
              },
            ],
            functionName: "ExtractString",
            args: [
              opts.key,
              opts.description,
              opts.options,
              opts.prompt,
              opts.url,
              opts.resolveUrl,
              opts.numPages,
              confidence,
            ],
          });

    const { walletClient, account } = await this.getWalletClient(opts);
    const request = await submitAdvancedRequest(
      this.publicClient,
      walletClient,
      account,
      this.buildRequestParams("webParse", payload, callback, opts)
    );

    const timeout = opts.timeoutMs ?? this.config.timeoutMs;
    const { result } = await this.waitForAgentResult(request, callback, timeout);

    const meta = {
      requestId: request.requestId,
      txHash: request.txHash,
      receiptUrl: request.receiptUrl,
    };

    if (opts.method === "ExtractANumber") {
      return {
        method: opts.method,
        value: this.decodeAgentValue<bigint>(result, [{ type: "uint256" }]),
        ...meta,
      };
    }

    return {
      method: opts.method,
      text: this.decodeAgentString(result),
      ...meta,
    };
  }

  private encodeLLMPayload(
    opts:
      | LLMInferStringOptions
      | LLMInferNumberOptions
      | LLMInferChatOptions
      | LLMInferToolsChatOptions
  ): `0x${string}` {
    if (opts.method === "inferNumber") {
      return encodeFunctionData({
        abi: [
          {
            name: "inferNumber",
            type: "function",
            inputs: [
              { name: "prompt", type: "string" },
              { name: "system", type: "string" },
              { name: "minValue", type: "int256" },
              { name: "maxValue", type: "int256" },
              { name: "chainOfThought", type: "bool" },
            ],
            outputs: [{ name: "response", type: "int256" }],
            stateMutability: "nonpayable",
          },
        ],
        functionName: "inferNumber",
        args: [
          opts.prompt,
          opts.systemPrompt ?? "You are a helpful assistant.",
          opts.minValue,
          opts.maxValue,
          opts.chainOfThought,
        ],
      });
    }

    if (opts.method === "inferChat") {
      return encodeFunctionData({
        abi: [
          {
            name: "inferChat",
            type: "function",
            inputs: [
              { name: "roles", type: "string[]" },
              { name: "messages", type: "string[]" },
              { name: "chainOfThought", type: "bool" },
            ],
            outputs: [{ name: "response", type: "string" }],
            stateMutability: "nonpayable",
          },
        ],
        functionName: "inferChat",
        args: [opts.roles, opts.messages, opts.chainOfThought],
      });
    }

    if (opts.method === "inferToolsChat") {
      return encodeFunctionData({
        abi: [
          {
            name: "inferToolsChat",
            type: "function",
            inputs: [
              { name: "roles", type: "string[]" },
              { name: "messages", type: "string[]" },
              { name: "mcpServerUrls", type: "string[]" },
              {
                name: "onchainTools",
                type: "tuple[]",
                components: [
                  { name: "signature", type: "string" },
                  { name: "description", type: "string" },
                ],
              },
              { name: "maxIterations", type: "uint256" },
              { name: "chainOfThought", type: "bool" },
            ],
            outputs: [
              { name: "finishReason", type: "string" },
              { name: "response", type: "string" },
              { name: "updatedRoles", type: "string[]" },
              { name: "updatedMessages", type: "string[]" },
              { name: "pendingToolCallIds", type: "string[]" },
              { name: "pendingToolCalls", type: "bytes[]" },
            ],
            stateMutability: "nonpayable",
          },
        ],
        functionName: "inferToolsChat",
        args: [
          opts.roles,
          opts.messages,
          opts.mcpServerUrls,
          opts.onchainTools,
          opts.maxIterations,
          opts.chainOfThought,
        ],
      });
    }

    return encodeFunctionData({
      abi: [
        {
          name: "inferString",
          type: "function",
          inputs: [
            { name: "prompt", type: "string" },
            { name: "system", type: "string" },
            { name: "chainOfThought", type: "bool" },
            { name: "allowedValues", type: "string[]" },
          ],
          outputs: [{ name: "response", type: "string" }],
          stateMutability: "nonpayable",
        },
      ],
      functionName: "inferString",
      args: [
        opts.prompt,
        opts.systemPrompt ?? "You are a helpful assistant.",
        opts.chainOfThought,
        opts.allowedValues,
      ],
    });
  }

  destroy(): void {
    for (const ws of this.wsManagers.values()) {
      ws.destroy();
    }
    this.wsManagers.clear();
  }

  private buildRequestParams(
    agentType: "llm" | "jsonApi" | "webParse",
    payload: `0x${string}`,
    callbackAddress: `0x${string}`,
    opts: AgentRequestOptions
  ) {
    return {
      agentType,
      payload,
      callbackAddress,
      depositBuffer: opts.depositBuffer,
      consensusType: opts.consensusType ?? this.config.consensusType,
      threshold: opts.threshold ?? this.config.threshold,
      subcommitteeSize: opts.subcommitteeSize ?? this.defaultSubcommitteeSize,
      timeoutMs: opts.timeoutMs ?? this.config.timeoutMs,
      rpcUrl: this.config.rpcUrl,
    };
  }

  private resolveCallback(agentType: "llm" | "jsonApi" | "webParse"): `0x${string}` {
    const fromEnv = getCallbackReceiverAddress(agentType);
    if (fromEnv) return fromEnv;

    if (agentType === "llm" && this.config.callbackReceiverLlm) {
      return this.config.callbackReceiverLlm as `0x${string}`;
    }
    if (agentType !== "llm" && this.config.callbackReceiverPrimary) {
      return this.config.callbackReceiverPrimary as `0x${string}`;
    }
    if (this.config.callbackReceiverAddress) {
      return this.config.callbackReceiverAddress as `0x${string}`;
    }

    throw new SomniaValidationError(
      "CallbackReceiver address required. Set CALLBACK_RECEIVER_LLM / CALLBACK_RECEIVER_PRIMARY in .env or pass callbackReceiverAddress in config.",
      []
    );
  }

  private getWsManager(callbackAddress: string): WebSocketManager {
    let ws = this.wsManagers.get(callbackAddress);
    if (!ws) {
      const wsUrl =
        this.config.wsUrl ?? "wss://api.infra.testnet.somnia.network/ws";
      ws = new WebSocketManager(wsUrl, callbackAddress);
      this.wsManagers.set(callbackAddress, ws);
    }
    return ws;
  }

  private async waitForAgentResult(
    request: AdvancedRequestResult,
    callbackAddress: `0x${string}`,
    timeoutMs: number
  ): Promise<AgentWaitResult> {
    const context = {
      requestId: request.requestId,
      timeoutMs,
      txHash: request.txHash,
      receiptUrl: request.receiptUrl,
      callbackAddress,
      platformAddress: request.platformAddress,
      requestBlock: request.requestBlock,
    };

    const wsResult = this.getWsManager(callbackAddress)
      .waitForResult(request.requestId, timeoutMs + 1_000)
      .catch((err) => {
        const code = (err as { code?: string }).code;
        if (code === "TIMEOUT" || code === "WEBSOCKET_ERROR") {
          return new Promise<never>(() => undefined);
        }
        throw err;
      });

    const result = await Promise.race([wsResult, pollAgentResult(this.publicClient, context)]);
    if (!result.success) {
      throw new SomniaAgentFailedError(request.requestId, result.status);
    }
    return result;
  }

  private decodeAgentString(raw: `0x${string}`): string {
    return decodeStringResult(this.unwrapAgentResponse(raw));
  }

  private decodeAgentValue<T>(
    raw: `0x${string}`,
    params: Parameters<typeof decodeAbiParameters>[0]
  ): T {
    const [value] = this.decodeAgentTuple(raw, params);
    return value as T;
  }

  private decodeAgentTuple(
    raw: `0x${string}`,
    params: Parameters<typeof decodeAbiParameters>[0]
  ): readonly unknown[] {
    return decodeAbiParameters(params, this.unwrapAgentResponse(raw));
  }

  private unwrapAgentResponse(raw: `0x${string}`): `0x${string}` {
    try {
      const [responses] = decodeAbiParameters(
        [
          {
            type: "tuple[]",
            components: [
              { name: "validator", type: "address" },
              { name: "result", type: "bytes" },
              { name: "status", type: "uint8" },
              { name: "receipt", type: "uint256" },
              { name: "timestamp", type: "uint256" },
              { name: "executionCost", type: "uint256" },
            ],
          },
        ],
        raw
      );
      if (Array.isArray(responses) && responses.length > 0) {
        const first = responses[0] as { result: `0x${string}` };
        return first.result;
      }
    } catch {
      /* fall through */
    }
    return raw;
  }

  private async getWalletClient(
    opts: AgentRequestOptions
  ): Promise<{ walletClient: WalletClient<Transport, Chain, Account>; account: Account }> {
    const depositBuffer = (opts.depositBuffer ?? 0n) + 1n; // balance check uses min 1 wei placeholder

    if (this.config.privateKey) {
      const account = privateKeyToAccount(this.config.privateKey as `0x${string}`);
      const balance = await this.publicClient.getBalance({
        address: account.address,
      });
      if (balance < depositBuffer) {
        throw new SomniaInsufficientFundsError(depositBuffer, balance);
      }
      const walletClient = createWalletClient({
        account,
        chain: somniaTestnet,
        transport: http(
          this.config.rpcUrl ?? "https://api.infra.testnet.somnia.network"
        ),
      });
      return { walletClient, account };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ethereum = (globalThis as any).ethereum;
    if (!ethereum) {
      throw new SomniaWalletError(
        "No wallet detected. Provide privateKey for Node.js or use a browser wallet."
      );
    }

    const accounts = (await ethereum.request({
      method: "eth_requestAccounts",
    })) as string[];
    if (!accounts[0]) throw new SomniaWalletError("No accounts from wallet");

    const account = { address: accounts[0] as `0x${string}` } as Account;
    const walletClient = createWalletClient({
      account,
      chain: somniaTestnet,
      transport: custom(ethereum),
    }) as WalletClient<Transport, Chain, Account>;

    return { walletClient, account };
  }
}
