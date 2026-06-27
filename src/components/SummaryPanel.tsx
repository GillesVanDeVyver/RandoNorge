import {
  Children,
  isValidElement,
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
// tab bar across the top that switches between sections, a large heading for
// the active section, and the section's content in a clean card. Scrolls
// independently of the map. Add more <SummaryCard>s and they each become a tab.
export function SummaryPanel({ children }: Props) {
  const cards = Children.toArray(children).filter(
    (child): child is ReactElement<CardProps> => isValidElement(child),
  );
  const [active, setActive] = useState(0);
  const current = cards[Math.min(active, cards.length - 1)];

  if (!current) return null;

  return (
    <aside className={styles.panel}>
      <nav className={styles.tabs} aria-label="Route summary sections">
        {cards.map((card, i) => (
          <button
            key={i}
            type="button"
            className={i === active ? styles.tabActive : styles.tab}
            onClick={() => setActive(i)}
            aria-current={i === active}
          >
            {card.props.title}
          </button>
        ))}
      </nav>
      <div className={styles.scroll}>
        <h1 className={styles.heading}>{current.props.title}</h1>
        {current.props.action && (
          <div className={styles.headingAction}>{current.props.action}</div>
        )}
        <section className={styles.card}>
          <div
            className={
              current.props.padded === false ? styles.cardBodyFlush : styles.cardBody
            }
          >
            {current.props.children}
          </div>
        </section>
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
// as a tab (title) plus its content card. Title/action/padded are read by the
// panel; the component itself renders nothing on its own.
export const SummaryCard: FC<CardProps> = () => null;
