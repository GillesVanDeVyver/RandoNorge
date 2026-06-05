// Inline SVG icons (Lucide-style strokes) for the toolbar.
const baseProps = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function PencilIcon() {
  return (
    <svg {...baseProps}>
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

export function EraserIcon() {
  // Classic tilted school-eraser block. The short transverse line near
  // the right end reads as the ferrule / colour band on a rubber, and
  // the baseline below suggests the surface being erased.
  return (
    <svg {...baseProps}>
      <g transform="rotate(-30 12 12)">
        <rect x="3" y="9" width="18" height="6" rx="0.8" />
        <line x1="15" y1="9" x2="15" y2="15" />
      </g>
      <line x1="3" y1="21" x2="21" y2="21" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg {...baseProps}>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg {...baseProps}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function FullscreenIcon() {
  return (
    <svg {...baseProps}>
      <path d="M3 9V3h6" />
      <path d="M21 9V3h-6" />
      <path d="M3 15v6h6" />
      <path d="M21 15v6h-6" />
    </svg>
  );
}

export function LocateIcon() {
  return (
    <svg {...baseProps}>
      <line x1="12" y1="2" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="2" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="22" y2="12" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg {...baseProps}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function MinusIcon() {
  return (
    <svg {...baseProps}>
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function SnowflakeIcon() {
  return (
    <svg {...baseProps}>
      <line x1="12" y1="2" x2="12" y2="22" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="4.5" y1="4.5" x2="19.5" y2="19.5" />
      <line x1="19.5" y1="4.5" x2="4.5" y2="19.5" />
      <polyline points="9,4 12,7 15,4" />
      <polyline points="9,20 12,17 15,20" />
      <polyline points="4,9 7,12 4,15" />
      <polyline points="20,9 17,12 20,15" />
    </svg>
  );
}

export function MountainIcon() {
  return (
    <svg {...baseProps}>
      <path d="m3 20 6-10 4 6 3-4 5 8z" />
      <circle cx="17" cy="6" r="1.5" />
    </svg>
  );
}
