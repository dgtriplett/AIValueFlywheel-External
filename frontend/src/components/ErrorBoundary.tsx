import React from 'react';

interface Props {
  children: React.ReactNode;
  /** When set, render as an in-place panel (for a drawer/modal body) with a close action. */
  onClose?: () => void;
  /** Optional label for what failed, e.g. "use case details". */
  label?: string;
}
interface State { error: Error | null }

/**
 * Catches render/runtime errors in its subtree and shows a message instead of letting
 * the whole app white-screen. Before this existed, an uncaught error in any drawer or
 * modal unmounted the entire React tree — so opening a use case (or anything in an
 * overlay) "just went blank". A boundary around each overlay keeps the rest of the app
 * alive and shows the actual error, which is also how we find the cause.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surfaced to the console for debugging; the UI shows the message below.
    console.error('ErrorBoundary caught:', error, info?.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const msg = error?.message || String(error);
    const what = this.props.label ? ` loading ${this.props.label}` : '';
    return (
      <div className="p-4 text-sm">
        <div className="rounded-lg border border-rose-600/40 bg-rose-600/10 p-4 max-w-lg">
          <div className="font-semibold text-rose-400">Something went wrong{what}.</div>
          <div className="text-navy-300 mt-1 break-words">{msg}</div>
          <div className="flex gap-2 mt-3">
            <button onClick={this.reset}
              className="text-xs rounded border border-navy-600 text-navy-300 px-3 py-1.5 hover:bg-navy-700">Try again</button>
            {this.props.onClose && (
              <button onClick={this.props.onClose}
                className="text-xs rounded border border-navy-600 text-navy-300 px-3 py-1.5 hover:bg-navy-700">Close</button>
            )}
            <button onClick={() => window.location.reload()}
              className="text-xs rounded border border-navy-600 text-navy-300 px-3 py-1.5 hover:bg-navy-700">Reload app</button>
          </div>
        </div>
      </div>
    );
  }
}
