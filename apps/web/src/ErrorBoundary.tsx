import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Catches render/runtime errors anywhere below it and shows a recoverable
 * message instead of letting React unmount the whole tree to a blank white
 * screen. Without this, any error thrown during render (an unexpected API
 * shape, a null dereference) leaves the user staring at an empty
 * <div id="root"> with nothing to act on.
 *
 * Note: this cannot catch a failure to *load or parse* the JS bundle itself
 * (e.g. a stale index.html asking for a deleted hashed bundle) — React never
 * starts in that case. That failure mode is handled on the server side by
 * returning a real 404 for missing build assets (worker/index.js) and by
 * serving index.html no-cache so a reload picks up the current bundle.
 */
type Props = { children: ReactNode };
type State = { error: Error | null };

// The page renders in Norwegian by default; main.tsx sets <html lang> from
// the persisted locale, so read it here rather than pulling in the i18n
// module (which could itself be implicated in the error being caught).
function isNorwegian(): boolean {
  try {
    return document.documentElement.lang !== 'en';
  } catch {
    return true;
  }
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface for the browser console / Cloudflare observability. Kept
    // deliberately minimal; no external error-reporting dependency.
    console.error('Unhandled render error', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    const no = isNorwegian();
    const title = no ? 'Noe gikk galt' : 'Something went wrong';
    const body = no
      ? 'Appen støtte på en uventet feil. Last siden på nytt for å prøve igjen.'
      : 'The app hit an unexpected error. Reload the page to try again.';
    const reload = no ? 'Last på nytt' : 'Reload';

    return (
      <div
        role="alert"
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 24,
          textAlign: 'center',
          background: '#0b1018',
          color: 'rgba(255,255,255,0.92)',
          fontFamily:
            "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>{title}</h1>
        <p
          style={{
            margin: 0,
            maxWidth: 420,
            fontSize: 15,
            lineHeight: 1.5,
            color: 'rgba(255,255,255,0.62)',
          }}
        >
          {body}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            marginTop: 8,
            padding: '10px 20px',
            fontSize: 15,
            fontWeight: 600,
            color: '#04241f',
            background: '#2dd4bf',
            border: 'none',
            borderRadius: 999,
            cursor: 'pointer',
          }}
        >
          {reload}
        </button>
      </div>
    );
  }
}
