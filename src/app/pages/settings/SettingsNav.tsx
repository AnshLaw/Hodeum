import { useEffect, useRef, useState, type RefObject } from "react";
import { SETTINGS_SECTIONS, activeSection } from "./sections";

/** A section counts as being read once its top is this far below the scroller's top (past the sticky bar). */
const READING_LINE_PX = 96;
/** Slack for sub-pixel scroll positions when checking for the bottom of the page. */
const BOTTOM_SLACK_PX = 2;

function present(): HTMLElement[] {
  return SETTINGS_SECTIONS.flatMap(({ id }) => document.getElementById(id) ?? []);
}

/** Tracks which settings card is under the sticky bar as the page scrolls. */
function useActiveSection(nav: RefObject<HTMLElement | null>): string | undefined {
  const [active, setActive] = useState<string>();
  useEffect(() => {
    const scroller = nav.current?.closest<HTMLElement>(".happ__main");
    if (!scroller) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = scroller.getBoundingClientRect().top + READING_LINE_PX;
      const tops = present().map((element) => ({ id: element.id, top: element.getBoundingClientRect().top }));
      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - BOTTOM_SLACK_PX;
      setActive(activeSection(tops, line, atBottom && scroller.scrollTop > 0));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [nav]);
  return active;
}

function jumpTo(id: string): void {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(id)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
}

/** Sticky jump bar over the long settings page. */
export function SettingsNav() {
  const nav = useRef<HTMLElement>(null);
  const active = useActiveSection(nav);
  return (
    <nav ref={nav} className="hsettings-nav" aria-label="Settings sections">
      {SETTINGS_SECTIONS.map(({ id, label }) => (
        <a
          key={id}
          href={`#${id}`}
          aria-current={active === id ? "true" : undefined}
          onClick={(event) => {
            event.preventDefault();
            jumpTo(id);
          }}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
