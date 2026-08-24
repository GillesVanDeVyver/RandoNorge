// Place-name search backed by Kartverket's stedsnavn API (Sentralt
// stedsnavnregister). Open data under CC BY 4.0 — free for commercial use
// with © Kartverket attribution, unlike the public Nominatim server whose
// usage policy forbids commercial products.
// Docs: https://ws.geonorge.no/stedsnavn/v1/

const ENDPOINT = 'https://ws.geonorge.no/stedsnavn/v1/navn';

interface StedsnavnResponse {
  navn?: Array<{
    skrivemåte: string;
    navneobjekttype: string;
    representasjonspunkt: {
      nord: number;
      øst: number;
    };
  }>;
}

export interface PlaceResult {
  lat: number;
  lon: number;
  name: string;
  type: string;
}

/**
 * Look up a Norwegian place name and return its best match, or null if
 * nothing was found. Coordinates are returned as WGS84-compatible
 * lat/lon (EPSG:4258).
 */
export async function searchPlace(query: string): Promise<PlaceResult | null> {
  const q = query.trim();
  if (!q) return null;
  const url =
    ENDPOINT +
    '?sok=' +
    encodeURIComponent(q) +
    '&fuzzy=true&treffPerSide=1&side=1&koordsys=4258';
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const data: StedsnavnResponse = await res.json();
  const hit = data.navn?.[0];
  if (!hit || !hit.representasjonspunkt) return null;
  return {
    lat: hit.representasjonspunkt.nord,
    lon: hit.representasjonspunkt.øst,
    name: hit.skrivemåte,
    type: hit.navneobjekttype,
  };
}
