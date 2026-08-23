import { useEffect } from 'react';
import type maplibregl from 'maplibre-gl';
import { useParkingAreas } from '../parking/store';
import {
  releaseParkingHighlight,
  takeParkingHighlight,
  useHoveredParkingId,
} from '../parking/hover';
import { parkingSigns } from '../parking/signs';
import {
  PARKING_SIGN_LAYER,
  parkingSignsGeoJSON,
  serveParkingSignIcons,
} from '../parking/signImage';
import { whenStyleReady } from '../mapStyleReady';

// The 3D twin of ParkingLayer: the numbered signs from the Parking tab, planted
// on the terrain of the planner's MapLibre view.
//
// Renders no DOM at all. It exists as a component rather than as another effect
// inside Map3DView for one reason: it subscribes to the parking store and the
// parking highlight, and both change often — every fetch, and every time the
// pointer crosses a row in the Parking tab. Subscribed up in Map3DView, each of
// those would re-render a nine-hundred-line component and everything it holds,
// to end up setting one GeoJSON source. Subscribed here, they re-render this.
//
// The signs themselves are a symbol layer declared in Map3DView's style (see
// PARKING_SIGN_LAYER); this file only ever fills its source and binds its
// pointer handlers. The layer belongs to the style because MapLibre elevates a
// symbol's anchor onto the terrain mesh for us — an HTML marker would float over
// the hillside and, on a tilted view, point at the wrong valley. Why the icons
// are bitmaps baked on demand is in parking/signImage.ts.

interface Props {
  /** The MapLibre map, or null before it has been created. */
  map: maplibregl.Map | null;
}

export function Map3DParkingSigns({ map }: Props) {
  const areas = useParkingAreas();
  const hoveredId = useHoveredParkingId();

  // Bake the sign bitmaps this map asks for, for as long as it is alive. Its own
  // effect, keyed on the map alone: the icons do not depend on which lots are
  // listed or which one is lit, and re-registering the handler on every hover
  // would be work for nothing.
  useEffect(() => {
    if (!map) return;
    return serveParkingSignIcons(map);
  }, [map]);

  // The signs, and which one is lit. The numbering and the rule about a stale
  // highlight are parkingSigns' — the same call the 2D layer, the printed sheet
  // and the printed 3D map make, so sign 3 is the same lot on all four and in
  // the Parking tab's third row.
  useEffect(() => {
    if (!map) return;
    const apply = () => {
      const src = map.getSource('parking') as
        | maplibregl.GeoJSONSource
        | undefined;
      if (src) src.setData(parkingSignsGeoJSON(parkingSigns(areas, hoveredId)));
    };
    return whenStyleReady(map, apply);
  }, [map, areas, hoveredId]);

  // Pointing at a sign lights it, exactly as pointing at its row does — the
  // same pair of functions the 2D map and the Parking tab call, so no two of
  // the three can disagree about which lot is lit, and the reader can work from
  // whichever end they like.
  //
  // There is no tooltip with the lot's name, unlike the 2D map's: MapLibre has
  // no marker DOM to hang one on, and the panel beside the map is already
  // showing the name of the row this hover has just lit.
  useEffect(() => {
    if (!map) return;

    // Which lot is under the pointer has to be looked up from the event, since
    // one layer carries all the signs. queryRenderedFeatures is what MapLibre's
    // own mouseenter/mouseleave use, and going through the event's own features
    // means the answer is the sign actually drawn there — including the growing
    // of a lit one, which changes what "there" covers.
    const idAt = (e: maplibregl.MapMouseEvent): string | null => {
      // A layer that is not in the style yet — the pointer can be over the
      // container before `load` — makes queryRenderedFeatures throw rather than
      // return nothing.
      if (!map.getLayer(PARKING_SIGN_LAYER)) return null;
      const hit = map.queryRenderedFeatures(e.point, {
        layers: [PARKING_SIGN_LAYER],
      })[0];
      const id = hit?.properties?.id;
      return typeof id === 'string' ? id : null;
    };

    let lit: string | null = null;
    const onMove = (e: maplibregl.MapMouseEvent) => {
      const id = idAt(e);
      if (id === lit) return;
      // Released before the next is taken, so the highlight is never owned by
      // two signs at once as the pointer slides from one to its neighbour.
      if (lit !== null) releaseParkingHighlight(lit);
      lit = id;
      if (id !== null) {
        const area = areas.find((a) => a.id === id);
        if (area) takeParkingHighlight(area.id, area.point);
      }
    };
    const clear = () => {
      if (lit === null) return;
      releaseParkingHighlight(lit);
      lit = null;
    };

    map.on('mousemove', onMove);
    // The pointer leaving the canvas, and the map moving out from under it: in
    // both cases whatever was lit is no longer what the pointer is on.
    map.on('mouseout', clear);
    map.on('movestart', clear);

    return () => {
      map.off('mousemove', onMove);
      map.off('mouseout', clear);
      map.off('movestart', clear);
      // Unmounting or re-listing with a sign still lit would leave the rest of
      // the app dimming four rows for a hover nobody is doing any more.
      clear();
    };
  }, [map, areas]);

  return null;
}
