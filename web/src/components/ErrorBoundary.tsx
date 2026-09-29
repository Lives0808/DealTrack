import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Card, Result, Typography } from 'antd';

/**
 * Catches render errors so a broken widget never takes the whole console down.
 *
 * Before this existed, one bad `.map()` on an unexpectedly-null field blanked
 * the entire page — which reads to a user as "the system is down" rather than
 * "one panel has a bug". Now the failure is contained, reported, and recoverable
 * without a reload.
 */
interface Props {
  children: ReactNode;
  /** Shown in the fallback so the user knows which panel failed. */
  label?: string;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ info });
    // Keep the uncaught-error trail that the screenshot tool reads.
    window.__dtErrors?.push(`render error: ${error.message}`);
    this.props.onError?.(error, info);
    // eslint-disable-next-line no-console
    console.error('[dealtrack] render error', error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null, info: null });
  };

  render(): ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <Card size="small">
        <Result
          status="warning"
          title={this.props.label ? `${this.props.label} 渲染出错` : '这个面板渲染出错'}
          subTitle="其余功能不受影响。可以先重试；如果反复出错，展开下方详情反馈。"
          extra={[
            <Button key="retry" type="primary" onClick={this.reset}>
              重试
            </Button>,
            <Button key="reload" onClick={() => window.location.reload()}>
              刷新页面
            </Button>,
          ]}
        >
          <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, marginBottom: 4 }}>
            {error.message}
          </Typography.Paragraph>
          {info?.componentStack && (
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 12 }}>组件栈</summary>
              <pre className="dt-mono" style={{ whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto' }}>
                {info.componentStack}
              </pre>
            </details>
          )}
        </Result>
      </Card>
    );
  }
}

declare global {
  interface Window {
    __dtErrors?: string[];
  }
}
