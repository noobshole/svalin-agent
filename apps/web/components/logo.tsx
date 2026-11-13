/** Svalin's mark: a seal reduced to an engraved rim and a centre. Inherits the text colour. */
export function Logo({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 32 32">
      <circle cx="16" cy="16" fill="none" r="14.5" stroke="currentColor" strokeDasharray="1.9 1.25" strokeWidth="2" />
      <circle cx="16" cy="16" fill="currentColor" r="8.5" />
    </svg>
  );
}
