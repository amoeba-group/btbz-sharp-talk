import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Contains a render crash instead of letting it take the widget down.
 *
 * Without one, a single bad payload field unmounted the entire tree — the panel
 * AND the launcher — so the shopper lost the widget completely with no way back
 * (that is exactly what a response-shape mismatch in the order detail did). One
 * boundary per tab keeps a failure local: chat still works if orders break.
 *
 * `resetKey` re-arms the boundary when it changes (we pass the active tab), so
 * leaving and re-entering a tab gives it a clean attempt without a page reload.
 */
interface Props {
  children: ReactNode;
  /** Identifies the crash site in logs (e.g. the tab name). */
  label?: string;
  /** Changing this clears the error state. */
  resetKey?: unknown;
}

interface State {
  error: Error | null;
}

class ErrorBoundaryInner extends Component<Props & { t: (k: string) => string }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the diagnostic — the fallback deliberately shows the shopper nothing
    // technical, so the console is the only place this is recoverable from.
    console.error(
      `[ivy-widget] render error in ${this.props.label ?? 'widget'}:`,
      error,
      info.componentStack,
    );
  }

  private reset = (): void => this.setState({ error: null });

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const { t } = this.props;
    return (
      <div
        role="alert"
        className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center"
      >
        <AlertTriangle className="h-6 w-6 text-warning" />
        <p className="text-sm font-medium text-gray-800">{t('common.crashTitle')}</p>
        <p className="text-xs text-gray-500">{t('common.crashBody')}</p>
        <button
          onClick={this.reset}
          className="mt-1 rounded-st-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          {t('common.retry')}
        </button>
      </div>
    );
  }
}

export function ErrorBoundary(props: Props) {
  const { t } = useTranslation();
  return <ErrorBoundaryInner {...props} t={t} />;
}
