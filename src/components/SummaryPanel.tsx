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
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MountainIcon,
} from './icons';
import { useT } from '../i18n/index.ts';
import styles from './SummaryPanel.module.css';

interface Props {
  children: ReactNode;
  /** Optional primary action (e.g. a Save button) rendered at the right end
   *  of the tab bar, in the otherwise empty space after the tabs. */
  action?: ReactNode;
  /** Mobile bottom-sheet mode: the panel floats over the map, collapsed to a
   *  compact grabber strip by default; tap or swipe the grabber to expand it
   *  into the tabbed card slider. */
  sheet?: boolean;
  /** One-line route summary (e.g. "12.4 km · 850 m ascent") shown in the
   *  sheet's grabber strip so the collapsed state still says something. */
  peek?: ReactNode;
}

// On small screens the scroll area flips into a horizontal snap slider (see
// the module CSS); which axis is live is read straight off the element so the
// JS never needs its own copy of the breakpoint.
const isHorizontal = (root: HTMLElement) =>
  root.scrollWidth - root.clientWidth > root.scrollHeight - root.clientHeight;

// Left-hand "summary mode" rail (komoot-inspired). A full-height column with a
// tab bar across the top and every section stacked beneath it in a single
// scroll area. Clicking a tab smooth-scrolls to that section; a scroll-spy
// keeps the active tab in sync as the user scrolls. Add more <SummaryCard>s
// and they each become a tab + section.
export function SummaryPanel({ children, action, sheet = false, peek }: Props) {
  const t = useT();
  const cards = Children.toArray(children).filter(
    (child): child is ReactElement<CardProps> => isValidElement(child),
  );
  const [active, setActive] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);

  // Bottom-sheet state (mobile only). Starts collapsed so the map dominates.
  const [expanded, setExpanded] = useState(false);
  // A completed swipe on the grabber also fires a synthetic click; this flag
  // swallows that click so the swipe's decision isn't immediately toggled back.
  const touchStartY = useRef<number | null>(null);
  const swallowClick = useRef(false);

  const handleGrabberTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0]?.clientY ?? null;
  };

  const handleGrabberTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartY.current;
    touchStartY.current = null;
    if (start === null) return;
    const end = e.changedTouches[0]?.clientY;
    if (end === undefined) return;
    const delta = end - start;
    if (Math.abs(delta) < 24) return; // treat as a tap → the click toggles
    swallowClick.current = true;
    setExpanded(delta < 0); // swipe up expands, swipe down collapses
  };

  const handleGrabberClick = () => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    setExpanded((v) => !v);
  };

  const goTo = (i: number) => {
    setActive(i);
    const root = scrollRef.current;
    sectionRefs.current[i]?.scrollIntoView(
      root && isHorizontal(root)
        ? { behavior: 'smooth', inline: 'start', block: 'nearest' }
        : { behavior: 'smooth', block: 'start' },
    );
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
    // The same sweep works on either axis; horizontal mode (the small-screen
    // slider) just swaps top/height/scrollTop for left/width/scrollLeft.
    const update = () => {
      frame = 0;
      const horizontal = isHorizontal(root);
      const rootRect = root.getBoundingClientRect();
      const rootStart = horizontal ? rootRect.left : rootRect.top;
      const viewport = horizontal ? root.clientWidth : root.clientHeight;
      const scrolled = horizontal ? root.scrollLeft : root.scrollTop;
      const max = horizontal
        ? root.scrollWidth - root.clientWidth
        : root.scrollHeight - root.clientHeight;
      const line = max > 0 ? viewport * (scrolled / max) : 0;
      let current = 0;
      sectionRefs.current.forEach((el, i) => {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const start = (horizontal ? rect.left : rect.top) - rootStart;
        if (start <= line) current = i;
      });
      setActive(current);
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    // Re-sync when the layout flips between the vertical rail and the
    // horizontal slider (or the strip merely changes size).
    window.addEventListener('resize', onScroll);
    update();
    return () => {
      root.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [cards.length]);

  if (cards.length === 0) return null;

  const panelClass = sheet
    ? `${styles.panel} ${styles.sheet} ${expanded ? styles.sheetOpen : ''}`
    : styles.panel;

  return (
    <aside className={panelClass}>
      {sheet && (
        <button
          type="button"
          className={styles.grabber}
          onClick={handleGrabberClick}
          onTouchStart={handleGrabberTouchStart}
          onTouchEnd={handleGrabberTouchEnd}
          aria-expanded={expanded}
          aria-label={
            expanded
              ? t('Skjul rutedetaljer', 'Collapse route details')
              : t('Vis rutedetaljer', 'Expand route details')
          }
        >
          <span className={styles.handle} aria-hidden />
          <span className={styles.peekRow}>
            <span className={styles.peekText}>{peek}</span>
            <span
              className={`${styles.peekChevron} ${expanded ? styles.peekChevronOpen : ''}`}
              aria-hidden
            >
              <ChevronDownIcon />
            </span>
          </span>
        </button>
      )}
      <header className={styles.rail}>
        <div className={styles.brand}>
          <span className={styles.brandIcon} aria-hidden>
            <MountainIcon />
          </span>
          <span className={styles.brandName}>Fjellrute</span>
        </div>
        <span className={styles.railTitle}>{t('Ruteoversikt', 'Route overview')}</span>
      </header>
      <nav className={styles.tabs} aria-label={t('Ruteoppsummering', 'Route summary sections')}>
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
        {action && <div className={styles.tabsAction}>{action}</div>}
      </nav>
      <div className={styles.slider}>
        {/* Small screens: paging arrows replace the swipe gesture. The title
            is lifted up here next to them so the whole row stays fixed — the
            arrows sit inline to the right of the chart title and never overlap
            the chart, while only the cards slide underneath. Hidden on
            desktop, where the tab bar drives navigation and each section
            carries its own heading. */}
        {sheet && (
          <div className={styles.pagerBar}>
            <h2 className={styles.pagerTitle}>{cards[active]?.props.title}</h2>
            {cards.length > 1 && (
              <div
                className={styles.pager}
                role="group"
                aria-label={t('Bytt diagram', 'Change chart')}
              >
                <button
                  type="button"
                  className={styles.pagerBtn}
                  onClick={() => goTo(active - 1)}
                  disabled={active === 0}
                  aria-label={t('Forrige diagram', 'Previous chart')}
                >
                  <ChevronLeftIcon />
                </button>
                <button
                  type="button"
                  className={styles.pagerBtn}
                  onClick={() => goTo(active + 1)}
                  disabled={active === cards.length - 1}
                  aria-label={t('Neste diagram', 'Next chart')}
                >
                  <ChevronRightIcon />
                </button>
              </div>
            )}
          </div>
        )}
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
