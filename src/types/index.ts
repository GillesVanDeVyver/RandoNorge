// [lat, lng] — matches Leaflet's LatLngTuple convention.
export type LatLng = [number, number];

// A continuous polyline. Eraser may split a stroke into multiple segments.
export type Segment = LatLng[];

// A route is an ordered list of segments (one logical trip with possible gaps).
export type Route = Segment[];

// Per-point fix timestamps (epoch ms) for a recorded track, shaped exactly
// like the Route they belong to: times[s][i] is when track[s][i] was fixed.
export type TrackTimes = number[][];

export type Mode = 'idle' | 'draw' | 'erase';

// Which thematic overlay is shown on top of the base map.
// 'none' shows the plain base map with no thematic layer draped on top.
export type Overlay = 'steepness' | 'snowdepth' | 'none';
