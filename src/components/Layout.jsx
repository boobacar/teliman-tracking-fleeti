import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { BarChart3, ChevronRight, Database, Droplet, FileSpreadsheet, Fuel, LayoutDashboard, LogOut, Map, MapPinned, Menu, MessageCircle, ReceiptText, RefreshCw, Route, Shield, Siren, Users, X, Car } from 'lucide-react'

export const APP_VIEWS = [
  { id: '/', label: 'Dashboard', icon: LayoutDashboard, permission: 'page_dashboard' },
  { id: '/map', label: 'Live Map', icon: Map, permission: 'page_map' },
  { id: '/fleet', label: 'Flotte', icon: Car, permission: 'page_fleet' },
  { id: '/whatsapp', label: 'WhatsApp', icon: MessageCircle, permission: 'page_whatsapp' },
  { id: '/alerts', label: 'Alertes', icon: Siren, permission: 'page_alerts' },
  { id: '/analytics', label: 'Analytics', icon: BarChart3, permission: 'page_analytics' },
  { id: '/reports', label: 'Rapports', icon: FileSpreadsheet, permission: 'page_reports' },
  { id: '/drivers-report', label: 'Rapport Chauffeurs', icon: Users, permission: 'page_reports' },
  { id: '/trips-report', label: 'Rapport Trajets', icon: Route, permission: 'page_reports' },
  { id: '/delivery-orders', label: 'Bons livraison', icon: ReceiptText, permission: 'manage_delivery_orders' },
  { id: '/fuel-vouchers', label: 'Bons Carburant', icon: Fuel, permission: 'manage_fuel_vouchers' },
  { id: '/oil-changes', label: 'Vidanges', icon: Droplet, permission: 'manage_delivery_orders' },
  { id: '/data', label: 'Données', icon: Database, permission: 'manage_data' },
  { id: '/geofences', label: 'Géofences & Alertes', icon: MapPinned, permission: 'manage_data' },
  { id: '/admin-users', label: 'Utilisateurs', icon: Shield, permission: 'manage_users' },
]

export function Layout({ children, loading, refreshData, currentUser, onLogout }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const menuButtonRef = useRef(null)
  const closeButtonRef = useRef(null)
  const permissions = Array.isArray(currentUser?.permissions) ? currentUser.permissions : []
  const canAccess = (permission) => !permission || permissions.includes('*') || permissions.includes(permission)

  useEffect(() => {
    if (!mobileNavOpen) return undefined
    closeButtonRef.current?.focus()
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setMobileNavOpen(false)
        menuButtonRef.current?.focus()
      }
      if (event.key === 'Tab') {
        const focusable = document.querySelectorAll('#mobile-navigation a, #mobile-navigation button')
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [mobileNavOpen])

  return (
    <div className="app-shell premium-shell">
      <a className="skip-link" href="#main-content">Aller au contenu principal</a>
      <button ref={menuButtonRef} type="button" className="mobile-nav-toggle" onClick={() => setMobileNavOpen(true)} aria-expanded={mobileNavOpen} aria-controls="mobile-navigation">
        <span className="mobile-nav-toggle__icon"><Menu size={18} /></span>
        <span className="mobile-nav-toggle__content">
          <strong>Navigation</strong>
          <small>Ouvrir le menu</small>
        </span>
        <ChevronRight size={16} className="mobile-nav-toggle__chevron" />
      </button>

      <aside id="mobile-navigation" className={`sidebar premium-sidebar ${mobileNavOpen ? 'mobile-open' : ''}`} aria-label="Navigation principale">
        <div className="sidebar-brand-block">
          <div className="mobile-sidebar-header">
            <img src="/teliman-logistique-logo.jpg" alt="Teliman Logistique" className="sidebar-brand__logo" />
            <button ref={closeButtonRef} type="button" className="mobile-close-btn" onClick={() => { setMobileNavOpen(false); menuButtonRef.current?.focus() }} aria-label="Fermer le menu">
              <X size={18} />
            </button>
          </div>
        </div>

        <button type="button" className="primary-btn" onClick={refreshData} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
          {loading ? 'Actualisation...' : 'Rafraîchir'}
        </button>

        <div className="sidebar-user-card">
          <strong>Connecté</strong>
          <span>{currentUser?.email || 'Admin'}</span>
        </div>

        <nav className="view-nav">
          {APP_VIEWS.filter((view) => canAccess(view.permission)).map((view) => {
            const Icon = view.icon
            return (
              <NavLink
                key={view.id}
                to={view.id}
                end={view.id === '/'}
                className={({ isActive }) => `view-link ${isActive ? 'active' : ''}`}
                onClick={() => setMobileNavOpen(false)}
              >
                <Icon size={18} />
                <span>{view.label}</span>
                <ChevronRight size={16} />
              </NavLink>
            )
          })}
        </nav>

        <button type="button" className="ghost-btn sidebar-logout" onClick={onLogout}>
          <LogOut size={16} />
          Déconnexion
        </button>
      </aside>

      <main id="main-content" tabIndex={-1} className="main-content premium-main">
        {children}
      </main>
    </div>
  )
}
