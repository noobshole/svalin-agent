export function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

/** Token prices run from fractions of a cent to absurd quotes, so keep three significant digits. */
export function formatPrice(value: number) {
  if (value >= 1_000_000) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(value);
  }
  if (value >= 1) return formatUsd(value);
  return value >= 1e-6 ? `$${value.toPrecision(3)}` : `$${value.toExponential(2)}`;
}

/** Dollar amounts in tables: $1.8M, $245.8K, $940. Junk tokens can claim more than a trillion. */
export function formatCompactUsd(value: number) {
  if (value >= 1e15) return `$${(value / 1e15).toLocaleString("en-US", { maximumFractionDigits: 2 })} quadrillion`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatPct(value: number) {
  return `${value.toFixed(1)}%`;
}

export function shortAddress(address: string) {
  // Short NEAR names (alice.near) read better whole.
  return address.length <= 20 ? address : `${address.slice(0, 4)}…${address.slice(-4)}`;
}
