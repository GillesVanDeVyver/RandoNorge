// Shared error for every route-import parser (GPX, TCX, FIT). Kept in its own
// module so the individual parsers can throw it without importing one another,
// and so the UI can show the thrown `message` directly to the user.
export class RouteImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RouteImportError';
  }
}
