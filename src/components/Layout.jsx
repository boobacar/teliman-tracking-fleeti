import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { BarChart3, Camera, ChevronRight, Database, FileSpreadsheet, Fuel, LayoutDashboard, LogOut, Map, Menu, ReceiptText, RefreshCw, Route, Shield, Siren, Users, X, Car } from 'lucide-react'

export const APP_VIEWS = [
  { id: '/', label: 'Dashboard', icon: LayoutDashboard, permission: 'page_dashboard' },
  { id: '/map', label: 'Live Map', icon: Map, permission: 'page_map' },
  { id: '/fleet', label: 'Flotte', icon: Car, permission: 'page_fleet' },
  { id: '/cameras', label: 'Caméras', icon: Camera, permission: 'page_fleet' },
  { id: '/alerts', label: 'Alertes', icon: Siren, permission: 'page_alerts' },
  { id: '/analytics', label: 'Analytics', icon: BarChart3, permission: 'page_analytics' },
  { id: '/reports', label: 'Rapports', icon: FileSpreadsheet, permission: 'page_reports' },
  { id: '/drivers-report', label: 'Rapport Chauffeurs', icon: Users, permission: 'page_reports' },
  { id: '/trips-report', label: 'Rapport Trajets', icon: Route, permission: 'page_reports' },
  { id: '/delivery-orders', label: 'Bons livraison', icon: ReceiptText, permission: 'manage_delivery_orders' },
  { id: '/fuel-vouchers', label: 'Bons Carburant', icon: Fuel, permission: 'manage_fuel_vouchers' },
  { id: '/data', label: 'Données', icon: Database, permission: 'manage_data' },
  { id: '/admin-users', label: 'Utilisateurs', icon: Shield, permission: 'manage_users' },
]

export function Layout({ children, loading, refreshData, search, setSearch, dataset, currentUser, onLogout }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const permissions = Array.isArray(currentUser?.permissions) ? currentUser.permissions : []
  const canAccess = (permission) => !permission || permissions.includes('*') || permissions.includes(permission)

  return (
    <div className="app-shell premium-shell phase2-shell">
      <button type="button" className="mobile-nav-toggle" onClick={() => setMobileNavOpen(true)}><Menu size={20} /> Menu</button>
      <aside className={`sidebar premium-sidebar ${mobileNavOpen ? 'mobile-open' : ''}`}>
        <div>
          <div className="mobile-sidebar-header"><div><div className="brand-badge">TELIMAN</div><h1>Operations</h1><p>Flotte, alertes et pilotage.</p></div><button type="button" className="mobile-close-btn" onClick={() => setMobileNavOpen(false)}><X size={18} /></button></div>
        </div>
        <button type="button" className="primary-btn" onClick={refreshData} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''} />{loading ? 'Actualisation...' : 'Rafraîchir'}</button>
        <div style={{ marginTop: 12, marginBottom: 12, padding: '12px 14px', borderRadius: 14, background: 'rgba(255,255,255,0.06)', color: '#e2e8f0' }}>
          <strong style={{ display: 'block', fontSize: 13 }}>Connecté</strong>
          <span style={{ fontSize: 12, color: '#cbd5e1' }}>{currentUser?.email || 'Admin'}</span>
        </div>
        <nav className="view-nav">{APP_VIEWS.filter((view) => canAccess(view.permission)).map((view) => { const Icon = view.icon; return <NavLink key={view.id} to={view.id} end={view.id === '/'} className={({ isActive }) => `view-link ${isActive ? 'active' : ''}`} onClick={() => setMobileNavOpen(false)}><Icon size={18} /><span>{view.label}</span><ChevronRight size={16} /></NavLink> })}</nav>
        <button type="button" className="ghost-btn" style={{ marginTop: 16 }} onClick={onLogout}><LogOut size={16} />Déconnexion</button>
      </aside>

      <main className="main-content premium-main">
        {children}
      </main>
    </div>
  )
}
