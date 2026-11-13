"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { offscreen, paintDots, paintSeal, type IndexCounts, type SealTone } from "@/lib/seal";
import { currentTheme, onThemeChange } from "@/lib/theme";
import { cn } from "@/lib/utils/cn";

type Paint = (g: CanvasRenderingContext2D, R: number) => void;

/** A round drawing that opens outward from its centre when it comes into view or what it shows changes. */
function Disc({ paint, paintKey, className, children }: { paint: Paint; paintKey: string; className?: string; children?: ReactNode }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const shown = useRef<HTMLCanvasElement | null>(null);
  const latest = useRef(paint);
  latest.current = paint;

  useEffect(() => {
    const element = canvas.current;
    const g = element?.getContext("2d");
    if (!element || !g) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let lastSize = 0;

    const render = (animate: boolean) => {
      const size = element.clientWidth;
      if (!size) return;
      lastSize = size;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const next = offscreen(size / 2, pixelRatio, (context) => latest.current(context, size / 2));
      const from = shown.current;
      element.width = element.height = next.width;
      shown.current = next;
      cancelAnimationFrame(frame);
      if (!animate || calm) {
        g.drawImage(next, 0, 0);
        return;
      }
      const start = performance.now();
      const step = (now: number) => {
        const progress = Math.max(0, Math.min(1, (now - start) / 620));
        const eased = 1 - Math.pow(1 - progress, 2.2);
        const middle = next.width / 2;
        const radius = eased * middle * 1.05;
        g.clearRect(0, 0, next.width, next.width);
        if (from && from.width === next.width) {
          g.save();
          g.beginPath();
          g.rect(0, 0, next.width, next.width);
          g.arc(middle, middle, radius, 0, Math.PI * 2, true);
          g.clip("evenodd");
          g.drawImage(from, 0, 0);
          g.restore();
        }
        g.save();
        g.beginPath();
        g.arc(middle, middle, radius, 0, Math.PI * 2);
        g.clip();
        g.drawImage(next, 0, 0);
        g.restore();
        if (progress < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };

    // A seal already on screen changes at once; one further down the page opens when it is reached.
    let viewObserver: IntersectionObserver | null = null;
    if (shown.current) {
      render(true);
    } else {
      viewObserver = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            viewObserver?.disconnect();
            render(true);
          }
        },
        { threshold: 0.2 },
      );
      viewObserver.observe(element);
    }
    const sizeObserver = new ResizeObserver(() => {
      if (shown.current && element.clientWidth !== lastSize) render(false);
    });
    sizeObserver.observe(element);
    const stopThemeListener = onThemeChange(() => {
      if (shown.current) render(false);
    });
    return () => {
      viewObserver?.disconnect();
      sizeObserver.disconnect();
      stopThemeListener();
      cancelAnimationFrame(frame);
    };
  }, [paintKey]);

  return (
    <div className={cn("relative aspect-square w-full [container-type:inline-size]", className)}>
      <canvas aria-hidden="true" className="absolute inset-0 h-full w-full" ref={canvas} />
      {children ? <div className="absolute inset-[30%] grid place-items-center text-center">{children}</div> : null}
    </div>
  );
}

/** The seal drawn from an address. What goes in its centre is up to the page. */
export function Seal({ address, tone = "blue", className, children }: { address: string; tone?: SealTone; className?: string; children?: ReactNode }) {
  return (
    <Disc className={className} paint={(g, R) => paintSeal(g, R, address, tone, currentTheme())} paintKey={`${address}|${tone}`}>
      {children}
    </Disc>
  );
}

/** Every token in the Svalin Index as one dot. `onBand` is for the slate band. */
export function IndexDisc({ counts, onBand = false, className }: { counts: IndexCounts; onBand?: boolean; className?: string }) {
  return (
    <Disc
      className={className}
      paint={(g, R) => paintDots(g, R, counts.total, counts.passing, onBand ? "band" : currentTheme())}
      paintKey={`${counts.total}|${counts.passing}`}
    />
  );
}
