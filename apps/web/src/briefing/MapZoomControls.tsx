// The two buttons that say "closer" and "wider", on both of the sheet's maps.
//
// They sit on top of the picture rather than in the bar above it, because the
// thing being judged is the picture: composing a frame means looking at it
// while it changes, and a control up in the bar would mean looking away to
// change it. Shared between the flat renderer's frame and the 3D one's so that
// the icons, the step and the limits are one thing rather than two that happen
// to agree today.
//
// Whatever is passed as a child lands beside them, which in practice is the
// way back to the whole route. That is deliberately *not* shared: the flat map
// gets there by dropping a framing and the 3D one by flying a camera home, and
// only the frames themselves know which.

import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from './mapFraming';
import { useT } from '@fjellrute/core/i18n';

export function MapZoomControls({
  zoom,
  onZoom,
  onPointerDown,
  children,
}: {
  /** Where the frame is now, as an offset from the fit. Only read to decide
   *  which buttons have run out of room. */
  zoom: number;
  /** Zoom by this many levels, about the middle of the frame. */
  onZoom: (delta: number) => void;
  /** Lets the frame behind stop a press on a button also counting as the
   *  beginning of a drag on the map underneath it. */
  onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void;
  children?: ReactNode;
}) {
  const t = useT();
  const inLabel = t('Zoom inn', 'Zoom in');
  const outLabel = t('Zoom ut', 'Zoom out');
  return (
    <div className="briefingMapControls" onPointerDown={onPointerDown}>
      <button
        type="button"
        className="briefingMapZoom"
        // A control that has run out of room greys, rather than staying bright
        // and quietly doing nothing to the picture.
        disabled={zoom <= ZOOM_MIN}
        aria-label={outLabel}
        title={outLabel}
        onClick={() => onZoom(-ZOOM_STEP)}
      >
        {/* A true minus sign, not a hyphen: it has to balance the plus. */}
        <span aria-hidden>&#8722;</span>
      </button>
      <button
        type="button"
        className="briefingMapZoom"
        disabled={zoom >= ZOOM_MAX}
        aria-label={inLabel}
        title={inLabel}
        onClick={() => onZoom(ZOOM_STEP)}
      >
        <span aria-hidden>+</span>
      </button>
      {children}
    </div>
  );
}
