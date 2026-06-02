import L from 'leaflet';
import 'proj4leaflet';

// EPSG:25833 (ETRS89 / UTM zone 33N) — the CRS Kartverket uses for Norway.
// Matches the tile grid published by Kartverket's WMTS service.
const proj4def =
  '+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';

// Resolutions (meters/pixel) for the `utm33n` tile matrix set, zoom 0..17.
// Source: Kartverket WMTS capabilities document.
const resolutions = [
  21674.7100160867,
  10837.35500804335,
  5418.677504021675,
  2709.3387520108377,
  1354.6693760054188,
  677.3346880027094,
  338.6673440013547,
  169.33367200067735,
  84.66683600033868,
  42.33341800016934,
  21.16670900008467,
  10.583354500042335,
  5.291677250021167,
  2.6458386250105836,
  1.3229193125052918,
  0.6614596562526459,
  0.33072982812632296,
  0.16536491406316148,
];

// Top-left origin of the Kartverket tile grid in projected coordinates.
const origin: [number, number] = [-2500000.0, 9045984.0];

export const CRS_UTM33 = new L.Proj.CRS('EPSG:25833', proj4def, {
  resolutions,
  origin,
  bounds: L.bounds([-2500000, -3500000], [3045984, 9045984]),
});
