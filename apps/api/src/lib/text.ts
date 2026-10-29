/**
 * Token names and symbols are chosen by whoever creates the token, and Svalin's readers are often
 * AI agents. Such text is kept short and plain: no control characters, no invisible or
 * direction-changing characters, no line breaks. It is still untrusted data, never instructions.
 * No Unicode normalisation: it would turn a full-width "ＵＳＤＣ" into a convincing "USDC".
 */
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** What Svalin shows instead of a name written to give its reader orders. */
export const HIDDEN_NAME = "[hidden name]";

/**
 * Text that talks to whoever reads it rather than naming a token: prompt-injection phrasing, orders
 * to move money or go somewhere, a link, or an encoded message (the 2026 Grok wallet drain used
 * Morse code). A token name has no reason to carry any of these.
 */
const INSTRUCTION_PATTERNS: readonly RegExp[] = [
  /\b(ignore|disregard|forget|override)\b.{0,40}\b(instructions?|previous|prior|above|rules|prompt)\b/,
  /\b(system prompt|you are now|new instructions?|as an ai|dear (ai|agent|assistant))\b/,
  /\b(send|transfer|approve|withdraw|deposit|claim|visit|connect)\b.{0,30}\b(all|your|funds?|wallet|reward|rewards|airdrop|here|now)\b/,
  /\b(payment failed|pay again|retry (the )?payment)\b/,
  /(https?:\/\/|www\.|t\.me\/|\b[a-z0-9-]{2,}\.(com|io|xyz|org|net|app|fi|finance|site|online|top|vip|cc|gg|co|link|click|info|live|claims?)\b)/,
];
const ENCODED_PATTERNS: readonly RegExp[] = [
  /(?:[.\-·]{1,6}[ /]+){5,}[.\-·]{1,6}/,
  /[A-Za-z0-9+/]{28,}={0,2}/,
];

export function looksLikeInstructions(text: string): boolean {
  const lower = text.toLowerCase();
  if (INSTRUCTION_PATTERNS.some((pattern) => pattern.test(lower))) return true;
  // Long runs count as encoded only when they mix letters and digits, as encodings do.
  return ENCODED_PATTERNS.some((pattern) => {
    const run = text.match(pattern)?.[0];
    return run !== undefined && (pattern === ENCODED_PATTERNS[0] || (/[0-9]/.test(run) && /[A-Za-z]/.test(run)));
  });
}

export function onChainLabel(value: string | undefined, max = 32): string | undefined {
  // Line breaks and tabs become spaces first, so removing hidden characters never joins words.
  const plain = value?.replace(/\s+/g, " ").replace(HIDDEN, "").replace(/ {2,}/g, " ").trim();
  if (!plain) return undefined;
  // Judged on the whole text, before it is shortened, so a long instruction cannot hide its tail.
  if (looksLikeInstructions(plain)) return HIDDEN_NAME;
  return Array.from(plain).slice(0, max).join("").trim();
}
