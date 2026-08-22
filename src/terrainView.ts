// What the terrain view looks like, stated once.
//
// Two things in the app now render Norway in relief: the planner's own
// Map3DView, which you fly around, and the single frame the briefing prints
// when the export is switched to 3D. They are different components on purpose
// — one interactive and lazily loaded, one built off-screen, captured and torn
// down — but the whole point of the printed one is that it is the view the
// guide was just looking at. A camera angle or a mesh exaggeration that lived
// in only one of them would drift from the other silently, and the drift would
// only ever be noticed on paper, which is where it cannot be fixed.
//
// Same argument as routeStyle.ts, and the same discipline about weight: the
// only imports here are the app's own pure modules and maplibre's *types*,
// which compile away, so either side can read a number — or the sheet can ask
// which way north points — without pulling a megabyte of WebGL behind it.

import type {
  CircleLayerSpecification,
  LineLayerSpecification,
  SkySpecification,
} from 'maplibre-gl';
import type { Route } from './types';
import { routeConnectors, routeEnds } from './geometry';
import {
  ROUTE_COLOR,
  ROUTE_WEIGHT,
  START_COLOR,
  FINISH_COLOR,
  ENDPOINT_RADIUS,
  ENDPOINT_RING,
  CONNECTOR_COLOR,
  CONNECTOR_DASH_RATIO,
  connectorWeight,
} from './routeStyle';

/** Vertical exaggeration of the terrain mesh. 1.0 is true-to-life; a small
 *  bump makes ridgelines and couloirs read more clearly without looking fake. */
export const TERRAIN_EXAGGERATION = 1.4;

/** The opening camera: tilted enough that slopes have a shape, turned slightly
 *  off north so ridges are not seen end-on, and padded so the route does not
 *  touch the edge of the frame. The planner opens here and the printed sheet
 *  is taken from here, which is what makes the paper recognisable as the
 *  screen. Bearing is negative — the view is turned anticlockwise — so north
 *  lies to the *right* of straight up, and a north mark drawn over the picture
 *  has to be turned the other way by the same amount. */
export const TERRAIN_PITCH = 62;
export const TERRAIN_BEARING = -20;
export const TERRAIN_FIT_PADDING = 80;

/** Sky, horizon haze and ground fog. Cosmetic, but it is most of what tells a
 *  reader at a glance that they are looking at a landscape rather than a map. */
export const TERRAIN_SKY: SkySpecification = {
  'sky-color': '#9ec8f0',
  'sky-horizon-blend': 0.6,
  'horizon-color': '#e6eef5',
  'horizon-fog-blend': 0.5,
  'fog-color': '#ffffff',
  'fog-ground-blend': 0.4,
};

/** How strongly each thematic layer is draped over the terrain. Stated here for
 *  the same reason the camera is: the printed 3D map and the planner's are
 *  meant to be the same picture, and an opacity that lived in only one of them
 *  would drift. Steepness sits lighter than snow because it is a shading with
 *  contours of its own to show through, where snow is a flat 1 km ramp; both
 *  are heavier than they would be on the flat map, because the mesh's own
 *  shading is under them. */
export const TERRAIN_STEEPNESS_OPACITY = 0.6;
export const TERRAIN_SNOW_OPACITY = 0.8;

/** The route line, in the planner's accent teal at the planner's width. Drawn
 *  without the white halo the 2D maps put under it: on a shaded, draped mesh
 *  the halo reads as a second line rather than as contrast. */
export const TERRAIN_ROUTE_PAINT: LineLayerSpecification['paint'] = {
  'line-color': ROUTE_COLOR,
  'line-width': ROUTE_WEIGHT,
};

/** The dotted legs bridging gaps between consecutive segments, so a tour drawn
 *  in parts reads as one tour here too. Like the route line it gets no halo, for
 *  the same reason: on a shaded mesh a halo reads as a second line.
 *
 *  MapLibre measures line-dasharray in multiples of the line's own width, which
 *  is the unit CONNECTOR_DASH_RATIO is already stated in — so the pair goes in
 *  untouched and comes out as the same dotted rhythm the flat maps draw in
 *  absolute pixels. */
export const TERRAIN_CONNECTOR_PAINT: LineLayerSpecification['paint'] = {
  'line-color': CONNECTOR_COLOR,
  'line-width': connectorWeight(),
  'line-dasharray': [...CONNECTOR_DASH_RATIO],
};

/** Those legs as LineString features, ready for the line layer above. Empty
 *  when the route has no gaps, which is the common case and a valid
 *  FeatureCollection — same contract as routeEndpointsGeoJSON below. */
export function routeConnectorsGeoJSON(route: Route): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: routeConnectors(route).map((leg) => ({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        // Route coordinates are [lat, lng]; GeoJSON wants [lng, lat].
        coordinates: leg.map(([lat, lng]) => [lng, lat]),
      },
    })),
  };
}

/** Start and finish dots, coloured from the same pair the flat maps use — the
 *  circle takes its colour from the feature, so both dots are one layer and
 *  neither can be restyled without the other. */
export const TERRAIN_ENDPOINT_PAINT: CircleLayerSpecification['paint'] = {
  'circle-color': [
    'match',
    ['get', 'role'],
    'start',
    START_COLOR,
    FINISH_COLOR,
  ],
  'circle-radius': ENDPOINT_RADIUS,
  'circle-stroke-color': '#ffffff',
  'circle-stroke-width': ENDPOINT_RING,
};

/** The route's two ends as point features, ready for the circle layer above.
 *  Empty while there is nothing to mark, which is a valid FeatureCollection and
 *  saves every caller a null check on a source it has already declared. */
export function routeEndpointsGeoJSON(route: Route): GeoJSON.FeatureCollection {
  const ends = routeEnds(route);
  const points: { role: string; at: [number, number] }[] = [];
  if (ends) {
    points.push({ role: 'start', at: [ends.start[1], ends.start[0]] });
    if (ends.end) points.push({ role: 'finish', at: [ends.end[1], ends.end[0]] });
  }
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      properties: { role: p.role },
      geometry: { type: 'Point', coordinates: p.at },
    })),
  };
}
