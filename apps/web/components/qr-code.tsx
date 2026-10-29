import { encode } from "uqr";

/**
 * A QR code drawn as SVG paths, so the strict content policy needs no image or canvas. It stays
 * dark on white in both themes, since wallet cameras read that best.
 */
export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const { data, size } = encode(value, { ecc: "M", border: 2 });
  let path = "";
  data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) path += `M${x} ${y}h1v1h-1z`;
    });
  });
  return (
    <svg aria-label={label} className={className} role="img" shapeRendering="crispEdges" viewBox={`0 0 ${size} ${size}`}>
      <rect fill="#ffffff" height={size} width={size} />
      <path d={path} fill="#0b0b0c" />
    </svg>
  );
}
