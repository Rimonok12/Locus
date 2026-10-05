"use client";
/* ─── Locus · error boundary (a crash in one view or overlay never blanks the workspace) ─── */

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** when this changes (e.g. the path), a caught error is cleared without remounting healthy children */
  resetKey?: string;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** e.g. close the overlay that crashed, so its "open" state never lingers with nothing on screen */
  onError?: (error: Error) => void;
  children: ReactNode;
}
interface State { error: Error | null; key: string | undefined }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[locus] view crashed", error, info.componentStack);
    this.props.onError?.(error);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) return this.props.fallback ? this.props.fallback(this.state.error, this.reset) : null;
    return this.props.children;
  }
}
