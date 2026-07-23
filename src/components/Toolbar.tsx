import { useRef, useState } from 'react';
import type { Mode } from '../types';
import { IMPORT_ACCEPT } from '../routes/import';
import {
  CloseIcon,
  DownloadIcon,
  EraserIcon,
  PencilIcon,
  TrashIcon,
  UploadIcon,
} from './icons';
import { useT } from '../i18n/index.ts';
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
  // Called when the user asks to export the current route as GPX. Omit to hide
  // the export control; the button is also disabled while there is no route.
  onExport?: () => void;
  // Mobile: collapse the four tools behind a single "Edit route" button.
  // Tapping it expands the stack; picking any tool (or the close button)
  // collapses it again, so the map keeps just one control by default.
  collapsible?: boolean;
}

export function Toolbar({
  mode,
  onModeChange,
  onClear,
  hasRoute,
  loading,
  onImport,
  onExport,
  collapsible = false,
}: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // In collapsible mode every tool choice folds the stack back down.
  const collapse = () => {
    if (collapsible) setOpen(false);
  };

  const toggle = (target: Mode) => {
    onModeChange(mode === target ? 'idle' : target);
    collapse();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so choosing the same file again still fires onChange.
    e.target.value = '';
    if (file && onImport) onImport(file);
    collapse();
  };

  if (collapsible && !open) {
    // Collapsed FAB. It echoes the active tool so draw/erase mode stays
    // visible even while the tools are tucked away.
    const ActiveIcon = mode === 'erase' ? EraserIcon : PencilIcon;
    return (
      <div className={styles.toolbar}>
        <button
          type="button"
          className={`${styles.btn} ${mode !== 'idle' ? styles.active : ''}`}
          onClick={() => setOpen(true)}
          title={t('Rediger rute', 'Edit route')}
          aria-label={t('Rediger rute', 'Edit route')}
          aria-expanded={false}
        >
          <ActiveIcon />
        </button>
      </div>
    );
  }

  return (
    <div className={styles.toolbar}>
      {collapsible && (
        <button
          type="button"
          className={styles.btn}
          onClick={() => setOpen(false)}
          title={t('Skjul redigeringsverktøy', 'Hide editing tools')}
          aria-label={t('Skjul redigeringsverktøy', 'Hide editing tools')}
          aria-expanded
        >
          <CloseIcon />
        </button>
      )}
      <button
        type="button"
        className={`${styles.btn} ${mode === 'draw' ? styles.active : ''}`}
        onClick={() => toggle('draw')}
        title={
          loading
            ? t('Laster rutedata …', 'Loading route data…')
            : t('Tegn rute (frihånd)', 'Draw route (freehand)')
        }
        aria-label={t('Tegn', 'Draw')}
        disabled={loading}
      >
        <PencilIcon />
      </button>
      <button
        type="button"
        className={`${styles.btn} ${mode === 'erase' ? styles.active : ''}`}
        onClick={() => toggle('erase')}
        title={t('Slett deler av ruta', 'Erase parts of the route')}
        aria-label={t('Slett', 'Erase')}
        disabled={!hasRoute}
      >
        <EraserIcon />
      </button>
      <button
        type="button"
        className={styles.btn}
        onClick={() => {
          onClear();
          collapse();
        }}
        title={t('Fjern hele ruta', 'Clear the entire route')}
        aria-label={t('Fjern alt', 'Clear all')}
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
            title={t('Importer en GPX-, TCX- eller FIT-fil', 'Import a GPX, TCX, or FIT file')}
            aria-label={t('Importer rutefil', 'Import route file')}
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
      {onExport && (
        <button
          type="button"
          className={styles.btn}
          onClick={() => {
            onExport();
            collapse();
          }}
          title={t('Eksporter rute som GPX', 'Export route as GPX')}
          aria-label={t('Eksporter rute som GPX', 'Export route as GPX')}
          disabled={!hasRoute}
        >
          <DownloadIcon />
        </button>
      )}
    </div>
  );
}
