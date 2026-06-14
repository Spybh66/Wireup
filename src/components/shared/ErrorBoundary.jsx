// Top-level error boundary — shows a friendly crash screen instead of a blank
// page, logs the error to the console (no telemetry), and offers recovery.
import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Local console only — no network/telemetry.
    console.error('Wireup crashed:', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-surface-0 p-8 text-center text-silver">
        <h1 className="font-heading text-2xl font-semibold">Something went wrong</h1>
        <p className="max-w-md text-sm text-neutral-400">
          Wireup hit an unexpected error. Your work is autosaved — reloading usually recovers it. If
          it keeps happening, you can reset the app (this clears local settings, not saved files).
        </p>
        <pre className="max-h-40 max-w-lg overflow-auto rounded border border-edge bg-surface-1 p-3 text-left text-xs text-red-300">
          {String(this.state.error?.message || this.state.error)}
        </pre>
        <div className="flex gap-2">
          <button
            onClick={() => window.location.reload()}
            className="rounded bg-silver px-3 py-1.5 text-sm font-semibold text-surface-0 hover:bg-white"
          >
            Reload
          </button>
          <button
            onClick={() => {
              try {
                localStorage.removeItem('wireup_settings');
              } catch { /* ignore */ }
              window.location.href = window.location.pathname;
            }}
            className="rounded border border-edge bg-surface-2 px-3 py-1.5 text-sm text-silver hover:bg-surface-0"
          >
            Reset &amp; reload
          </button>
        </div>
      </div>
    );
  }
}
