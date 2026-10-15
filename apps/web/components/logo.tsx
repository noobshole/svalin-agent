/** Svalin's mark: a shield reduced to two strokes. Inherits the text colour. */
export function Logo({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 16 16">
      <path d="M8 1.5 2.5 3.5v4.2c0 3.2 2.3 5.7 5.5 6.8 3.2-1.1 5.5-3.6 5.5-6.8V3.5L8 1.5Z" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 5v6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
    </svg>
  );
}
