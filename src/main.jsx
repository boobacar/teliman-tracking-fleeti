import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ScrollToTop } from './components/ScrollToTop'
import { startMobileTableLabels } from './lib/mobileTableLabels'
import './index.css'
// Couche mobile chargée en dernier : elle doit gagner la cascade sur App.css.
import './styles/mobile.css'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('[SW] Registration failed:', error)
    })
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ScrollToTop />
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)

// Les tableaux de liste deviennent des cartes sur téléphone : il leur faut les
// libellés de colonnes (attribut data-label lu par le CSS).
startMobileTableLabels()
