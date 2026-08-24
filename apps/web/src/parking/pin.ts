/** Colour of the parking pins on the map and of the numbered badges in the
 *  Parking tab.
 *
 *  Blue, and deliberately not any of the colours already spoken for: the route
 *  line is teal (--route / --accent), the recorded track is orange, the start
 *  dot is green and the finish dot is red. Blue is also what every road sign in
 *  Norway uses for parking, so it reads as "parking" before anything explains
 *  that it is.
 *
 *  Shared by the panel and the map layer so a pin and its list row can never
 *  drift apart — the same reason dangerScale.ts is shared between the avalanche
 *  panel and the printed briefing. */
export const PARKING_PIN_COLOR = '#2f6fed';

/** Pin fill for the halo/outline ring, matching the endpoint markers' style of
 *  a white ring around a solid dot. */
export const PARKING_PIN_RING = '#ffffff';
