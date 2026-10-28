import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { VaultProvider } from './hooks/useVault'
import { ToastProvider } from './components/Toast'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <VaultProvider>
        <App />
      </VaultProvider>
    </ToastProvider>
  </StrictMode>,
)
