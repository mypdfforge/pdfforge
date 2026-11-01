import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

// Register service worker for persistent offline caching of WASM engines & assets
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[SW] ServiceWorker registration notice:', err)
    })
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
