import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorScreen } from './error-screen';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Last-resort error boundary: catches render/lifecycle throws anywhere in the
 * tree below it (AppShell, providers) and renders a self-contained fallback
 * instead of an unmountable blank page. Context-free — it sits below
 * MotionConfig/AnnouncerProvider but does not depend on them.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary] Caught render error:', error, info);
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <ErrorScreen message="Something went wrong. Reload the page to try again." />
      );
    }
    return this.props.children;
  }
}
