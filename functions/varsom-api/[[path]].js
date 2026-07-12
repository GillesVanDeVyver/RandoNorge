// /varsom-api/* → https://api01.nve.no/* (Varsom avalanche warnings; no CORS
// headers upstream). Warnings are issued daily with occasional intraday
// updates, so a 1-hour edge cache balances freshness against load.
import { proxyGet } from '../_proxy.js';

export function onRequestGet(context) {
  return proxyGet(context, '/varsom-api', 'https://api01.nve.no', 3600);
}
