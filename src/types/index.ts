// [lat, lng] — matches Leaflet's LatLngTuple convention.
export type LatLng = [number, number];

// A continuous polyline. Eraser may split a stroke into multiple segments.
export type Segment = LatLng[];

// A route is an ordered list of segments (one logical trip with possible gaps).
export type Route = Segment[];

export type Mode = 'idle' | 'draw' | 'erase';

// Which thematic overlay is shown on top of the base map.
export type Overlay = 'steepness' | 'snowdepth';
