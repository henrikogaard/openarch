import { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional label of the area that failed, shown in the fallback panel. */
  name?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Per-tab error boundary: a render error shows a recoverable panel instead of
 * blanking the whole app. The model stays in memory, so "Try again" after the
 * underlying problem is fixed recovers without a reload.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }): void {
    console.error(`ErrorBoundary${this.props.name ? ` (${this.props.name})` : ''} caught:`, error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="error-boundary" role="alert">
          <h2>Something went wrong{this.props.name ? ` in ${this.props.name}` : ''}</h2>
          <p className="error-boundary-message">{this.state.error.message}</p>
          <p className="error-boundary-hint">Your model is still in memory and autosave is unaffected.</p>
          <button onClick={this.reset}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
