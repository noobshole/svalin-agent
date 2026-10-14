export function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

export function formatPct(value: number) {
  return `${value.toFixed(1)}%`;
}

export function shortAddress(address: string) {
  // Short NEAR names (alice.near) read better whole.
  return address.length <= 20 ? address : `${address.slice(0, 4)}…${address.slice(-4)}`;
}
