import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { PreferencesProvider } from './lib/preferences'
import App from './App.tsx'

document.documentElement.classList.add('dark')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PreferencesProvider><App /></PreferencesProvider>
  </StrictMode>,
)
