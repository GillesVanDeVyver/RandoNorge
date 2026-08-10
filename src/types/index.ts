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

// How the pencil behaves in draw mode:
//  - 'freehand' follows the cursor while the button is held, giving one
//    fluent line (the stroke is RDP-simplified on release).
//  - 'lines'    places one vertex per click and joins them with straight
//    segments — the way ut.no and norgeskart draw. The vertices stay
//    editable (drag to move, click to remove) until the line is finished.
export type DrawStyle = 'freehand' | 'lines';

// Which thematic overlay is shown on top of the base map.
// 'none' shows the plain base map with no thematic layer draped on top.
export type Overlay = 'steepness' | 'snowdepth' | 'none';
