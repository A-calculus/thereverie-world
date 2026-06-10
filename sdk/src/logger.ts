type SafeLogContext = {
  method?: string;
  transportKey?: string;
  transportName?: string;
  error?: unknown;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function warn(message: string, context: SafeLogContext): void {
  console.warn(`[WorldFrame SDK] ${message}`, {
    method: context.method,
    transportKey: context.transportKey,
    transportName: context.transportName,
    error: context.error === undefined ? undefined : errorMessage(context.error),
  });
}

export function logWssTransportError(context: SafeLogContext): void {
  warn("WSS transport error; falling back to HTTP", context);
}

export function logCallbackWssError(context: SafeLogContext): void {
  warn("Callback WSS error; waiting via HTTP polling", context);
}
