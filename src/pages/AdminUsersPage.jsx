import { useEffect, useMemo, useState } from 'react'
import { Search, Shield, UserCog, UserPlus, Users } from 'lucide-react'
import { APP_VIEWS } from '../components/Layout'
import { createAdminUser, deleteAdminUser, loadAdminUsers, updateAdminUser } from '../lib/fleeti'

const PAGE_PERMISSIONS = APP_VIEWS.map((view) => ({ permission: view.permission, label: view.label }))

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin', permissions: ['*'] },
  { value: 'ops', label: 'Exploitation', permissions: ['manage_delivery_orders', 'manage_fuel_vouchers', 'page_dashboard', 'page_map', 'page_fleet', 'page_alerts', 'page_analytics', 'page_reports'] },
  { value: 'viewer', label: 'Lecture seule', permissions: ['page_dashboard', 'page_map', 'page_fleet', 'page_alerts', 'page_analytics', 'page_reports'] },
]

function getDefaultPermissions(role) {
  const roleConfig = ROLE_OPTIONS.find((item) => item.value === role)
  return (roleConfig?.permissions || []).filter((entry) => entry !== '*')
}

export function AdminUsersPage() {
  const [users, setUsers] = useState([])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('viewer')
  const [selectedPermissions, setSelectedPermissions] = useState(getDefaultPermissions('viewer'))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [editingEmail, setEditingEmail] = useState('')
  const [editingRole, setEditingRole] = useState('viewer')
  const [editingPassword, setEditingPassword] = useState('')
  const [editingPermissions, setEditingPermissions] = useState(getDefaultPermissions('viewer'))

  async function refresh() {
    setLoading(true)
    setError('')
    try {
      const payload = await loadAdminUsers()
      setUsers(payload.items || [])
    } catch (err) {
      setError(err.message || 'Impossible de charger les utilisateurs.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  async function submit(e) {
    e.preventDefault()
    setError('')
    try {
      await createAdminUser({ email, password, role, permissions: role === 'admin' ? ['*'] : selectedPermissions })
      setEmail('')
      setPassword('')
      setRole('viewer')
      setSelectedPermissions(getDefaultPermissions('viewer'))
      await refresh()
    } catch (err) {
      setError(err.message || 'Impossible de créer cet utilisateur.')
    }
  }

  function startEdit(user) {
    setEditingEmail(user.email)
    setEditingRole(user.role || 'viewer')
    setEditingPassword('')
    setEditingPermissions(Array.isArray(user.permissions) ? user.permissions.filter((entry) => entry !== '*') : [])
    setError('')
  }

  async function saveEdit() {
    try {
      await updateAdminUser(editingEmail, {
        role: editingRole,
        permissions: editingRole === 'admin' ? ['*'] : editingPermissions,
        password: editingPassword || undefined,
      })
      setEditingEmail('')
      setEditingRole('viewer')
      setEditingPassword('')
      setEditingPermissions(getDefaultPermissions('viewer'))
      await refresh()
    } catch (err) {
      setError(err.message || 'Impossible de mettre à jour cet utilisateur.')
    }
  }

  const filteredUsers = useMemo(() => users.filter((user) => {
    const haystack = `${user.email} ${user.role} ${(user.permissions || []).join(' ')}`.toLowerCase()
    return haystack.includes(search.toLowerCase())
  }), [users, search])

  const roleStats = useMemo(() => ({
    total: users.length,
    admins: users.filter((user) => user.role === 'admin').length,
    ops: users.filter((user) => user.role === 'ops').length,
    viewers: users.filter((user) => user.role === 'viewer').length,
  }), [users])

  function roleBadge(roleValue) {
    if (roleValue === 'admin') return { label: 'Admin', bg: '#dcfce7', color: '#166534' }
    if (roleValue === 'ops') return { label: 'Exploitation', bg: '#dbeafe', color: '#1d4ed8' }
    return { label: 'Lecture', bg: '#f1f5f9', color: '#334155' }
  }

  async function remove(emailToDelete) {
    if (!window.confirm(`Supprimer ${emailToDelete} ?`)) return
    try {
      await deleteAdminUser(emailToDelete)
      await refresh()
    } catch (err) {
      setError(err.message || 'Impossible de supprimer cet utilisateur.')
    }
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <section className="panel panel-large reports-v2-hero">
        <div className="panel-header"><div><h3>Administration des utilisateurs</h3><p>Créer des comptes, définir un rôle et attribuer un mot de passe.</p></div></div>
        <section className="reports-summary-grid reports-v2-kpis">
          <div className="overview-card"><span>Total</span><strong>{roleStats.total}</strong><small>comptes configurés</small></div>
          <div className="overview-card"><span>Admins</span><strong>{roleStats.admins}</strong><small>accès complet</small></div>
          <div className="overview-card"><span>Exploitation</span><strong>{roleStats.ops}</strong><small>opérations terrain</small></div>
          <div className="overview-card"><span>Lecture</span><strong>{roleStats.viewers}</strong><small>consultation simple</small></div>
        </section>
      </section>

      <section className="panel panel-large data-card-panel" style={{ minHeight: 'unset', alignContent: 'start' }}>
        <div className="panel-header" style={{ marginBottom: 12 }}><div><h3><UserPlus size={18} style={{ marginRight: 8, verticalAlign: 'middle' }} />Ajouter un utilisateur</h3></div></div>
        <form className="delivery-form delivery-form-premium data-card-form" style={{ gridTemplateColumns: '1.2fr 1fr 0.8fr auto', marginBottom: 0, alignItems: 'center' }} onSubmit={submit}>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Adresse email" type="text" required />
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mot de passe" type="text" required />
          <select value={role} onChange={(e) => {
            const nextRole = e.target.value
            setRole(nextRole)
            setSelectedPermissions(getDefaultPermissions(nextRole))
          }}>
            {ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <button className="primary-btn" type="submit">Créer</button>
        </form>
        {role !== 'admin' && (
          <div className="delivery-form delivery-form-premium data-card-form" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', marginTop: 14 }}>
            {PAGE_PERMISSIONS.map((item) => (
              <label key={item.permission} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid rgba(148,163,184,0.18)', borderRadius: 12 }}>
                <input
                  type="checkbox"
                  checked={selectedPermissions.includes(item.permission)}
                  onChange={(e) => setSelectedPermissions((prev) => e.target.checked ? Array.from(new Set([...prev, item.permission])) : prev.filter((entry) => entry !== item.permission))}
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
        )}
        {error && <div className="error-banner" style={{ marginTop: 12 }}>{error}</div>}
      </section>

      <section className="panel panel-large">
        <div className="panel-header"><div><h3><Users size={18} style={{ marginRight: 8, verticalAlign: 'middle' }} />Utilisateurs existants</h3></div></div>
        {loading && <div className="info-banner">Chargement des utilisateurs…</div>}
        <div className="delivery-form delivery-form-premium data-card-form" style={{ gridTemplateColumns: '1fr' }}>
          <label className="field-stack">
            <span>Recherche</span>
            <div style={{ position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: 12, top: 14, color: '#64748b' }} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher par email, rôle ou permission" style={{ paddingLeft: 38 }} />
            </div>
          </label>
        </div>
        <div className="reports-table-wrap">
          <table className="reports-table">
            <thead><tr><th>Email</th><th>Rôle</th><th>Permissions</th><th>Actions</th></tr></thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.email}>
                  <td>{user.email}</td>
                  <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: roleBadge(user.role).bg, color: roleBadge(user.role).color, fontWeight: 600, fontSize: 12 }}><Shield size={13} />{roleBadge(user.role).label}</span></td>
                  <td>{Array.isArray(user.permissions) ? user.permissions.join(', ') || 'Aucune' : 'Aucune'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button className="ghost-btn small-btn" onClick={() => startEdit(user)}><UserCog size={14} />Modifier</button>
                      <button className="ghost-btn small-btn danger-btn" onClick={() => remove(user.email)}>Supprimer</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredUsers.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: '#94a3b8' }}>Aucun utilisateur correspondant.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {editingEmail && (
        <section className="panel panel-large data-card-panel">
          <div className="panel-header"><div><h3><UserCog size={18} style={{ marginRight: 8, verticalAlign: 'middle' }} />Modifier un utilisateur</h3><p>{editingEmail}</p></div></div>
          <div className="delivery-form delivery-form-premium data-card-form" style={{ gridTemplateColumns: '1fr 1fr auto auto' }}>
            <select value={editingRole} onChange={(e) => {
              const nextRole = e.target.value
              setEditingRole(nextRole)
              setEditingPermissions(getDefaultPermissions(nextRole))
            }}>
              {ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <input value={editingPassword} onChange={(e) => setEditingPassword(e.target.value)} placeholder="Nouveau mot de passe (optionnel)" type="text" />
            <button className="primary-btn" onClick={saveEdit}>Enregistrer</button>
            <button className="ghost-btn" onClick={() => { setEditingEmail(''); setEditingPassword('') }}>Annuler</button>
          </div>
          {editingRole !== 'admin' && (
            <div className="delivery-form delivery-form-premium data-card-form" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', marginTop: 14 }}>
              {PAGE_PERMISSIONS.map((item) => (
                <label key={item.permission} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid rgba(148,163,184,0.18)', borderRadius: 12 }}>
                  <input
                    type="checkbox"
                    checked={editingPermissions.includes(item.permission)}
                    onChange={(e) => setEditingPermissions((prev) => e.target.checked ? Array.from(new Set([...prev, item.permission])) : prev.filter((entry) => entry !== item.permission))}
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
