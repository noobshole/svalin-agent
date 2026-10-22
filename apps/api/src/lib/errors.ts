import type { ApiError as ApiErrorBody, TokenNotice } from "@svalin-agent/shared";

export class ApiError extends Error {
  constructor(
    readonly status: 400 | 404 | 422 | 429 | 501 | 502 | 503,
    readonly code: string,
    message: string,
    readonly hint?: string,
    readonly token?: TokenNotice,
  ) {
    super(message);
  }

  toBody(): ApiErrorBody {
    return {
      error: this.message,
      code: this.code,
      ...(this.hint ? { hint: this.hint } : {}),
      ...(this.token ? { token: this.token } : {}),
    };
  }
}

/**
 * The address is a token, not a wallet. A 4xx, so a paid call is not charged, and it carries the
 * token's Svalin Index grade where there is one.
 */
export function tokenAddressError(token: TokenNotice, explanation?: string): ApiError {
  const what = token.symbol ? `the ${token.symbol} token` : "a token";
  let hint: string;
  if (explanation) {
    hint = explanation;
  } else if (token.grade !== null && token.backingUsd !== null) {
    hint = `Svalin Index grade ${token.grade}: $${token.backingUsd.toLocaleString("en-US")} of real backing in its pools. Every NEAR token's grade: GET /v1/index/near-tokens.`;
  } else if (token.chain === "near") {
    hint = "It is one of the trusted tokens Svalin values others against, so it has no grade.";
  } else {
    hint = "Svalin Index grades cover NEAR tokens so far.";
  }
  return new ApiError(422, "token_address", `This is ${what}, not a wallet. Send the address of a wallet that holds it.`, hint, token);
}
