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

// Plain folded map — used for the "no overlay" state (base map only).
export function MapIcon() {
  return (
    <svg {...baseProps}>
      <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
      <line x1="9" y1="3" x2="9" y2="18" />
      <line x1="15" y1="6" x2="15" y2="21" />
    </svg>
  );
}

// --- Date-bar navigation chevrons ---------------------------------------
// Single = day, double = week, double-with-bar (skip) = year.

export function ChevronDownIcon() {
  return (
    <svg {...baseProps}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function ChevronLeftIcon() {
  return (
    <svg {...baseProps}>
      <polyline points="15 5 8 12 15 19" />
    </svg>
  );
}

export function ChevronRightIcon() {
  return (
    <svg {...baseProps}>
      <polyline points="9 5 16 12 9 19" />
    </svg>
  );
}

export function ChevronsLeftIcon() {
  return (
    <svg {...baseProps}>
      <polyline points="17 5 10 12 17 19" />
      <polyline points="11 5 4 12 11 19" />
    </svg>
  );
}

export function ChevronsRightIcon() {
  return (
    <svg {...baseProps}>
      <polyline points="7 5 14 12 7 19" />
      <polyline points="13 5 20 12 13 19" />
    </svg>
  );
}

export function SkipBackIcon() {
  return (
    <svg {...baseProps}>
      <line x1="5" y1="5" x2="5" y2="19" />
      <polyline points="19 6 11 12 19 18" />
      <polyline points="13 6 5 12 13 18" fill="none" />
    </svg>
  );
}

export function SkipForwardIcon() {
  return (
    <svg {...baseProps}>
      <line x1="19" y1="5" x2="19" y2="19" />
      <polyline points="5 6 13 12 5 18" />
      <polyline points="11 6 19 12 11 18" fill="none" />
    </svg>
  );
}

export function ResetIcon() {
  // Counter-clockwise "back to now" arrow.
  return (
    <svg {...baseProps}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <polyline points="3 3 3 8 8 8" />
    </svg>
  );
}

export function UndoIcon() {
  return (
    <svg {...baseProps}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-1" />
    </svg>
  );
}

export function CubeIcon() {
  return (
    <svg {...baseProps}>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

export function RouteIcon() {
  // Lucide "route": waypoint circles joined by a path, reads as "fit to the
  // drawn track".
  return (
    <svg {...baseProps}>
      <circle cx="6" cy="19" r="3" />
      <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
      <circle cx="18" cy="5" r="3" />
    </svg>
  );
}

export function CompassIcon() {
  // Lucide "compass": ring with a diamond needle. The whole icon counter-
  // rotates with the map bearing, so the needle always points at true north.
  return (
    <svg {...baseProps}>
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg {...baseProps}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function BookmarkPlusIcon() {
  // Lucide "bookmark-plus": save the current route to the library.
  return (
    <svg {...baseProps}>
      <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
      <line x1="12" x2="12" y1="7" y2="13" />
      <line x1="9" x2="15" y1="10" y2="10" />
    </svg>
  );
}

export function BookmarkIcon() {
  return (
    <svg {...baseProps}>
      <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
    </svg>
  );
}

export function CircleCheckIcon() {
  return (
    <svg {...baseProps}>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function ArrowLeftIcon() {
  return (
    <svg {...baseProps}>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

export function ArrowRightIcon() {
  return (
    <svg {...baseProps}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

export function GoogleIcon({ className }: { className?: string }) {
  // Official multi-colour "G" mark (filled, not stroked, so it doesn't
  // take the Lucide baseProps). Used on the "Continue with Google" button.
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3.01c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.95H1.27v3.11A11.99 11.99 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.38-2.28V6.61H1.27a12 12 0 0 0 0 10.78l4.01-3.11z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.98 11.98 0 0 0 1.27 6.61l4.01 3.11C6.22 6.88 8.87 4.77 12 4.77z"
      />
    </svg>
  );
}
