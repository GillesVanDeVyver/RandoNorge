// react-leaflet binding for OfflineTileLayer, mirroring how react-leaflet's
// own <TileLayer> is built (createTileLayerComponent + updateGridLayer) so it
// slots into the <MapContainer> tree exactly like the layers it replaces.

import {
  createElementObject,
  createTileLayerComponent,
  updateGridLayer,
  withPane,
} from '@react-leaflet/core';
import type { TileLayerProps } from 'react-leaflet';
import { OfflineTileLayer } from './OfflineTileLayer';
import type { OfflineLayerId } from './layers';

export interface OfflineTileLayerProps
  extends Omit<TileLayerProps, 'url'> {
  layerId: OfflineLayerId;
  /** Snapshot date for the snow-depth layer (YYYY-MM-DD). */
  snowDate?: string;
}

export const OfflineTileLayerComponent = createTileLayerComponent<
  OfflineTileLayer,
  OfflineTileLayerProps
>(
  function createOfflineTileLayer({ layerId, snowDate, ...options }, context) {
    const layer = new OfflineTileLayer({
      layerId,
      snowDate,
      ...withPane(options, context),
    });
    return createElementObject(layer, context);
  },
  function updateOfflineTileLayer(layer, props, prevProps) {
    updateGridLayer(layer, props, prevProps);
    // When the snow date changes, refresh the key/URL source and redraw so the
    // new day's tiles (cached or live) replace the stale ones.
    if (props.snowDate !== prevProps.snowDate) {
      layer.options.snowDate = props.snowDate;
      layer.redraw();
    }
  },
);
