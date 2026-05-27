export class SomniaError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "SomniaError";
  }
}

export class SomniaValidationError extends SomniaError {
  constructor(
    message: string,
    public readonly issues: unknown[]
  ) {
    super(message, "VALIDATION_ERROR");
    this.name = "SomniaValidationError";
  }
}

export class SomniaTimeoutError extends SomniaError {
  constructor(
    public readonly requestId: bigint,
    public readonly timeoutMs: number,
    public readonly context?: {
      txHash?: `0x${string}`;
      receiptUrl?: string;
      callbackAddress?: `0x${string}`;
    }
  ) {
    super(`Agent request ${requestId} timed out after ${timeoutMs}ms`, "TIMEOUT");
    this.name = "SomniaTimeoutError";
  }
}

export class SomniaAgentFailedError extends SomniaError {
  constructor(
    public readonly requestId: bigint,
    public readonly status?: number
  ) {
    super(`Agent request ${requestId} failed`, "AGENT_FAILED");
    this.name = "SomniaAgentFailedError";
  }
}

export class SomniaCallbackDeliveryError extends SomniaError {
  constructor(
    public readonly requestId: bigint,
    public readonly platformStatus: number,
    public readonly context: {
      txHash: `0x${string}`;
      callbackAddress: `0x${string}`;
    }
  ) {
    super(
      `Agent request ${requestId} finalized with status ${platformStatus}, but no callback result was stored`,
      "CALLBACK_DELIVERY_FAILED"
    );
    this.name = "SomniaCallbackDeliveryError";
  }
}

export class SomniaWebSocketError extends SomniaError {
  constructor(message: string) {
    super(message, "WEBSOCKET_ERROR");
    this.name = "SomniaWebSocketError";
  }
}

export class SomniaWalletError extends SomniaError {
  constructor(message: string) {
    super(message, "WALLET_ERROR");
    this.name = "SomniaWalletError";
  }
}

export class SomniaInsufficientFundsError extends SomniaError {
  constructor(
    public readonly required: bigint,
    public readonly available: bigint
  ) {
    super(
      `Insufficient STT. Required: ${required} wei, Available: ${available} wei`,
      "INSUFFICIENT_FUNDS"
    );
    this.name = "SomniaInsufficientFundsError";
  }
}
