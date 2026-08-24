// The XML the GPX and TCX parsers need, and nothing else.
//
// WHY THIS FILE EXISTS. `new DOMParser()` is a browser global. React Native has
// no DOM at all, so a phone app that imported ./gpx would resolve the parser to
// `undefined` and fail at the first import — after the user had picked a file.
// Rather than fork the parsers, the two of them ask for an XML document through
// here, and what provides it is a property of the platform.
//
// WHY THE INTERFACES ARE THIS SMALL. They are not a DOM subset for its own
// sake: they are exactly what gpx.ts and tcx.ts call, which is five things —
// the root element's name, a tag search, an attribute read, an element's text,
// and the presence of a <parsererror>. Writing that down is what makes the
// replacement obvious:
// @xmldom/xmldom satisfies this interface as it stands, and so does the browser
// DOMParser, so neither app needs a shim. Widen it only when a parser genuinely
// needs more, because everything named here is something every future platform
// has to supply.
//
// WHY THE DEFAULT COMES FROM globalThis. Requiring every entry point to call
// setXmlParser() first would mean a code path that reached parseGpx without
// having been configured — a verification harness, a worker, a test — throwing
// where it used to work. Reading the global keeps the browser behaviour
// byte-identical to the `new DOMParser()` this replaced, and leaves the setter
// for the platform that has no global to find.

/** An element, as much of one as the route parsers touch. */
export interface XmlElement {
  /** Tag name. GPX compares it case-insensitively; TCX does not. */
  readonly nodeName: string;
  /** The element's text, or null when it has none. TCX reads every coordinate
   *  through this; GPX takes its coordinates from attributes instead. */
  readonly textContent: string | null;
  getAttribute(name: string): string | null;
  getElementsByTagName(name: string): ArrayLike<XmlElement>;
}

/** A parsed document. */
export interface XmlDocument {
  readonly documentElement: XmlElement | null;
  getElementsByTagName(name: string): ArrayLike<XmlElement>;
}

/**
 * Parse XML text into a document.
 *
 * Implementations must NOT throw for malformed input if the underlying parser
 * would rather report it in-band — the callers look for a `<parsererror>`
 * element, which is how the browser signals it, and treat a throw as the same
 * kind of failure. Either is handled; both being possible is why the callers
 * check for both.
 */
export type XmlParser = (text: string) => XmlDocument;

/** Shape of the browser's DOMParser, described without the DOM lib. */
interface DomParserConstructor {
  new (): { parseFromString(text: string, mimeType: string): XmlDocument };
}

const browserDomParser = (
  globalThis as { DOMParser?: DomParserConstructor }
).DOMParser;

const defaultParser: XmlParser | null = browserDomParser
  ? (text) => new browserDomParser().parseFromString(text, 'application/xml')
  : null;

let parser: XmlParser | null = defaultParser;

/**
 * Install the XML parser for platforms with no global DOMParser.
 *
 * On React Native this is `@xmldom/xmldom`:
 *
 *   import { DOMParser } from '@xmldom/xmldom';
 *   setXmlParser((text) => new DOMParser().parseFromString(text, 'text/xml'));
 *
 * Note that xmldom has no `querySelector`, which is why the parsers detect a
 * malformed document with getElementsByTagName('parsererror') instead.
 *
 * Pass null to restore the platform default (`globalThis.DOMParser`, or none).
 */
export function setXmlParser(next: XmlParser | null): void {
  parser = next ?? defaultParser;
}

/** True when this platform can parse XML at all. */
export function hasXmlParser(): boolean {
  return parser !== null;
}

/**
 * Parse XML, or throw if no parser has been installed on a platform without a
 * global one. The throw is deliberately not a RouteImportError: it is a wiring
 * mistake in the app, not something the user did to their file, and showing it
 * as "this file couldn't be read" would send them looking at the wrong thing.
 */
export function parseXml(text: string): XmlDocument {
  if (!parser) {
    throw new Error(
      'No XML parser is available. This platform has no global DOMParser, so ' +
        'the app must call setXmlParser() from @fjellrute/core/routes/xml ' +
        'during start-up.',
    );
  }
  return parser(text);
}

/**
 * Whether the parser reported malformed input in-band.
 *
 * The browser's DOMParser does not throw on broken XML; it returns a document
 * whose content is a `<parsererror>` element. getElementsByTagName finds it
 * wherever it was put — Firefox makes it the root, Chrome sometimes nests it —
 * and, unlike querySelector, exists on every implementation this interface is
 * meant to accept.
 */
export function isParserError(doc: XmlDocument): boolean {
  return doc.getElementsByTagName('parsererror').length > 0;
}
