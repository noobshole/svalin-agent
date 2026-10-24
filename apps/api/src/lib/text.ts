/**
 * Token names and symbols are chosen by whoever creates the token, and Svalin's readers are often
 * AI agents. Such text is kept short and plain: no control characters, no invisible or
 * direction-changing characters, no line breaks. It is still untrusted data, never instructions.
 * No Unicode normalisation: it would turn a full-width "ＵＳＤＣ" into a convincing "USDC".
 */
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

export function onChainLabel(value: string | undefined, max = 32): string | undefined {
  // Line breaks and tabs become spaces first, so removing hidden characters never joins words.
  const plain = value?.replace(/\s+/g, " ").replace(HIDDEN, "").replace(/ {2,}/g, " ").trim();
  return plain ? Array.from(plain).slice(0, max).join("").trim() : undefined;
}
