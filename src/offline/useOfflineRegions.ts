// Loads the list of downloaded regions and exposes a refresh + support flag.
// The panel uses this to render the "Downloaded areas" list and totals.

import { useCallback, useEffect, useState } from 'react';
import { getRegions, isOfflineSupported, type RegionMeta } from './db';

export function useOfflineRegions() {
  const [regions, setRegions] = useState<RegionMeta[]>([]);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const list = await getRegions();
      setRegions(list);
    } catch {
      setRegions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    isOfflineSupported().then((ok) => {
      if (cancelled) return;
      setSupported(ok);
      if (ok) refresh();
      else setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  return { regions, supported, loading, refresh };
}
