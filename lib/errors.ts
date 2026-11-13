export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "UPSTREAM"
  | "NETWORK"
  | "TIMEOUT"
  | "INTERNAL";

const DEFAULT_MESSAGES: Record<ApiErrorCode, string> = {
  UNAUTHORIZED: "Your session has expired. Please sign in again.",
  FORBIDDEN: "You don't have access to that.",
  NOT_FOUND: "We couldn't find what you were looking for.",
  VALIDATION: "Please check the highlighted fields and try again.",
  CONFLICT: "That conflicts with something that already exists.",
  UPSTREAM: "The service is having trouble right now. Please try again.",
  NETWORK: "We couldn't reach the server. Check your connection and try again.",
  TIMEOUT: "The request took too long. Please try again.",
  INTERNAL: "Something went wrong on our side.",
};

export interface ApiErrorOptions {
  status: number;
  code?: ApiErrorCode;
  /** Upstream/technical detail. Never rendered to the user. */
  detail?: string;
  requestId?: string;
  /** Only set when the upstream message is safe to show (4xx validation). */
  safeMessage?: string;
  cause?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly detail?: string;
  readonly requestId?: string;
  readonly safeMessage: string;

  constructor(options: ApiErrorOptions) {
    const code = options.code ?? codeFromStatus(options.status);
    super(options.safeMessage ?? DEFAULT_MESSAGES[code]);
    this.name = "ApiError";
    this.status = options.status;
    this.code = code;
    this.detail = options.detail;
    this.requestId = options.requestId;
    this.safeMessage = options.safeMessage ?? DEFAULT_MESSAGES[code];
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export function codeFromStatus(status: number): ApiErrorCode {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 422) return "VALIDATION";
  if (status === 408 || status === 504) return "TIMEOUT";
  if (status >= 400 && status < 500) return "VALIDATION";
  if (status >= 500) return "UPSTREAM";
  return "INTERNAL";
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** Safe, user-facing copy for any thrown value. */
export function toUserMessage(error: unknown): string {
  if (isApiError(error)) return error.safeMessage;
  return DEFAULT_MESSAGES.INTERNAL;
}

/** Serialisable shape for route-handler responses. Never includes `detail`. */
export function toErrorResponse(error: unknown, requestId?: string) {
  const apiError = isApiError(error)
    ? error
    : new ApiError({ status: 500, requestId, cause: error });

  return {
    body: {
      error: {
        code: apiError.code,
        message: apiError.safeMessage,
        requestId: apiError.requestId ?? requestId,
      },
    },
    status: apiError.status,
  };
}
