// /gts-api/* → https://gts.nve.no/api/* (seNorge snow-depth grid; no CORS
// headers upstream). The grid is a daily product, so a 6-hour edge cache is
// safe and keeps repeated route planning off NVE's servers.
import { proxyGet } from '../_proxy.js';

export function onRequestGet(context) {
  return proxyGet(context, '/gts-api', 'https://gts.nve.no/api', 21600);
}
