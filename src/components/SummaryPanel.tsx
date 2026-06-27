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

  // Scroll-spy: mark the top-most section in view as active.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length) {
          const idx = sectionRefs.current.indexOf(visible[0].target as HTMLElement);
          if (idx >= 0) setActive(idx);
        }
      },
      { root, rootMargin: '0px 0px -60% 0px', threshold: 0 },
    );
    sectionRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [cards.length]);

  if (cards.length === 0) return null;

  return (
    <aside className={styles.panel}>
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
