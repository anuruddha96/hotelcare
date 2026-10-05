import React from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw, Copy } from 'lucide-react';
import { reportClientError, getLastAction } from '@/lib/clientErrorReporter';
import { freshApplicationUrl, isExternalDomMutationCrash, isLazyModuleCrash } from '@/lib/lazyModuleRecovery';

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

    if (isExternalDomMutationCrash(error)) {
      // Stop browser translation from mutating any more React-managed nodes
      // before the technician taps Reload.
      document.documentElement.setAttribute('translate', 'no');
      document.documentElement.classList.add('notranslate');
      document.body?.setAttribute('translate', 'no');
      document.body?.classList.add('notranslate');
      document.getElementById('root')?.setAttribute('translate', 'no');
      document.getElementById('root')?.classList.add('notranslate');
    }

    void reportClientError(error, {
      componentStack: info.componentStack || undefined,
      context: this.props.context || 'ErrorBoundary',
    });
  }

  handleReset = () => {
    // React.lazy remembers a fulfilled-but-undefined module. Resetting the
    // boundary immediately rethrows, so use a fresh document for this case.
    if (
      isLazyModuleCrash(this.state.error, this.state.componentStack) ||
      isExternalDomMutationCrash(this.state.error)
    ) {
      this.handleReload();
      return;
    }
    this.setState({ hasError: false, error: null, componentStack: null });
    this.props.onReset?.();
  };

  handleReload = () => {
    const needsFreshDocument =
      isLazyModuleCrash(this.state.error, this.state.componentStack) ||
      isExternalDomMutationCrash(this.state.error);

    if (needsFreshDocument) {
      // A fresh document also removes browser-translator wrappers or extension
      // mutations that no longer match React's virtual DOM.
      window.location.replace(freshApplicationUrl(window.location.href, Date.now()));
      return;
    }
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
      const lazyModuleCrash = isLazyModuleCrash(this.state.error, this.state.componentStack);
      const externalDomMutationCrash = isExternalDomMutationCrash(this.state.error);
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
              {lazyModuleCrash
                ? 'A part of the app did not load correctly. Reload the latest app version to continue. Any unsaved changes may be lost.'
                : externalDomMutationCrash
                  ? 'The page was changed outside HotelCare, usually by browser translation. Reload to restore the app. Saved work is kept.'
                  : this.props.fallbackMessage || 'An unexpected error occurred. Please try again.'}
            </p>
            {this.state.error?.message && (
              <p className="text-xs text-muted-foreground mt-2 font-mono break-all">
                {this.state.error.message}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button onClick={isFullscreen || lazyModuleCrash || externalDomMutationCrash ? this.handleReload : this.handleReset} variant="default">
              <RefreshCw className="h-4 w-4 mr-2" />
              {lazyModuleCrash || externalDomMutationCrash ? 'Reload latest version' : isFullscreen ? 'Reload' : 'Retry'}
            </Button>
            {isFullscreen && !lazyModuleCrash && (
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
