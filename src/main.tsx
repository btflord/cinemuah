import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { ToastProvider } from './contexts/ToastContext'
import { MediaProvider } from './contexts/MediaContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import { clientAPI } from './services/api'
import { webApi } from './services/webApi'
import { IS_WEB } from './lib/platform'
import { initImmersive } from './lib/immersive'
import { initTheme } from './lib/theme'
import './styles/globals.css'

// Desktop: preload provides window.electronAPI. Web build: the serverless-backed adapter.
if (IS_WEB) {
  (window as any).electronAPI = webApi;
  document.documentElement.dataset.platform = 'web';
} else if (typeof window !== 'undefined' && !(window as any).electronAPI) {
  (window as any).electronAPI = clientAPI;
}

initTheme();
initImmersive();

// Surface async failures nobody awaited in the console instead of failing silently
window.addEventListener('unhandledrejection', event => {
  console.error('Unhandled promise rejection:', event.reason);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <MediaProvider>
          <App />
        </MediaProvider>
      </ToastProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
