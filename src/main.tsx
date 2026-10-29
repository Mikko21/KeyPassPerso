import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { InstallPrompt } from './components/InstallPrompt'
import { VaultProvider } from './hooks/useVault'
import { ToastProvider } from './components/Toast'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <VaultProvider>
        <App />
        <InstallPrompt />
      </VaultProvider>
    </ToastProvider>
  </StrictMode>,
)

// Register the service worker in production builds only (installability + fast shell loads).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
