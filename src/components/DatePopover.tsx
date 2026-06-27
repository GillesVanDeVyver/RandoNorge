import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './DatePopover.module.css';

// Custom date picker shared by the snow-depth and avalanche-risk panels.
// The native <input type="date"> picker varies wildly across browsers:
// some emit value-change events while the user is just browsing months
// in the popup, which would cause downstream data to refetch before the
// user has actually selected a day. This minimal popover gives us explicit
// control: month chevrons only mutate the local view-month state, and
// onChange is fired exclusively when the user clicks a day cell.
const pad2 = (n: number) => String(n).padStart(2, '0');
const fmtYMD = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`;
const fmtMDY = (s: string) => {
  const { y, m, d } = parseYMD(s);
  return `${pad2(m)}/${pad2(d)}/${y}`;
};
function parseYMD(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}
function daysInMonth(y: number, m: number) {
  return new Date(y, m, 0).getDate();
}
// Day-of-week of the 1st of (y, m), 0=Monday..6=Sunday
function firstDowMon(y: number, m: number) {
  return (new Date(y, m - 1, 1).getDay() + 6) % 7;
}
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DOW_NAMES = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

export function DatePopover({
  value,
  max,
  onChange,
}: {
  value: string;
  max?: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const initial = useMemo(() => parseYMD(value), [value]);
  const [view, setView] = useState<{ y: number; m: number }>({
    y: initial.y,
    m: initial.m,
  });
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  // Screen-space position of the (portaled) popover. Null until measured.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Reset the visible month to the selected value each time the
  // popover opens, so reopening it doesn't leave the user on a stale
  // month from a previous browsing session.
  useEffect(() => {
    if (open) {
      const p = parseYMD(value);
      setView({ y: p.y, m: p.m });
    } else {
      setPos(null);
    }
  }, [open, value]);

  // The popover is rendered in a portal on <body> with fixed positioning so
  // it can't be clipped by an ancestor card's `overflow: hidden`. Anchor it
  // under the trigger, flip above when there isn't room below, and keep it
  // within the viewport horizontally. Measured after layout so the calendar's
  // real size drives the flip decision.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = wrapRef.current;
      const pop = popRef.current;
      if (!trigger || !pop) return;
      const r = trigger.getBoundingClientRect();
      const popH = pop.offsetHeight;
      const popW = pop.offsetWidth;
      const spaceBelow = window.innerHeight - r.bottom;
      const openUp = spaceBelow < popH + 8 && r.top > popH + 8;
      const top = openUp ? r.top - popH - 6 : r.bottom + 6;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - popW - 8));
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    // Reposition on any scroll (capture catches the summary panel's own
    // scroll container, not just the window).
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, view]);

  // Close on outside click (the popover lives outside wrapRef in the portal).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const prevMonth = () =>
    setView((v) => (v.m === 1 ? { y: v.y - 1, m: 12 } : { y: v.y, m: v.m - 1 }));
  const nextMonth = () =>
    setView((v) => (v.m === 12 ? { y: v.y + 1, m: 1 } : { y: v.y, m: v.m + 1 }));

  const dim = daysInMonth(view.y, view.m);
  const lead = firstDowMon(view.y, view.m);
  // Always render a fixed 6×7 = 42-cell grid so the popover height
  // doesn't shift between months that span 5 vs 6 calendar rows.
  const cells: (number | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(d);
  while (cells.length < 42) cells.push(null);

  return (
    <div ref={wrapRef} className={styles.dateWrap}>
      <button
        type="button"
        className={styles.dateInput}
        onClick={() => setOpen((o) => !o)}
      >
        {fmtMDY(value)}
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            className={styles.datePopover}
            role="dialog"
            style={{
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              visibility: pos ? 'visible' : 'hidden',
            }}
          >
            <div className={styles.popHeader}>
            <button
              type="button"
              className={styles.popNav}
              onClick={prevMonth}
              aria-label="Previous month"
            >
              ‹
            </button>
            <span className={styles.popTitle}>
              {MONTH_NAMES[view.m - 1]} {view.y}
            </span>
            <button
              type="button"
              className={styles.popNav}
              onClick={nextMonth}
              aria-label="Next month"
            >
              ›
            </button>
          </div>
          <div className={styles.popDows}>
            {DOW_NAMES.map((d) => (
              <div key={d} className={styles.popDow}>
                {d}
              </div>
            ))}
          </div>
          <div className={styles.popGrid}>
            {cells.map((d, i) => {
              if (d === null) return <div key={i} className={styles.popEmpty} />;
              const v = fmtYMD(view.y, view.m, d);
              const disabled = max ? v > max : false;
              const selected = v === value;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={disabled}
                  className={`${styles.popDay} ${selected ? styles.popDaySelected : ''}`}
                  onClick={() => {
                    onChange(v);
                    setOpen(false);
                  }}
                >
                  {d}
                </button>
              );
            })}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
