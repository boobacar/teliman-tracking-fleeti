import { useEffect, useMemo, useState } from 'react'
import { Search, Shield, UserCog, UserPlus, Users } from 'lucide-react'
import { APP_VIEWS } from '../components/Layout'
import { ErrorBanner, LoadingBanner } from '../components/FeedbackBanners'
import { PageStack, SectionHeader, StatCard, StatGrid } from '../components/UIPrimitives'
import { createAdminUser, deleteAdminUser, loadAdminUsers, updateAdminUser } from '../lib/fleeti'
import { useAccessibleConfirm } from '../components/ConfirmDialog.jsx'

const PERMISSION_LABELS = {
  manage_delivery_orders: 'Gérer les bons de livraison',
  manage_fuel_vouchers: 'Gérer les bons carburant',
  manage_data: 'Gérer les données de référence',
  manage_users: 'Gérer les utilisateurs',
  manage_drivers: 'Gérer les chauffeurs',
  manage_whatsapp: 'Gérer WhatsApp',
}
const PAGE_PERMISSIONS = Array.from(new Map([
  ...APP_VIEWS.map((view) => ({ permission: view.permission, label: `Accéder à ${view.label}` })),
  ...Object.entries(PERMISSION_LABELS).map(([permission, label]) => ({ permission, label })),
].filter((item) => item.permission).map((item) => [item.permission, item])).values())

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Administrateur', permissions: ['*'] },
  { value: 'ops', label: 'Exploitation', permissions: ['manage_delivery_orders', 'manage_fuel_vouchers', 'page_dashboard', 'page_map', 'page_fleet', 'page_alerts', 'page_analytics', 'page_reports'] },
  { value: 'viewer', label: 'Lecture seule', permissions: ['page_dashboard', 'page_map', 'page_fleet', 'page_alerts', 'page_analytics', 'page_reports'] },
]

function getDefaultPermissions(role) {
  const roleConfig = ROLE_OPTIONS.find((item) => item.value === role)
  return (roleConfig?.permissions || []).filter((entry) => entry !== '*')
}

function PermissionToggle({ label, checked, onChange }) {
  return (
    <label className="ui-permission-item">
      <span>{label}</span>
      <span className="ui-toggle-wrap">
        <input
          className="ui-toggle-input"
          type="checkbox"
          checked={checked}
          onChange={onChange}
          role="switch"
          aria-checked={checked}
        />
        <span className={`ui-toggle-track ${checked ? 'is-checked' : ''}`}>
          <span className={`ui-toggle-knob ${checked ? 'is-checked' : ''}`} />
        </span>
      </span>
    </label>
  )
}

export function AdminUsersPage() {
  const { confirm, confirmationDialog } = useAccessibleConfirm()
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

  useEffect(() => {
    let cancelled = false

    async function initialLoad() {
      setLoading(true)
      setError('')
      try {
        const payload = await loadAdminUsers()
        if (!cancelled) setUsers(payload.items || [])
      } catch (err) {
        if (!cancelled) setError(err.message || 'Impossible de charger les utilisateurs.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    initialLoad()
    return () => {
      cancelled = true
    }
  }, [])

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
    if (!await confirm({ title: 'Supprimer cet utilisateur ?', message: `Le compte ${emailToDelete} perdra immédiatement son accès.`, confirmLabel: 'Supprimer' })) return
    try {
      await deleteAdminUser(emailToDelete)
      await refresh()
    } catch (err) {
      setError(err.message || 'Impossible de supprimer cet utilisateur.')
    }
  }

  return (
    <PageStack>
      <section className="panel panel-large reports-v2-hero">
        <div className="ui-section-header"><div><h1>Administration des utilisateurs</h1><p>Créer des comptes, définir un rôle et attribuer les accès utiles.</p></div></div>
        <StatGrid className="reports-v2-kpis">
          <StatCard label="Total" value={roleStats.total} helper="comptes configurés" />
          <StatCard label="Admins" value={roleStats.admins} helper="accès complet" />
          <StatCard label="Exploitation" value={roleStats.ops} helper="opérations terrain" />
          <StatCard label="Lecture" value={roleStats.viewers} helper="consultation simple" />
        </StatGrid>
      </section>

      <section className="panel panel-large data-card-panel" style={{ minHeight: 'unset', alignContent: 'start' }}>
        <SectionHeader title={<span className="ui-inline-icon"><UserPlus size={18} />Ajouter un utilisateur</span>} />
        <form className="delivery-form delivery-form-premium data-card-form ui-admin-form-grid" onSubmit={submit}>
          <label className="field-stack">
            <span>Adresse email</span>
            <input aria-label="Adresse email utilisateur" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Adresse email" type="text" required />
          </label>
          <label className="field-stack">
            <span>Mot de passe</span>
            <input aria-label="Mot de passe utilisateur" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mot de passe" type="password" autoComplete="new-password" required />
          </label>
          <label className="field-stack">
            <span>Rôle</span>
            <select aria-label="Rôle utilisateur" value={role} onChange={(e) => {
              const nextRole = e.target.value
              setRole(nextRole)
              setSelectedPermissions(getDefaultPermissions(nextRole))
            }}>
              {ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          {role !== 'admin' && (
          <fieldset className="delivery-form delivery-form-premium data-card-form ui-permissions-grid">
            <legend>Accès et actions autorisés</legend>
            {PAGE_PERMISSIONS.map((item) => {
              const checked = selectedPermissions.includes(item.permission)
              return (
                <PermissionToggle
                  key={item.permission}
                  label={item.label}
                  checked={checked}
                  onChange={(e) => setSelectedPermissions((prev) => e.target.checked ? Array.from(new Set([...prev, item.permission])) : prev.filter((entry) => entry !== item.permission))}
                />
              )
            })}
          </fieldset>
          )}
          <button className="primary-btn" type="submit">Créer l’utilisateur</button>
        </form>

        <ErrorBanner message={error} />
      </section>

      <section className="panel panel-large">
        <SectionHeader title={<span className="ui-inline-icon"><Users size={18} />Utilisateurs existants</span>} />
        {loading && <LoadingBanner message="Chargement des utilisateurs…" />}

        <div className="delivery-form delivery-form-premium data-card-form ui-admin-search-grid">
          <label className="field-stack">
            <span>Recherche</span>
            <div className="ui-search-icon-wrap">
              <Search size={16} className="ui-search-icon" />
              <input className="ui-search-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher par email, rôle ou permission" />
            </div>
          </label>
        </div>

        <div className="reports-table-wrap">
          <table className="reports-table">
            <caption className="sr-only">Utilisateurs et permissions configurés</caption>
            <thead><tr><th scope="col">Email</th><th scope="col">Rôle</th><th scope="col">Permissions</th><th scope="col">Actions</th></tr></thead>
            <tbody>
              {filteredUsers.map((user) => {
                const badge = roleBadge(user.role)
                return (
                  <tr key={user.email}>
                    <td>{user.email}</td>
                    <td><span className="ui-role-badge" style={{ background: badge.bg, color: badge.color }}><Shield size={13} />{badge.label}</span></td>
                    <td>{Array.isArray(user.permissions) ? user.permissions.join(', ') || 'Aucune' : 'Aucune'}</td>
                    <td>
                      <div className="ui-actions-inline">
                        <button type="button" className="ghost-btn small-btn" onClick={() => startEdit(user)}><UserCog size={14} />Modifier</button>
                        <button type="button" className="ghost-btn small-btn danger-btn" onClick={() => remove(user.email)}>Supprimer</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {filteredUsers.length === 0 && <tr><td colSpan={4} className="ui-muted-cell">Aucun utilisateur correspondant.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {editingEmail && (
        <section className="panel panel-large data-card-panel">
          <SectionHeader title={<span className="ui-inline-icon"><UserCog size={18} />Modifier un utilisateur</span>} description={editingEmail} />

          <div className="delivery-form delivery-form-premium data-card-form ui-edit-grid">
            <label className="field-stack">
              <span>Rôle</span>
              <select aria-label="Modifier rôle" value={editingRole} onChange={(e) => {
                const nextRole = e.target.value
                setEditingRole(nextRole)
                setEditingPermissions(getDefaultPermissions(nextRole))
              }}>
                {ROLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="field-stack">
              <span>Nouveau mot de passe</span>
              <input aria-label="Nouveau mot de passe" value={editingPassword} onChange={(e) => setEditingPassword(e.target.value)} placeholder="Nouveau mot de passe (optionnel)" type="password" autoComplete="new-password" />
            </label>
            <button type="button" className="primary-btn" onClick={saveEdit}>Enregistrer</button>
            <button type="button" className="ghost-btn" onClick={() => { setEditingEmail(''); setEditingPassword('') }}>Annuler</button>
          </div>

          {editingRole !== 'admin' && (
            <div className="delivery-form delivery-form-premium data-card-form ui-permissions-grid">
              {PAGE_PERMISSIONS.map((item) => {
                const checked = editingPermissions.includes(item.permission)
                return (
                  <PermissionToggle
                    key={item.permission}
                    label={item.label}
                    checked={checked}
                    onChange={(e) => setEditingPermissions((prev) => e.target.checked ? Array.from(new Set([...prev, item.permission])) : prev.filter((entry) => entry !== item.permission))}
                  />
                )
              })}
            </div>
          )}
        </section>
      )}
      {confirmationDialog}
    </PageStack>
  )
}
