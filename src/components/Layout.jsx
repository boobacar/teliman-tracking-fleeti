import { NavLink } from 'react-router-dom'
import { AlertTriangle, BarChart3, ChevronRight, LayoutDashboard, Map, RefreshCw, Search, ShieldAlert, Siren, Users, Car } from 'lucide-react'

const views = [
  { id: '/', label: 'Dashboard', icon: LayoutDashboard },
  { id: '/map', label: 'Live Map', icon: Map },
  { id: '/trackers', label: 'Trackers', icon: Car },
  { id: '/drivers', label: 'Chauffeurs', icon: Users },
  { id: '/alerts', label: 'Alertes', icon: Siren },
  { id: '/analytics', label: 'Analytics', icon: BarChart3 },
]

export function Layout({ children, loading, refreshData, search, setSearch, filter, setFilter, dataset }) {
  return (
    <div className="app-shell premium-shell phase2-shell">
      <aside className="sidebar premium-sidebar">
        <div>
          <div className="brand-badge">TELIMAN</div>
          <h1>Operations</h1>
          <p>Flotte, alertes et pilotage.</p>
        </div>
        <button className="primary-btn" onClick={refreshData} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''} />{loading ? 'Actualisation...' : 'Rafraîchir'}</button>
        <div className="search-box"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Chercher tracker ou chauffeur" /></div>
        <nav className="view-nav">{views.map((view) => { const Icon = view.icon; return <NavLink key={view.id} to={view.id} end={view.id === '/'} className={({ isActive }) => `view-link ${isActive ? 'active' : ''}`}><Icon size={18} /><span>{view.label}</span><ChevronRight size={16} /></NavLink> })}</nav>
        <div className="filters">{['all', 'active', 'idle', 'offline'].map((value) => <button key={value} className={`chip ${filter === value ? 'selected' : ''}`} onClick={() => setFilter(value)}>{value}</button>)}</div>
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
