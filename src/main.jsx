import React from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { store } from './store/store';
if (typeof window !== 'undefined') {
  window.__store = store;
}
import App from './App';
import './index.css';
import { applyChromeThemeFromSettings, applyStealthWindowChrome } from './hooks/useChromeTheme';

const SETTINGS_FALLBACK = {
  colorTheme: 'automatic',
  accentTheme: 'default',
  accentCustomHex: null,
};

/**
 * Apply accent + brightness tokens before React mounts so first paint never shows
 * dark-toolbar defaults on a light chrome strip (white icons on white).
 */
async function bootstrapShellTheme() {
  try {
    const api = window.electronAPI;
    const bootstrap = api?.windowGetBootstrap ? await api.windowGetBootstrap() : null;
    if (bootstrap) {
      window.__APP_BOOTSTRAP = bootstrap;
    }
    if (bootstrap?.ghostWindow) {
      window.__INVISURF_GHOST_WINDOW__ = true;
    }
    if (bootstrap?.stealthWindow) {
      window.__INVISURF_STEALTH_WINDOW__ = true;
      applyStealthWindowChrome();
      return;
    }
    if (api?.settingsGet) {
      const s = await api.settingsGet();
      applyChromeThemeFromSettings(s && typeof s === 'object' ? s : SETTINGS_FALLBACK);
    } else {
      applyChromeThemeFromSettings(SETTINGS_FALLBACK);
    }
  } catch {
    applyChromeThemeFromSettings(SETTINGS_FALLBACK);
  }
}

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[RootErrorBoundary caught error]', error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '24px',
          color: '#ef4444',
          background: '#18181b',
          height: '100vh',
          boxSizing: 'border-box',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          overflow: 'auto',
          userSelect: 'text',
        }}>
          <h2 style={{ margin: '0 0 12px', fontSize: '18px', color: '#f87171' }}>
            InviSurf Shell UI Error
          </h2>
          <div style={{
            background: '#27272a',
            padding: '12px',
            borderRadius: '8px',
            marginBottom: '12px',
            fontFamily: 'monospace',
            fontSize: '13px',
            color: '#fca5a5',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}>
            {this.state.error?.toString() || 'Unknown error'}
          </div>
          {this.state.errorInfo?.componentStack && (
            <pre style={{
              background: '#27272a',
              padding: '12px',
              borderRadius: '8px',
              fontSize: '11px',
              color: '#a1a1aa',
              overflow: 'auto',
              maxHeight: '300px',
            }}>
              {this.state.errorInfo.componentStack}
            </pre>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '16px',
              padding: '8px 16px',
              background: '#3b82f6',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Reload Window
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

window.addEventListener('error', (event) => {
  console.error('[renderer window error]', event.message, event.filename, event.lineno, event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[renderer unhandled rejection]', event.reason);
});

async function bootstrap() {
  try {
    await bootstrapShellTheme();

    const container = document.getElementById('root');
    if (!container) {
      console.error('[bootstrap] #root element not found in document');
      return;
    }
    const root = createRoot(container);
    root.render(
      <RootErrorBoundary>
        <Provider store={store}>
          <App />
        </Provider>
      </RootErrorBoundary>,
    );
  } catch (err) {
    console.error('[bootstrap fatal error]', err);
  }
}

bootstrap().catch((err) => {
  console.error('[bootstrap unhandled error]', err);
});
