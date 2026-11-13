"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";

/** The sections of the open page, which drop down under it in the side list, with the one being read marked. */
export function DocContents({ contents }: { contents: [id: string, label: string][] }) {
  const [active, setActive] = useState(contents[0]?.[0]);
  const list = useRef<HTMLUListElement>(null);
  const chosen = useRef<string | null>(null);

  useEffect(() => {
    const headings = contents.map(([id]) => document.getElementById(id)).filter((heading) => heading !== null);
    const update = () => {
      // A section that was clicked stays marked until it is scrolled away, even when the page cannot bring it to the top.
      const clicked = chosen.current ? document.getElementById(chosen.current) : null;
      if (clicked) {
        const top = clicked.getBoundingClientRect().top;
        if (top >= -8 && top <= window.innerHeight * 0.7) return setActive(clicked.id);
        chosen.current = null;
      }
      const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
      const passed = headings.filter((heading) => heading.getBoundingClientRect().top <= window.innerHeight * 0.3);
      setActive((atEnd ? headings.at(-1) : passed.at(-1))?.id ?? contents[0]?.[0]);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [contents]);

  // A long list can run past the bottom of the side column: keep the section being read in view.
  useEffect(() => {
    const side = list.current?.closest<HTMLElement>(".docs__side");
    const link = list.current?.querySelector<HTMLElement>("[aria-current]");
    if (!side || !link) return;
    const box = side.getBoundingClientRect();
    const row = link.getBoundingClientRect();
    if (row.top < box.top) side.scrollTop -= box.top - row.top + 8;
    else if (row.bottom > box.bottom) side.scrollTop += row.bottom - box.bottom + 8;
  }, [active]);

  const onChoose = (event: MouseEvent<HTMLUListElement>) => {
    const id = (event.target as HTMLElement).closest("a")?.getAttribute("href")?.slice(1);
    if (!id) return;
    chosen.current = id;
    setActive(id);
    // On a phone the list sits in the "All docs pages" menu, which should close once a section is chosen.
    event.currentTarget.closest("details")?.removeAttribute("open");
  };

  return (
    <div className="docs__drop">
      <ul onClick={onChoose} ref={list}>
        {contents.map(([id, label]) => (
          <li key={id}>
            <a aria-current={id === active ? "location" : undefined} href={`#${id}`}>
              {label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
