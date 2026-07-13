import type { Mode } from '../types';
import { EraserIcon, PencilIcon, TrashIcon } from './icons';
import styles from './Toolbar.module.css';

interface Props {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  onClear: () => void;
  hasRoute: boolean;
  // True while the elevation worker is computing — the pencil is locked
  // out so the user can't queue another stroke on top of an in-flight
  // route computation.
  loading: boolean;
}

export function Toolbar({ mode, onModeChange, onClear, hasRoute, loading }: Props) {
  const toggle = (target: Mode) =>
    onModeChange(mode === target ? 'idle' : target);

  return (
    <div className={styles.toolbar}>
      <button
        type="button"
        className={`${styles.btn} ${mode === 'draw' ? styles.active : ''}`}
        onClick={() => toggle('draw')}
        title={loading ? 'Loading route data…' : 'Draw route (freehand)'}
        aria-label="Draw"
        disabled={loading}
      >
        <PencilIcon />
      </button>
      <button
        type="button"
        className={`${styles.btn} ${mode === 'erase' ? styles.active : ''}`}
        onClick={() => toggle('erase')}
        title="Erase parts of the route"
        aria-label="Erase"
        disabled={!hasRoute}
      >
        <EraserIcon />
      </button>
      <button
        type="button"
        className={styles.btn}
        onClick={onClear}
        title="Clear the entire route"
        aria-label="Clear all"
        disabled={!hasRoute}
      >
        <TrashIcon />
      </button>
    </div>
  );
}
