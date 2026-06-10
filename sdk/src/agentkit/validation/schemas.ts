import { z } from "zod";

export const MIN_AGENT_TIMEOUT_MS = 300_000;

export const EthAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Must be a valid Ethereum address");

export const PrivateKey = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "Must be a valid private key");

const BigIntLike = z
  .union([z.bigint(), z.number().int(), z.string().regex(/^-?\d+$/)])
  .transform((value) => BigInt(value));
const NonNegativeBigIntLike = BigIntLike.refine((value) => value >= 0n, {
  message: "Must be nonnegative",
});
const PositiveBigIntLike = BigIntLike.refine((value) => value > 0n, {
  message: "Must be positive",
});

export const AgentRequestOptionsSchema = z
  .object({
    consensusType: z.enum(["majority", "threshold"]).optional(),
    threshold: PositiveBigIntLike.optional(),
    subcommitteeSize: PositiveBigIntLike.optional(),
    depositBuffer: NonNegativeBigIntLike.optional(),
    timeoutMs: z.number().int().min(MIN_AGENT_TIMEOUT_MS).optional(),
  })
  .strict();

export type AgentRequestOptions = z.infer<typeof AgentRequestOptionsSchema>;

export const SdkConfigSchema = z
  .object({
    network: z.literal("testnet"),
    callbackReceiverAddress: EthAddress.optional(),
    callbackReceiverLlm: EthAddress.optional(),
    callbackReceiverPrimary: EthAddress.optional(),
    privateKey: PrivateKey.optional(),
    walletClient: z.unknown().optional(),
    account: z.unknown().optional(),
    rpcUrl: z.string().url().optional(),
    wsUrl: z.string().url().optional(),
    timeoutMs: z.number().int().min(MIN_AGENT_TIMEOUT_MS).default(MIN_AGENT_TIMEOUT_MS),
    subcommitteeSize: z.bigint().positive().optional(),
    consensusType: z.enum(["majority", "threshold"]).optional(),
    threshold: z.bigint().positive().optional(),
    depositBuffer: z.bigint().nonnegative().optional(),
  })
  .strict();

export type SdkConfig = z.infer<typeof SdkConfigSchema>;

const withAgentOpts = AgentRequestOptionsSchema.partial();

const Role = z.string().min(1);
function requireSameLength(
  value: { roles: string[]; messages: string[] },
  ctx: z.RefinementCtx
) {
  if (value.roles.length !== value.messages.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "roles and messages must have the same length",
      path: ["messages"],
    });
  }
}

export const LLMInferStringOptionsSchema = z
  .object({
    method: z.literal("inferString").default("inferString"),
    prompt: z.string().min(1).max(4096),
    systemPrompt: z.string().max(2048).optional(),
    chainOfThought: z.boolean().default(false),
    allowedValues: z.array(z.string()).default([]),
  })
  .merge(withAgentOpts)
  .strict();

export const LLMInferNumberOptionsSchema = z
  .object({
    method: z.literal("inferNumber"),
    prompt: z.string().min(1).max(4096),
    systemPrompt: z.string().max(2048).optional(),
    minValue: BigIntLike,
    maxValue: BigIntLike,
    chainOfThought: z.boolean().default(false),
  })
  .merge(withAgentOpts)
  .strict()
  .superRefine((value, ctx) => {
    if (value.minValue > value.maxValue) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "minValue must be less than or equal to maxValue",
        path: ["minValue"],
      });
    }
  });

export const LLMInferChatOptionsSchema = z
  .object({
    method: z.literal("inferChat"),
    roles: z.array(Role).min(1),
    messages: z.array(z.string()).min(1),
    chainOfThought: z.boolean().default(false),
  })
  .merge(withAgentOpts)
  .strict()
  .superRefine(requireSameLength);

export const OnchainToolSchema = z
  .object({
    signature: z.string().min(1),
    description: z.string().min(1),
  })
  .strict();

export const LLMInferToolsChatOptionsSchema = z
  .object({
    method: z.literal("inferToolsChat"),
    roles: z.array(Role).min(1),
    messages: z.array(z.string()).min(1),
    mcpServerUrls: z.array(z.string().min(1)).default([]),
    onchainTools: z.array(OnchainToolSchema).default([]),
    maxIterations: PositiveBigIntLike.default(5n),
    chainOfThought: z.boolean().default(false),
  })
  .merge(withAgentOpts)
  .strict()
  .superRefine(requireSameLength);

export const LLMOptionsSchema = z.union([
  LLMInferStringOptionsSchema,
  LLMInferNumberOptionsSchema,
  LLMInferChatOptionsSchema,
  LLMInferToolsChatOptionsSchema,
]);

export type LLMInferStringOptions = z.infer<typeof LLMInferStringOptionsSchema>;
export type LLMInferNumberOptions = z.infer<typeof LLMInferNumberOptionsSchema>;
export type LLMInferChatOptions = z.infer<typeof LLMInferChatOptionsSchema>;
export type LLMInferToolsChatOptions = z.infer<typeof LLMInferToolsChatOptionsSchema>;
export type LLMOptions = z.infer<typeof LLMOptionsSchema>;

const JsonApiBase = z.object({
  url: z.string().url(),
  selector: z.string().min(1),
  returnType: z
    .enum(["string", "uint", "int", "bool", "stringArray", "uintArray"])
    .optional(),
});

const JsonApiMethodSchema = z.discriminatedUnion("method", [
  JsonApiBase.extend({
    method: z.literal("fetchString"),
  })
    .merge(withAgentOpts)
    .strict(),
  JsonApiBase.extend({
    method: z.literal("fetchUint"),
    decimals: z.number().int().min(0).max(18).default(8),
  })
    .merge(withAgentOpts)
    .strict(),
  JsonApiBase.extend({
    method: z.literal("fetchInt"),
    decimals: z.number().int().min(0).max(18).default(8),
  })
    .merge(withAgentOpts)
    .strict(),
  JsonApiBase.extend({
    method: z.literal("fetchBool"),
  })
    .merge(withAgentOpts)
    .strict(),
  JsonApiBase.extend({
    method: z.literal("fetchStringArray"),
  })
    .merge(withAgentOpts)
    .strict(),
  JsonApiBase.extend({
    method: z.literal("fetchUintArray"),
    decimals: z.number().int().min(0).max(18).default(8),
  })
    .merge(withAgentOpts)
    .strict(),
]);

const returnTypeToJsonMethod = {
  string: "fetchString",
  uint: "fetchUint",
  int: "fetchInt",
  bool: "fetchBool",
  stringArray: "fetchStringArray",
  uintArray: "fetchUintArray",
} as const;

export const JsonApiOptionsSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const value = raw as Record<string, unknown>;
  if (typeof value.method === "string") return raw;
  const returnType = value.returnType as keyof typeof returnTypeToJsonMethod | undefined;
  return {
    ...value,
    method: returnType ? returnTypeToJsonMethod[returnType] : "fetchString",
  };
}, JsonApiMethodSchema);

export type JsonApiOptions = z.infer<typeof JsonApiOptionsSchema>;

const WebParseBase = z
  .object({
    method: z.enum(["ExtractString", "ExtractANumber"]).optional(),
    url: z.string().min(1),
    description: z.string().min(1).max(512),
    key: z.string().min(1).max(64).default("result"),
    prompt: z.string().min(1).max(1024),
    resolveUrl: z.boolean().default(false),
    numPages: z.number().int().min(1).max(5).default(1),
    confidenceThreshold: z.number().int().min(0).max(100).default(60),
  });

export const WebParseStringOptionsSchema = WebParseBase.extend({
  method: z.literal("ExtractString").default("ExtractString"),
  options: z.array(z.string()).default([]),
})
  .merge(withAgentOpts)
  .strict();

export const WebParseNumberOptionsSchema = WebParseBase.extend({
  method: z.literal("ExtractANumber"),
  min: NonNegativeBigIntLike.default(0n),
  max: NonNegativeBigIntLike.default(0n),
})
  .merge(withAgentOpts)
  .strict()
  .superRefine((value, ctx) => {
    if (value.max !== 0n && value.min > value.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "min must be less than or equal to max unless max is 0",
        path: ["min"],
      });
    }
  });

export const WebParseOptionsSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const value = raw as Record<string, unknown>;
  return {
    ...value,
    method: value.method ?? "ExtractString",
  };
}, z.union([WebParseNumberOptionsSchema, WebParseStringOptionsSchema]));

export type WebParseStringOptions = z.infer<typeof WebParseStringOptionsSchema>;
export type WebParseNumberOptions = z.infer<typeof WebParseNumberOptionsSchema>;
export type WebParseOptions = z.infer<typeof WebParseOptionsSchema>;
