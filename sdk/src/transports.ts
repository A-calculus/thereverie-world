import {
  createPublicClient,
  fallback,
  http,
  webSocket,
  type PublicClient,
  type Transport,
} from "viem";
import { somniaTestnet } from "./constants.js";
import { logWssTransportError } from "./logger.js";

export const DEFAULT_RPC_URL = "https://api.infra.testnet.somnia.network";
export const DEFAULT_WS_URL = "wss://api.infra.testnet.somnia.network/ws";

type EnvShape = {
  process?: {
    env?: Record<string, string | undefined>;
  };
};

function envVar(key: string): string | undefined {
  return (globalThis as EnvShape).process?.env?.[key];
}

export function resolveRpcUrl(rpcUrl?: string): string {
  return rpcUrl ?? envVar("SOMNIA_RPC_URL") ?? DEFAULT_RPC_URL;
}

export function resolveWsUrl(wsUrl?: string): string {
  return wsUrl ?? envVar("SOMNIA_WS_URL") ?? DEFAULT_WS_URL;
}

function wssEnabled(wsUrl?: string): boolean {
  const explicit = envVar("SOMNIA_ENABLE_WSS");
  if (explicit === "0" || explicit === "false") return false;
  if (explicit === "1" || explicit === "true") return true;
  return Boolean(wsUrl);
}

export function createSdkPublicTransport(params: {
  rpcUrl?: string;
  wsUrl?: string;
} = {}): Transport {
  const httpTransport = http(resolveRpcUrl(params.rpcUrl), {
    key: "worldframe-http",
    name: "WorldFrame HTTP",
  });
  if (!wssEnabled(params.wsUrl)) return httpTransport;

  const wssTransport = withWssErrorLogging(
    webSocket(resolveWsUrl(params.wsUrl), {
      key: "worldframe-wss",
      name: "WorldFrame WSS",
      retryCount: 2,
    })
  );

  return fallback([wssTransport, httpTransport], { retryCount: 0 });
}

export function createSdkPublicClient(params: {
  rpcUrl?: string;
  wsUrl?: string;
} = {}): PublicClient {
  return createPublicClient({
    chain: somniaTestnet,
    transport: createSdkPublicTransport(params),
  }) as PublicClient;
}

function withWssErrorLogging(transport: Transport): Transport {
  let disabled = false;

  return ((params) => {
    const inner = transport(params);
    return {
      ...inner,
      request: async (args) => {
        if (disabled) {
          throw new Error("WSS disabled after prior transport failure");
        }
        try {
          return await inner.request(args);
        } catch (error) {
          disabled = true;
          logWssTransportError({
            method: args.method,
            transportKey: "worldframe-wss",
            transportName: "WorldFrame WSS",
            error,
          });
          throw error;
        }
      },
    };
  }) as Transport;
}
