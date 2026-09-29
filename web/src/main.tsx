import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, App as AntApp, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from './App';
import { GlobalStyles } from './ui';
import { AppLayout } from './components/AppLayout';

// Surface uncaught errors on `window.__dtErrors`. The screenshot tool and any
// smoke test can then assert "the page rendered" instead of trusting a PNG.
declare global {
  interface Window {
    __dtErrors?: string[];
  }
}
window.__dtErrors = [];
window.addEventListener('error', (event) => {
  window.__dtErrors?.push(`${event.message} @ ${event.filename}:${event.lineno}`);
});
window.addEventListener('unhandledrejection', (event) => {
  window.__dtErrors?.push(`unhandled rejection: ${String(event.reason)}`);
});

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: '#0b5cad',
          colorInfo: '#0b5cad',
          colorSuccess: '#1c7a3d',
          colorWarning: '#d97706',
          colorError: '#d02f2f',
          borderRadius: 8,
          fontSize: 13.5,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Inter, Arial, sans-serif',
          colorBgLayout: '#f5f7fa',
        },
        components: {
          Layout: { headerBg: '#fff', siderBg: '#fff', bodyBg: '#f5f7fa' },
          Card: { paddingLG: 16 },
          Table: { cellPaddingBlock: 9 },
          Statistic: { contentFontSize: 26 },
        },
      }}
    >
      <AntApp>
        <GlobalStyles />
        <BrowserRouter>
          <AppLayout>
            <AppRoutes />
          </AppLayout>
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
