// Parser for FIT files (Garmin's Flexible and Interoperable data Transfer,
// the binary format most watches and bike computers record in) into the app's
// in-memory `Route` shape, so a recorded activity or course opens in the
// planner just like a GPX or TCX file.
//
// FIT is a compact binary stream, not XML, so this hand-rolls a minimal decoder
// rather than pulling in a full SDK. It reads only what the planner needs:
//   - a 12- or 14-byte file header ending in the ASCII marker ".FIT";
//   - a sequence of records, each led by a one-byte header. Definition records
//     describe the layout (endianness, global message number, field sizes) of
//     the data records that follow under the same "local message type"; data
//     records carry the actual field values.
//   - from every "record" message (global message number 20) the latitude and
//     longitude fields (field defs 0 and 1), stored as sint32 semicircles.
//
// Only positioned records contribute points; everything else (heart rate,
// cadence, laps, developer fields, …) is skipped by advancing past its bytes.
// The whole track becomes a single segment — FIT has no direct equivalent of a
// GPX <trkseg>, and the planner recomputes elevation and stats from the
// coordinates regardless. Semicircles convert to degrees via 180 / 2^31.

import { simplify } from '../geometry';
import type { LatLng, Route } from '../types';
import { translate } from '../i18n/locale.ts';
import { RouteImportError } from './errors';

// Match the drawn-route / GPX simplification tolerance (see geometry/index.ts).
const SIMPLIFY_EPSILON_M = 8;

// FIT global message number for a recorded track/course point.
const MSG_RECORD = 20;
// Field definition numbers within a record message.
const FIELD_POSITION_LAT = 0;
const FIELD_POSITION_LONG = 1;
// Sentinel a device writes when a sint32 field has no value.
const SINT32_INVALID = 0x7fffffff;
// One semicircle in degrees: 180 / 2^31.
const SEMICIRCLE_TO_DEG = 180 / 2 ** 31;

interface FieldDef {
  fieldDefNum: number;
  size: number;
}

interface MessageDef {
  globalMsgNum: number;
  littleEndian: boolean;
  fields: FieldDef[];
  // Developer fields carry no position data; we only track their total size
  // so data records can be stepped over correctly.
  devFieldsSize: number;
}

function isValidLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Parse a FIT byte buffer into a Route (a single segment of GPS points).
 *
 * @throws {RouteImportError} if the buffer isn't a readable FIT file or holds
 *   no track with at least two GPS points.
 */
export function parseFit(buffer: ArrayBuffer): Route {
  const view = new DataView(buffer);

  if (buffer.byteLength < 14) {
    throw new RouteImportError(
      translate(
        'Dette ser ikke ut som en FIT-fil.',
        "This doesn't look like a FIT file.",
      ),
    );
  }

  const headerSize = view.getUint8(0);
  const dataSize = view.getUint32(4, true);
  const marker = String.fromCharCode(
    view.getUint8(8),
    view.getUint8(9),
    view.getUint8(10),
    view.getUint8(11),
  );
  if (marker !== '.FIT' || headerSize < 12) {
    throw new RouteImportError(
      translate(
        'Dette ser ikke ut som en FIT-fil.',
        "This doesn't look like a FIT file.",
      ),
    );
  }

  // Records live between the header and the trailing 2-byte CRC. Clamp to the
  // real buffer length in case the declared data size is off.
  const dataEnd = Math.min(headerSize + dataSize, buffer.byteLength);
  const defs = new Map<number, MessageDef>();
  const points: LatLng[] = [];

  try {
    let pos = headerSize;
    while (pos < dataEnd) {
      const recordHeader = view.getUint8(pos++);

      // Compressed-timestamp header (high bit set) is always a data record;
      // its local message type sits in bits 5-6.
      if (recordHeader & 0x80) {
        pos = readDataRecord(view, pos, defs, (recordHeader >> 5) & 0x03, points);
        continue;
      }

      const isDefinition = (recordHeader & 0x40) !== 0;
      const hasDevData = (recordHeader & 0x20) !== 0;
      const localType = recordHeader & 0x0f;

      if (isDefinition) {
        pos = readDefinition(view, pos, defs, localType, hasDevData);
      } else {
        pos = readDataRecord(view, pos, defs, localType, points);
      }
    }
  } catch (err) {
    if (err instanceof RouteImportError) throw err;
    // A DataView range error means we ran off the end of a truncated file.
    throw new RouteImportError(
      translate(
        'Denne FIT-fila ser ut til å være avkortet eller ødelagt.',
        'This FIT file appears to be truncated or corrupted.',
      ),
    );
  }

  if (points.length < 2) {
    throw new RouteImportError(
      translate(
        'Fant ingen spor med minst to GPS-punkter i denne fila.',
        'No track with at least two GPS points was found in this file.',
      ),
    );
  }

  return [simplify(points, SIMPLIFY_EPSILON_M)];
}

/** Read a definition record and remember the layout for its local type. */
function readDefinition(
  view: DataView,
  pos: number,
  defs: Map<number, MessageDef>,
  localType: number,
  hasDevData: boolean,
): number {
  pos += 1; // reserved byte
  const littleEndian = view.getUint8(pos) === 0;
  pos += 1;
  const globalMsgNum = view.getUint16(pos, littleEndian);
  pos += 2;

  const numFields = view.getUint8(pos++);
  const fields: FieldDef[] = [];
  for (let i = 0; i < numFields; i++) {
    const fieldDefNum = view.getUint8(pos++);
    const size = view.getUint8(pos++);
    pos++; // base type byte — size alone is enough to step through data
    fields.push({ fieldDefNum, size });
  }

  let devFieldsSize = 0;
  if (hasDevData) {
    const numDevFields = view.getUint8(pos++);
    for (let i = 0; i < numDevFields; i++) {
      pos++; // developer field number
      devFieldsSize += view.getUint8(pos++);
      pos++; // developer data index
    }
  }

  defs.set(localType, { globalMsgNum, littleEndian, fields, devFieldsSize });
  return pos;
}

/** Read a data record, pulling lat/lng out of "record" messages. */
function readDataRecord(
  view: DataView,
  pos: number,
  defs: Map<number, MessageDef>,
  localType: number,
  points: LatLng[],
): number {
  const def = defs.get(localType);
  if (!def) {
    throw new RouteImportError(
      translate(
        'Denne FIT-fila ser ut til å være ødelagt.',
        'This FIT file appears to be corrupted.',
      ),
    );
  }

  let lat: number | null = null;
  let lng: number | null = null;

  for (const field of def.fields) {
    if (def.globalMsgNum === MSG_RECORD && field.size === 4) {
      const raw = view.getInt32(pos, def.littleEndian);
      if (raw !== SINT32_INVALID) {
        if (field.fieldDefNum === FIELD_POSITION_LAT) lat = raw * SEMICIRCLE_TO_DEG;
        else if (field.fieldDefNum === FIELD_POSITION_LONG) lng = raw * SEMICIRCLE_TO_DEG;
      }
    }
    pos += field.size;
  }
  pos += def.devFieldsSize;

  if (lat !== null && lng !== null && isValidLatLng(lat, lng)) {
    points.push([lat, lng]);
  }
  return pos;
}
