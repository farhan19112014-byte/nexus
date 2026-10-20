/**
 * Failure containment (spec §16.4): a crash in one part of the screen shows a small, honest notice for that part
 * and leaves the rest working — e.g. a broken animation never blocks the chat, a panel error never blanks the page.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { area: string; children: ReactNode; compact?: boolean; onReset?: () => void }
interface State { error: Error | null; key: number }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: 0 };
  static getDerivedStateFromError(error: Error): Partial<State> { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(`[nexus] ${this.props.area} crashed:`, error, info.componentStack); }
  private retry = () => { this.props.onReset?.(); this.setState((s) => ({ error: null, key: s.key + 1 })); };
  render() {
    if (!this.state.error) return <div key={this.state.key} style={{ display: 'contents' }}>{this.props.children}</div>;
    return (
      <div className={`card error crash${this.props.compact ? ' compact' : ''}`} role="alert" data-testid="crash">
        <b>The {this.props.area} hit an unexpected error.</b>
        <div className="small muted">Everything else keeps working. Details are in the developer console: {this.state.error.message.slice(0, 160)}</div>
        <div className="row"><button onClick={this.retry}>Try again</button>{!this.props.compact && <button onClick={() => window.location.reload()}>Reload NEXUS</button>}</div>
      </div>
    );
  }
}
