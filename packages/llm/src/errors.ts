/**
 * What can go wrong talking to LM Studio. `message` is in plain words, for the user.
 */
export type LlmErrorCode =
  | "LmUnreachable"
  | "ModelNotLoaded"
  | "ReasoningLeak"
  | "Timeout"
  | "FirstTokenTimeout"
  | "ConnectionLost"
  | "BadResponse"
  | "Aborted";

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  constructor(code: LlmErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LlmError";
    this.code = code;
  }
}

export const isLlmError = (error: unknown): error is LlmError => error instanceof LlmError;
