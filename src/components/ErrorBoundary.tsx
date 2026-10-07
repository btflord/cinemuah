import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Icon } from './Icon';

interface Props {
  children: ReactNode;
  /** Shown in the heading, e.g. "this page". */
  scope?: string;
  /** Called when the user presses "Go home" (full-app boundary omits it and reloads instead). */
  onReset?: () => void;
  /** Changing this value clears the error, e.g. when the user navigates to another page. */
  resetKey?: unknown;
}

interface State {
  error: Error | null;
}

/** Catches render errors so one broken component shows a recoverable message instead of a blank window. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error:', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="empty-state" role="alert" style={{ paddingTop: 140 }}>
        <div className="empty-icon"><Icon name="warning" /></div>
        <h2 className="empty-title">Something went wrong in {this.props.scope ?? 'CineLocal'}</h2>
        <p className="empty-subtitle" style={{ maxWidth: 520 }}>{error.message || 'An unexpected error occurred.'}</p>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn btn-accent" onClick={this.retry}>
            <Icon name="refresh" /> Try again
          </button>
          {this.props.onReset ? (
            <button className="btn btn-ghost" onClick={() => { this.retry(); this.props.onReset?.(); }}>Back to Shelf</button>
          ) : (
            <button className="btn btn-ghost" onClick={() => window.location.reload()}>Reload app</button>
          )}
        </div>
      </div>
    );
  }
}
