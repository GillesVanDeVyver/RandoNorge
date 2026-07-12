// /metno-api/* → https://api.met.no/* with the identifying User-Agent that
// MET's terms of service require, plus 30-minute edge caching (MET's model
// runs update roughly hourly, and their ToS requires clients to cache).
import { proxyGet } from '../_proxy.js';

export function onRequestGet(context) {
  return proxyGet(context, '/metno-api', 'https://api.met.no', 1800);
}
