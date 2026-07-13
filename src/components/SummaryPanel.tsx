import {
  Children,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type FC,
  type ReactElement,
  type ReactNode,
} from 'react';
import { MountainIcon } from './icons';
import styles from './SummaryPanel.module.css';

interface Props {
  children: ReactNode;
}

// Left-hand "summary mode" rail (komoot-inspired). A full-height column with a
// tab bar across the top and every section stacked beneath it in a single
// scroll area. Clicking a tab smooth-scrolls to that section; a scroll-spy
// keeps the active tab in sync as the user scrolls. Add more <SummaryCard>s
// and they each become a tab + section.
export function SummaryPanel({ children }: Props) {
  const cards = Children.toArray(children).filter(
    (child): child is ReactElement<CardProps> => isValidElement(child),
  );
  const [active, setActive] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);

  const goTo = (i: number) => {
    setActive(i);
    sectionRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Scroll-spy: mark the active section by geometry on every scroll frame rather
  // than reacting to intersection-boundary events (an IntersectionObserver can
  // coalesce a short section's enter+exit into one callback and skip its tab).
  //
  // The active section is simply the last one whose top has passed an activation
  // line — but the line is not fixed. It sweeps from the top of the viewport
  // (at scroll start) down to the bottom (at scroll end), tracking the fraction
  // scrolled. A fixed line breaks for the trailing sections: once the remaining
  // content is shorter than the viewport you can no longer push their tops up to
  // a fixed line, so a short section like "Avalanche warnings" wedged above the
  // last one never activates and the tab jumps straight to the last section.
  // Because the sweeping line crosses every section's real position exactly once
  // over the scroll range, each section — however short or wherever pinned —
  // gets its own activation range.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const rootTop = root.getBoundingClientRect().top;
      const max = root.scrollHeight - root.clientHeight;
      const line = max > 0 ? root.clientHeight * (root.scrollTop / max) : 0;
      let current = 0;
      sectionRefs.current.forEach((el, i) => {
        if (el && el.getBoundingClientRect().top - rootTop <= line) current = i;
      });
      setActive(current);
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => {
      root.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [cards.length]);

  if (cards.length === 0) return null;

  return (
    <aside className={styles.panel}>
      <header className={styles.rail}>
        <div className={styles.brand}>
          <span className={styles.brandIcon} aria-hidden>
            <MountainIcon />
          </span>
          <span className={styles.brandName}>Fjellrute</span>
        </div>
        <span className={styles.railTitle}>Route overview</span>
      </header>
      <nav className={styles.tabs} aria-label="Route summary sections">
        {cards.map((card, i) => (
          <button
            key={i}
            type="button"
            className={i === active ? styles.tabActive : styles.tab}
            onClick={() => goTo(i)}
            aria-current={i === active}
          >
            {card.props.title}
          </button>
        ))}
      </nav>
      <div className={styles.scroll} ref={scrollRef}>
        {cards.map((card, i) => (
          <section
            key={i}
            ref={(el) => {
              sectionRefs.current[i] = el;
            }}
            className={styles.section}
          >
            <h2 className={styles.heading}>{card.props.title}</h2>
            {card.props.action && (
              <div className={styles.headingAction}>{card.props.action}</div>
            )}
            <div className={styles.card}>
              <div
                className={
                  card.props.padded === false ? styles.cardBodyFlush : styles.cardBody
                }
              >
                {card.props.children}
              </div>
            </div>
          </section>
        ))}
      </div>
    </aside>
  );
}

interface CardProps {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  padded?: boolean;
}

// Declarative description of a single summary section. Rendered by SummaryPanel
// as a tab (title) plus its stacked content section. Title/action/padded are
// read by the panel; the component itself renders nothing on its own.
export const SummaryCard: FC<CardProps> = () => null;
