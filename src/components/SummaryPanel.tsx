import type { ReactNode } from 'react';
import styles from './SummaryPanel.module.css';

interface Props {
  children: ReactNode;
}

// Right-hand "summary mode" rail. A single full-height column that holds a
// vertical stack of cards (charts, stats, future actions/ads/…) and scrolls
// independently of the map. Designed to absorb arbitrary content without
// the page layout itself needing to grow — add more <SummaryCard>s and
// they appear below the existing ones.
export function SummaryPanel({ children }: Props) {
  return (
    <aside className={styles.panel}>
      <div className={styles.scroll}>{children}</div>
    </aside>
  );
}

interface CardProps {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  padded?: boolean;
}

// Visual container for a single piece of summary content. Title/action are
// optional so a card can be just a chart, just a stat block, or a free-form
// promo/CTA without forced chrome.
export function SummaryCard({ title, action, children, padded = true }: CardProps) {
  return (
    <section className={styles.card}>
      {(title || action) && (
        <header className={styles.cardHeader}>
          {title && <h2 className={styles.cardTitle}>{title}</h2>}
          {action && <div className={styles.cardAction}>{action}</div>}
        </header>
      )}
      <div className={padded ? styles.cardBody : styles.cardBodyFlush}>
        {children}
      </div>
    </section>
  );
}
