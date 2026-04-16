import { useEffect, useState } from 'react'
import { createAdminUser, deleteAdminUser, loadAdminUsers } from '../lib/fleeti'

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin', permissions: ['*'] },
  { value: 'ops', label: 'Exploitation', permissions: ['manage_delivery_orders', 'manage_fuel_vouchers'] },
  { value: 'viewer', label: 'Lecture seule', permissions: [] },
]

export function AdminUsersPage() {
  const [users, setUsers] = useState([])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('viewer')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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
    const selected = ROLE_OPTIONS.find((item) => item.value === role)
    try {
      await createAdminUser({ email, password, role, permissions: selected?.permissions || [] })
      setEmail('')
      setPassword('')
      setRole('viewer')
      await refresh()
    } catch (err) {
      setError(err.message || 'Impossible de créer cet utilisateur.')
    }
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
      </section>

      <section className="panel panel-large data-card-panel">
        <div className="panel-header"><div><h3>Ajouter un utilisateur</h3></div></div>
        <form className="delivery-form delivery-form-premium data-card-form" style={{ gridTemplateColumns: '1.2fr 1fr 0.8fr auto' }} onSubmit={submit}>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Adresse email" type="text" required />
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mot de passe" type="text" required />
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <button className="primary-btn" type="submit">Créer</button>
        </form>
        {error && <div className="error-banner">{error}</div>}
      </section>

      <section className="panel panel-large">
        <div className="panel-header"><div><h3>Utilisateurs existants</h3></div></div>
        {loading && <div className="info-banner">Chargement des utilisateurs…</div>}
        <div className="reports-table-wrap">
          <table className="reports-table">
            <thead><tr><th>Email</th><th>Rôle</th><th>Permissions</th><th>Actions</th></tr></thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.email}>
                  <td>{user.email}</td>
                  <td>{user.role}</td>
                  <td>{Array.isArray(user.permissions) ? user.permissions.join(', ') || 'Aucune' : 'Aucune'}</td>
                  <td><button className="ghost-btn small-btn danger-btn" onClick={() => remove(user.email)}>Supprimer</button></td>
                </tr>
              ))}
              {users.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: '#94a3b8' }}>Aucun utilisateur.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
