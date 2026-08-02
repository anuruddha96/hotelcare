import React from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw, Copy } from 'lucide-react';
import { reportClientError, getLastAction } from '@/lib/clientErrorReporter';

interface Props {
  children: React.ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  onReset?: () => void;
  /** Where this boundary sits — stored with the crash report. */
  context?: string;
  /** Full-screen layout with a reload button (use at the app root). */
  variant?: 'inline' | 'fullscreen';
}

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught render error:', error, info);
    this.setState({ componentStack: info.componentStack || null });
    void reportClientError(error, {
      componentStack: info.componentStack || undefined,
      context: this.props.context || 'ErrorBoundary',
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, componentStack: null });
    this.props.onReset?.();
  };

  handleReload = () => {
    window.location.reload();
  };

  handleCopyDiagnostics = async () => {
    const { lastAction, lastContext } = getLastAction();
    const text = [
      `Error: ${this.state.error?.message}`,
      `Context: ${this.props.context || '-'}`,
      `Last action: ${lastAction || '-'}${lastContext ? ` (${lastContext})` : ''}`,
      `Route: ${window.location.pathname}`,
      `UA: ${navigator.userAgent}`,
      `Screen: ${window.innerWidth}x${window.innerHeight}`,
      this.state.error?.stack || '',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard blocked — nothing else to do, the report is already stored.
    }
  };

  render() {
    if (this.state.hasError) {
      const isFullscreen = this.props.variant === 'fullscreen';
      return (
        <div
          className={`flex flex-col items-center justify-center p-6 text-center space-y-4 ${
            isFullscreen ? 'min-h-[100dvh] bg-background' : 'min-h-[200px]'
          }`}
        >
          <AlertTriangle className="h-10 w-10 text-destructive" />
          <div>
            <h3 className="font-semibold text-lg">
              {this.props.fallbackTitle || 'Something went wrong'}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              {this.props.fallbackMessage ||
                'An unexpected error occurred. Please try again.'}
            </p>
            {this.state.error?.message && (
              <p className="text-xs text-muted-foreground mt-2 font-mono break-all">
                {this.state.error.message}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button onClick={isFullscreen ? this.handleReload : this.handleReset} variant="default">
              <RefreshCw className="h-4 w-4 mr-2" />
              {isFullscreen ? 'Reload' : 'Retry'}
            </Button>
            {isFullscreen && (
              <Button onClick={this.handleReset} variant="outline">
                Try again
              </Button>
            )}
            <Button onClick={this.handleCopyDiagnostics} variant="ghost" size="sm">
              <Copy className="h-4 w-4 mr-2" />
              Copy details
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
