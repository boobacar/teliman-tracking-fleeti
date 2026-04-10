import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { AlertTriangle, BarChart3, ChevronRight, Database, FileSpreadsheet, Fuel, LayoutDashboard, Map, Menu, ReceiptText, RefreshCw, ShieldAlert, Siren, X, Car } from 'lucide-react'

const views = [
  { id: '/', label: 'Dashboard', icon: LayoutDashboard },
  { id: '/map', label: 'Live Map', icon: Map },
  { id: '/fleet', label: 'Flotte', icon: Car },
  { id: '/alerts', label: 'Alertes', icon: Siren },
  { id: '/analytics', label: 'Analytics', icon: BarChart3 },
  { id: '/reports', label: 'Rapports', icon: FileSpreadsheet },
  { id: '/delivery-orders', label: 'Bons livraison', icon: ReceiptText },
  { id: '/fuel-vouchers', label: 'Bons Carburant', icon: Fuel },
  { id: '/data', label: 'Données', icon: Database },
]

export function Layout({ children, loading, refreshData, search, setSearch, dataset }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    <div className="app-shell premium-shell phase2-shell">
      <button className="mobile-nav-toggle" onClick={() => setMobileNavOpen(true)}><Menu size={20} /> Menu</button>
      <aside className={`sidebar premium-sidebar ${mobileNavOpen ? 'mobile-open' : ''}`}>
        <div>
          <div className="mobile-sidebar-header"><div><div className="brand-badge">TELIMAN</div><h1>Operations</h1><p>Flotte, alertes et pilotage.</p></div><button className="mobile-close-btn" onClick={() => setMobileNavOpen(false)}><X size={18} /></button></div>
        </div>
        <button className="primary-btn" onClick={refreshData} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''} />{loading ? 'Actualisation...' : 'Rafraîchir'}</button>
        <nav className="view-nav">{views.map((view) => { const Icon = view.icon; return <NavLink key={view.id} to={view.id} end={view.id === '/'} className={({ isActive }) => `view-link ${isActive ? 'active' : ''}`} onClick={() => setMobileNavOpen(false)}><Icon size={18} /><span>{view.label}</span><ChevronRight size={16} /></NavLink> })}</nav>
      </aside>

      <main className="main-content premium-main">
        <section className="hero-panel premium-hero premium-hero-phase2 compact-hero">
          <div className="hero-quickstats">
            <div className="meta-box"><ShieldAlert size={18} /><span>{dataset?.rules?.length ?? 0} règles actives</span></div>
            <div className="meta-box"><AlertTriangle size={18} /><span>{dataset?.unreadCount ?? 0} alertes non lues</span></div>
          </div>
        </section>
        {children}
      </main>
    </div>
  )
}
