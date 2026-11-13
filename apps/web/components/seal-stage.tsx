"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { normaliseAddress } from "@/components/scan-form";
import { IndexDisc, Seal } from "@/components/seal";
import { API_BASE_URL } from "@/lib/api";
import { INDEX_COUNTS_FALLBACK, indexCounts, offscreen, paintDots, paintSeal, type IndexCounts } from "@/lib/seal";
import { currentTheme, onThemeChange } from "@/lib/theme";

const CountsContext = createContext<IndexCounts>(INDEX_COUNTS_FALLBACK);

/** A number from the latest Svalin Index edition. */
export function IndexCount({ part }: { part: keyof IndexCounts }) {
  return <>{useContext(CountsContext)[part].toLocaleString("en-US")}</>;
}

/** The dots for phones, where each step of the page has its own drawing. */
export function IndexDots() {
  return <IndexDisc counts={useContext(CountsContext)} onBand />;
}

/** The first seal on phones: type in its centre and it redraws. Enter checks the address. */
export function HeroSeal() {
  const router = useRouter();
  const [address, setAddress] = useState(FIRST_ADDRESS);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const valid = normaliseAddress(address);
    if (valid) router.push(`/check?address=${encodeURIComponent(valid)}`);
  }

  return (
    <Seal address={address.trim() || "svalin"}>
      <form className="grid w-full gap-0.5" onSubmit={onSubmit}>
        <input
          aria-label="Type an address to draw its seal. Press Enter to check it."
          autoCapitalize="off"
          autoComplete="off"
          className="seal-stage__input"
          onChange={(event) => setAddress(event.target.value)}
          spellCheck={false}
          value={address}
        />
        <span className="seal-stage__hint">change a letter</span>
      </form>
    </Seal>
  );
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (from: number, to: number, value: number) => {
  const t = clamp01((value - from) / (to - from));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
/** The page colour and the slate band, as the canvas needs them. They match --background and --band. */
const PAPER = { light: [233, 227, 223], dark: [18, 20, 22] };
const BAND = { light: [70, 92, 136], dark: [40, 54, 82] };
const FIRST_ADDRESS = "intents.near";

type Engine = { setDots: (counts: IndexCounts) => void; setTyped: (address: string) => void };

/**
 * The home page's scene: one seal held still while the page travels past it, and each step of the
 * scroll changes what the seal is. All the text is ordinary page content underneath.
 */
export function SealStage({ children }: { children: ReactNode }) {
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const sky = useRef<HTMLCanvasElement>(null);
  const middle = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const paneInput = useRef<HTMLFormElement>(null);
  const paneBlock = useRef<HTMLDivElement>(null);
  const paneGrade = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const [counts, setCounts] = useState(INDEX_COUNTS_FALLBACK);

  useEffect(() => {
    const stage = root.current;
    const canvas = sky.current;
    const context = canvas?.getContext("2d");
    const mid = middle.current;
    if (!stage || !canvas || !context || !mid) return;
    const g: CanvasRenderingContext2D = context;
    const panes = [paneInput.current, paneBlock.current, paneGrade.current];
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const controller = new AbortController();

    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let R = 0;
    let startY = 0;
    let anchors: number[] = [];
    let images: HTMLCanvasElement[] = [];
    let typed = FIRST_ADDRESS;
    let dots = INDEX_COUNTS_FALLBACK;
    let typedFrom: HTMLCanvasElement | null = null;
    let typedProgress = 1;
    let intro = calm ? 1 : 0;
    let queued = false;
    let pane = -2;
    let running = true;
    let askedForCounts = false;

    const seal = (address: string, tone: "blue" | "red" | "pale") => offscreen(R, pixelRatio, (c) => paintSeal(c, R, address, tone, currentTheme()));
    const dotImage = () => offscreen(R, pixelRatio, (c) => paintDots(c, R, dots.total, dots.passing, "band"));
    const paintImages = () => {
      images = [seal(typed, "blue"), seal("intent5.near", "red"), seal("root.near", "pale"), dotImage()];
    };

    function place(image: HTMLCanvasElement, x: number, y: number, rotation: number, alpha: number) {
      g.save();
      g.globalAlpha = alpha;
      g.translate(x, y);
      g.rotate(rotation);
      g.drawImage(image, -R, -R, 2 * R, 2 * R);
      g.restore();
    }

    function wipe(from: HTMLCanvasElement | null, to: HTMLCanvasElement, t: number, x: number, y: number, rotation: number) {
      if (t <= 0) {
        if (from) place(from, x, y, rotation, 1);
        return;
      }
      if (t >= 1) {
        place(to, x, y, rotation, 1);
        return;
      }
      const radius = t * R * 1.04;
      if (from) {
        g.save();
        g.beginPath();
        g.rect(0, 0, width, height * 1.3);
        g.arc(x, y, radius, 0, Math.PI * 2, true);
        g.clip("evenodd");
        place(from, x, y, rotation, 1);
        g.restore();
      }
      g.save();
      g.beginPath();
      g.arc(x, y, radius, 0, Math.PI * 2);
      g.clip();
      place(to, x, y, rotation, 1);
      g.restore();
    }

    function showPane(index: number, opacity: number) {
      if (index !== pane) {
        panes.forEach((element, position) => {
          if (element) element.hidden = position !== index;
        });
        pane = index;
        mid!.style.pointerEvents = index === 0 ? "auto" : "none";
      }
      mid!.style.opacity = String(opacity);
    }

    function draw() {
      queued = false;
      if (!running || images.length === 0) return;
      const line = window.scrollY + height * 0.5;
      let segment = 3;
      let t = 1;
      if (line <= anchors[0]!) {
        segment = 0;
        t = 0;
      } else {
        for (let i = 0; i < 4; i += 1) {
          if (line < anchors[i + 1]!) {
            segment = i;
            t = (line - anchors[i]!) / (anchors[i + 1]! - anchors[i]!);
            break;
          }
        }
      }
      const w = smooth(0.3, 0.72, t);
      const sideX = width * 0.7;
      const sideY = height * 0.5;
      const moved = segment === 0 ? smooth(0, 0.6, t) : 1;
      const x = mix(width * 0.5, sideX, moved);
      const y = mix(startY, sideY, moved);
      const rotation = (window.scrollY / height) * 0.32;
      const toBlue = segment === 0 ? 0 : segment === 1 ? smooth(0.35, 0.68, t) : 1;

      g.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      const theme = currentTheme();
      g.fillStyle = `rgb(${PAPER[theme].map((value, i) => Math.round(mix(value, BAND[theme][i]!, toBlue))).join(",")})`;
      g.fillRect(0, 0, width, height * 1.3);

      if (segment === 3) place(images[3]!, x, y, rotation, 1 - smooth(0.25, 0.8, t) * 0.86);
      else if (segment === 0 && w === 0 && intro < 1) wipe(null, images[0]!, intro, x, y, rotation);
      else if (segment === 0 && w === 0 && typedProgress < 1) wipe(typedFrom, images[0]!, typedProgress, x, y, rotation);
      else wipe(images[segment]!, images[segment + 1]!, w, x, y, rotation);

      const showing = segment === 3 ? 3 : segment + (w > 0.5 ? 1 : 0);
      showPane(showing > 2 ? -1 : showing, showing > 2 ? 0 : Math.min(1, Math.abs(w - 0.5) * 5));
      mid!.style.width = `${2 * 0.34 * R}px`;
      mid!.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%)`;
    }

    function request() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(draw);
    }

    function measure() {
      startY = height * 0.46;
      const blocks = Array.from(stage!.querySelectorAll("[data-beat]"));
      anchors = [
        height * 0.6,
        ...blocks.map((block) => {
          const box = block.getBoundingClientRect();
          return box.top + window.scrollY + box.height / 2;
        }),
      ];
    }

    function layout(force: boolean) {
      const w = document.documentElement.clientWidth;
      const h = window.innerHeight;
      if (!force && w === width && Math.abs(h - height) < 120) return;
      width = w;
      height = h;
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      // Phones and tablets have no moving scene: each step of the page draws its own seal.
      if (window.innerWidth < 1024) {
        images = [];
        stage!.classList.remove("seal-stage--live");
        return;
      }
      stage!.classList.add("seal-stage--live");
      R = Math.min(height * 0.31, width * 0.24);
      stage!.style.setProperty("--R", `${R}px`);
      canvas!.width = Math.round(width * pixelRatio);
      canvas!.height = Math.round(Math.max(height, canvas!.clientHeight) * pixelRatio);
      paintImages();
      measure();
      draw();
    }

    function animate(set: (value: number) => void, duration: number) {
      const start = performance.now();
      const step = (now: number) => {
        if (!running) return;
        const progress = Math.max(0, Math.min(1, (now - start) / duration));
        set(1 - Math.pow(1 - progress, 2.2));
        draw();
        if (progress < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }

    // The dots need the Index, which is a large download: only fetch it once the visitor scrolls.
    function askForCounts() {
      if (askedForCounts) return;
      askedForCounts = true;
      fetch(`${API_BASE_URL}/v1/index/near-tokens`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { counts?: Record<"A" | "B" | "C" | "D" | "F", number> } | null) => {
          const latest = body?.counts;
          if (latest && [latest.A, latest.B, latest.C, latest.D, latest.F].every(Number.isFinite)) setCounts(indexCounts(latest));
        })
        .catch(() => undefined);
    }

    function onScroll() {
      askForCounts();
      request();
    }

    let resizeTimer: ReturnType<typeof setTimeout>;
    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        layout(false);
        measure();
        request();
      }, 120);
    }

    engine.current = {
      setDots(next) {
        dots = next;
        if (images.length) {
          images[3] = dotImage();
          request();
        }
      },
      setTyped(address) {
        typed = address || "svalin";
        if (!images.length) return;
        typedFrom = images[0] ?? null;
        images[0] = seal(typed, "blue");
        if (calm) {
          typedProgress = 1;
          draw();
          return;
        }
        typedProgress = 0;
        animate((value) => {
          typedProgress = value;
        }, 420);
      },
    };

    const stopThemeListener = onThemeChange(() => {
      if (!images.length) return;
      paintImages();
      draw();
    });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    layout(true);
    if (!calm) {
      animate((value) => {
        intro = value;
      }, 1500);
    }
    document.fonts?.ready.then(() => {
      if (running) {
        measure();
        request();
      }
    });

    return () => {
      running = false;
      controller.abort();
      clearTimeout(resizeTimer);
      stopThemeListener();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      engine.current = null;
    };
  }, []);

  useEffect(() => engine.current?.setDots(counts), [counts]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const address = normaliseAddress(input.current?.value ?? "");
    if (address) router.push(`/check?address=${encodeURIComponent(address)}`);
  }

  return (
    <div className="seal-stage" ref={root}>
      <canvas aria-hidden="true" className="seal-stage__sky" ref={sky} />
      <div className="seal-stage__mid" ref={middle}>
        <form onSubmit={onSubmit} ref={paneInput}>
          <input
            aria-label="Type an address to draw its seal. Press Enter to check it."
            autoCapitalize="off"
            autoComplete="off"
            className="seal-stage__input"
            defaultValue={FIRST_ADDRESS}
            onChange={(event) => engine.current?.setTyped(event.target.value.trim())}
            ref={input}
            spellCheck={false}
          />
          <div className="seal-stage__hint">change a letter</div>
        </form>
        <div className="seal-stage__verdict" hidden ref={paneBlock}>
          <b>Block</b>
          <i>intent5.near</i>
        </div>
        <div className="seal-stage__letter" hidden ref={paneGrade}>
          C
        </div>
      </div>
      <CountsContext.Provider value={counts}>{children}</CountsContext.Provider>
    </div>
  );
}
