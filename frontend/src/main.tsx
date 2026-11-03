import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { FeatureFlagProvider } from './lib/featureFlags'
import { ErrorBoundary } from './components/ErrorBoundary'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <FeatureFlagProvider>
        <App />
      </FeatureFlagProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
