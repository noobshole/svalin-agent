import type { ApiError as ApiErrorBody } from "@svalin-agent/shared";

export class ApiError extends Error {
  constructor(
    readonly status: 400 | 404 | 429 | 501 | 502 | 503,
    readonly code: string,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
  }

  toBody(): ApiErrorBody {
    return { error: this.message, code: this.code, ...(this.hint ? { hint: this.hint } : {}) };
  }
}
