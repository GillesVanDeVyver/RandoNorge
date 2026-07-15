import { useRef } from 'react';
import type { Mode } from '../types';
import { IMPORT_ACCEPT } from '../routes/import';
import { EraserIcon, PencilIcon, TrashIcon, UploadIcon } from './icons';
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
  // Called with the chosen route file (GPX, TCX, or FIT) when the user picks
  // one to import. Omit to hide the import control entirely.
  onImport?: (file: File) => void;
}

export function Toolbar({
  mode,
  onModeChange,
  onClear,
  hasRoute,
  loading,
  onImport,
}: Props) {
  const toggle = (target: Mode) =>
    onModeChange(mode === target ? 'idle' : target);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so choosing the same file again still fires onChange.
    e.target.value = '';
    if (file && onImport) onImport(file);
  };

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
      {onImport && (
        <>
          <button
            type="button"
            className={styles.btn}
            onClick={() => fileInputRef.current?.click()}
            title="Import a GPX, TCX, or FIT file"
            aria-label="Import route file"
          >
            <UploadIcon />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={IMPORT_ACCEPT}
            onChange={handleFileChange}
            hidden
          />
        </>
      )}
    </div>
  );
}
