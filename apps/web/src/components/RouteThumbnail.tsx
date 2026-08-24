import { useEffect, useRef } from 'react';
import type { Route } from '@fjellrute/core/types';
import { renderStaticMap } from '../briefing/staticMap';
import { RouteIcon } from './icons';
import { useT } from '@fjellrute/core/i18n';
import styles from './RouteThumbnail.module.css';

// Tile stitching, projection and route tracing live in briefing/staticMap.ts,
// shared with the printable tour briefing so both pictures come out of one
// code path. This file only supplies the thumbnail-sized parameters.
const ROUTE_WEIGHT = 2.5;
const HALO_WEIGHT = 5;
const PADDING = 0.12;

type Props = {
  /** The saved route's geometry; falls back to the generic icon if absent. */
  route?: Route;
};

/**
 * North-up mini-map of a route on the steepness overlay, used as the row
 * "icon" in the route library lists. Falls back to the generic route icon
 * while there is no drawable geometry (unparseable row, single point, …).
 */
export function RouteThumbnail({ route }: Props) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const points = route ? route.reduce((n, seg) => n + seg.length, 0) : 0;
  const drawable = Boolean(route && points >= 2);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!drawable || !route || !canvas) return;
    let cancelled = false;
    void renderStaticMap(canvas, {
      route,
      width: canvas.clientWidth || 64,
      height: canvas.clientHeight || 64,
      scale: Math.min(window.devicePixelRatio || 1, 2),
      padding: PADDING,
      routeWeight: ROUTE_WEIGHT,
      haloWeight: HALO_WEIGHT,
      cancelled: () => cancelled,
    }).catch(() => {
      // Network hiccup: the placeholder background simply stays.
    });
    return () => {
      cancelled = true;
    };
  }, [drawable, route]);

  if (!drawable) {
    return (
      <span className={styles.fallback} aria-hidden="true">
        <RouteIcon />
      </span>
    );
  }
  return (
    <canvas
      ref={canvasRef}
      className={styles.thumb}
      role="img"
      aria-label={t(
        'Ruteoversikt på bratthetskart, nord opp',
        'Route overview on steepness map, north up',
      )}
    />
  );
}
