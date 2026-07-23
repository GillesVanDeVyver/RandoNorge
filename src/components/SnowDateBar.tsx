import type { ReactNode } from 'react';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  ResetIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SnowflakeIcon,
} from './icons';
import { useT } from '../i18n/index.ts';
import styles from './SnowDateBar.module.css';

interface Props {
  date: string; // YYYY-MM-DD
  onDateChange: (date: string) => void;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const toYMD = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const fromYMD = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

function shiftDays(date: string, days: number): string {
  const d = fromYMD(date);
  d.setDate(d.getDate() + days);
  return toYMD(d);
}

function shiftYears(date: string, years: number): string {
  const d = fromYMD(date);
  d.setFullYear(d.getFullYear() + years);
  return toYMD(d);
}

export function SnowDateBar({ date, onDateChange }: Props) {
  const t = useT();
  const today = toYMD(new Date());
  const set = (next: string) => onDateChange(next > today ? today : next);
  const isToday = date === today;

  return (
    <div className={styles.bar}>
      <span className={styles.brand} aria-hidden="true">
        <SnowflakeIcon />
      </span>
      <NavButton
        label={t('År', 'Year')}
        title={t('Forrige år', 'Previous year')}
        onClick={() => set(shiftYears(date, -1))}
        secondary
      >
        <SkipBackIcon />
      </NavButton>
      <NavButton
        label={t('Uke', 'Week')}
        title={t('Forrige uke', 'Previous week')}
        onClick={() => set(shiftDays(date, -7))}
        secondary
      >
        <ChevronsLeftIcon />
      </NavButton>
      <NavButton
        label={t('Dag', 'Day')}
        title={t('Forrige dag', 'Previous day')}
        onClick={() => set(shiftDays(date, -1))}
      >
        <ChevronLeftIcon />
      </NavButton>
      <input
        type="date"
        className={`${styles.dateInput} tnum`}
        value={date}
        max={today}
        onChange={(e) => {
          if (e.target.value) set(e.target.value);
        }}
      />
      <NavButton
        label={t('Dag', 'Day')}
        title={t('Neste dag', 'Next day')}
        onClick={() => set(shiftDays(date, 1))}
        disabled={isToday}
      >
        <ChevronRightIcon />
      </NavButton>
      <NavButton
        label={t('Uke', 'Week')}
        title={t('Neste uke', 'Next week')}
        onClick={() => set(shiftDays(date, 7))}
        disabled={isToday}
        secondary
      >
        <ChevronsRightIcon />
      </NavButton>
      <NavButton
        label={t('År', 'Year')}
        title={t('Neste år', 'Next year')}
        onClick={() => set(shiftYears(date, 1))}
        disabled={isToday}
        secondary
      >
        <SkipForwardIcon />
      </NavButton>
      <NavButton
        label={t('Nå', 'Now')}
        title={t('Hopp til i dag', 'Jump to today')}
        onClick={() => set(today)}
        disabled={isToday}
        accent
      >
        <ResetIcon />
      </NavButton>
    </div>
  );
}

function NavButton({
  children,
  label,
  title,
  onClick,
  disabled = false,
  accent = false,
  secondary = false,
}: {
  children: ReactNode;
  label: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
  /** Coarse steppers (±year/±week) — hidden on small screens, where the
   *  bar must fit between the edit FAB and the top-right control stack. */
  secondary?: boolean;
}) {
  return (
    <button
      type="button"
      className={`${styles.btn} ${accent ? styles.accentBtn : ''} ${secondary ? styles.secondary : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
    >
      <span className={styles.icon}>{children}</span>
      <span className={styles.label}>{label}</span>
    </button>
  );
}
