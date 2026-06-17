import { useEffect, useState } from 'react'
import {
  AlertTriangle, BadgeCheck, CheckCircle, Clock, Edit3, IdCard,
  Mail, Phone, Plus, Save, Trash2, Truck, UserPlus, X,
} from 'lucide-react'
import { EmptyBanner } from '../components/FeedbackBanners'
import { SectionHeader } from '../components/UIPrimitives'
import { loadDriverOverrides, loadEmployeesDetail, patchDriverOverride, deleteDriverOverride } from '../lib/fleeti'

function driverId(emp) {
  return String(emp.id || emp.employee_id || emp.tracker_id || emp._customId || '')
}

export function DriversPage({ filteredTrackers }) {
  const [employees, setEmployees] = useState([])
  const [overrides, setOverrides] = useState({})
  const [editing, setEditing] = useState(null) // driver id
  const [editData, setEditData] = useState({})
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newDriver, setNewDriver] = useState({ firstName: '', lastName: '', trackerId: '', phone: '', email: '' })

  const userRole = (() => { try { return localStorage.getItem('teliman_user_role') || '' } catch { return '' } })()
  const isAdmin = userRole === 'admin'

  useEffect(() => {
    let cancelled = false
    Promise.all([
      loadEmployeesDetail().catch(() => ({ employees: [] })),
      loadDriverOverrides().catch(() => ({ overrides: {} })),
    ]).then(([empData, overrideData]) => {
      if (cancelled) return
      const emps = Array.isArray(empData) ? empData : empData?.employees || empData?.items || []
      const ovr = overrideData?.overrides || {}
      setEmployees(emps)
      setOverrides(ovr)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Injecter les chauffeurs customs (qui sont dans overrides mais pas dans employees)
  const allEmployees = (() => {
    const existingIds = new Set(employees.map((e) => driverId(e)))
    const customs = []
    for (const [id, data] of Object.entries(overrides)) {
      if (data.isCustom && !existingIds.has(id)) {
        customs.push({
          _customId: id,
          first_name: data.firstName || '',
          last_name: data.lastName || '',
          phone: data.phone || '',
          email: data.email || '',
          tracker_id: data.trackerId || null,
          _custom: true,
        })
      }
    }
    return [...employees, ...customs]
  })()

  function getEffectiveField(emp, field) {
    const id = driverId(emp)
    const override = overrides[id] || {}
    if (override[field] !== undefined && override[field] !== '') return override[field]
    // Map camelCase to snake_case
    const snakeMap = { firstName: 'first_name', lastName: 'last_name', phone: 'phone', email: 'email' }
    const snake = snakeMap[field] || field
    return emp[snake] || emp[field] || ''
  }

  function getAssignedTrackerId(emp) {
    const id = driverId(emp)
    const override = overrides[id] || {}
    return override.trackerId || String(emp.tracker_id || emp.trackerId || '')
  }

  function startEdit(emp) {
    const id = driverId(emp)
    setEditing(id)
    setEditData({
      firstName: getEffectiveField(emp, 'firstName'),
      lastName: getEffectiveField(emp, 'lastName'),
      trackerId: getAssignedTrackerId(emp),
      phone: getEffectiveField(emp, 'phone'),
      email: getEffectiveField(emp, 'email'),
    })
  }

  async function handleSave() {
    if (!editing) return
    setSaving(true)
    try {
      const result = await patchDriverOverride(editing, {
        trackerId: editData.trackerId || undefined,
        firstName: editData.firstName || undefined,
        lastName: editData.lastName || undefined,
        phone: editData.phone || undefined,
        email: editData.email || undefined,
      })
      // Mettre à jour localement
      const next = { ...overrides }
      if (result.override && Object.keys(result.override).length) {
        next[editing] = result.override
      } else {
        delete next[editing]
      }
      setOverrides(next)
      setEditing(null)
    } catch (err) {
      alert('Erreur lors de la sauvegarde : ' + (err?.message || 'inconnue'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(emp) {
    const id = driverId(emp)
    if (!confirm(`Supprimer l'override pour ${getEffectiveField(emp, 'firstName')} ${getEffectiveField(emp, 'lastName')} ?`)) return
    try {
      await deleteDriverOverride(id)
      const next = { ...overrides }
      delete next[id]
      setOverrides(next)
      if (editing === id) setEditing(null)
    } catch (err) {
      alert('Erreur : ' + (err?.message || 'inconnue'))
    }
  }

  async function handleAdd() {
    const first = (newDriver.firstName || '').trim()
    const last = (newDriver.lastName || '').trim()
    if (!first && !last) return alert('Le nom est requis.')
    setSaving(true)
    try {
      const customId = 'custom-' + Date.now()
      await patchDriverOverride(customId, {
        firstName: first,
        lastName: last,
        trackerId: newDriver.trackerId || undefined,
        phone: newDriver.phone || undefined,
        email: newDriver.email || undefined,
        isCustom: true,
      })
      const next = {
        ...overrides,
        [customId]: {
          firstName: first,
          lastName: last,
          trackerId: newDriver.trackerId || undefined,
          phone: newDriver.phone || undefined,
          email: newDriver.email || undefined,
          isCustom: true,
        },
      }
      setOverrides(next)
      setAdding(false)
      setNewDriver({ firstName: '', lastName: '', trackerId: '', phone: '', email: '' })
    } catch (err) {
      alert('Erreur : ' + (err?.message || 'inconnue'))
    } finally {
      setSaving(false)
    }
  }

  if (allEmployees.length === 0) {
    return (
      <section className="panel panel-large">
        <div className="panel-header">
          <div><h3>Chauffeurs</h3><p>Vue people + unité + activité</p></div>
        </div>
        <EmptyBanner message="Aucun chauffeur trouvé. Vérifiez l'API employés." />
      </section>
    )
  }

  function editCell(emp) {
    const rowId = driverId(emp)
    if (editing !== rowId) return null

    return (
      <>
        <td>
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              value={editData.firstName || ''}
              onChange={(e) => setEditData({ ...editData, firstName: e.target.value })}
              placeholder="Prénom"
              style={inputStyle}
            />
            <input
              value={editData.lastName || ''}
              onChange={(e) => setEditData({ ...editData, lastName: e.target.value })}
              placeholder="Nom"
              style={inputStyle}
            />
          </div>
        </td>
        <td>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Phone size={12} />
              <input value={editData.phone || ''} onChange={(e) => setEditData({ ...editData, phone: e.target.value })} placeholder="Téléphone" style={{ ...inputStyle, width: 130 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Mail size={12} />
              <input value={editData.email || ''} onChange={(e) => setEditData({ ...editData, email: e.target.value })} placeholder="Email" style={{ ...inputStyle, width: 160 }} />
            </div>
          </div>
        </td>
        <td style={{ fontFamily: 'monospace', color: '#94a3b8' }}>—</td>
        <td style={{ color: '#94a3b8' }}>—</td>
        <td style={{ color: '#94a3b8' }}>—</td>
        <td style={{ color: '#94a3b8' }}>—</td>
        <td>
          <select
            value={editData.trackerId || ''}
            onChange={(e) => setEditData({ ...editData, trackerId: e.target.value })}
            style={selectStyle}
          >
            <option value="">-- Aucun --</option>
            {(filteredTrackers || []).map((t) => (
              <option key={t.id} value={String(t.id)}>{t.label || `Tracker #${t.id}`}</option>
            ))}
          </select>
        </td>
        {isAdmin && (
          <td style={{ whiteSpace: 'nowrap' }}>
            <button type="button" onClick={handleSave} disabled={saving} style={{ ...iconBtn, color: '#22c55e' }} title="Enregistrer"><Save size={14} /></button>
            <button type="button" onClick={() => setEditing(null)} style={{ ...iconBtn, color: '#94a3b8' }} title="Annuler"><X size={14} /></button>
          </td>
        )}
      </>
    )
  }

  function viewCell(emp) {
    const fullName = [getEffectiveField(emp, 'firstName'), getEffectiveField(emp, 'lastName')].filter(Boolean).join(' ') || 'Non renseigné'
    const phone = getEffectiveField(emp, 'phone') || '-'
    const email = getEffectiveField(emp, 'email') || '-'
    const licenseNumber = emp.license_number || emp.license_no || emp.driving_license || '-'
    const licenseCategories = emp.license_categories || emp.license_category || '-'
    const licenseValidTill = emp.license_valid_till || emp.license_expiry || emp.driving_license_expiry || null
    const badge = emp.badge || emp.hardware_badge || '-'
    const matricule = emp.matricule || emp.employee_id || emp.payroll_id || '-'
    const licenseDate = licenseValidTill ? new Date(licenseValidTill) : null
    const now = new Date()
    const thirtyDays = 30 * 24 * 60 * 60 * 1000
    const licenseExpired = licenseDate && licenseDate.getTime() < now.getTime()
    const licenseUrgent = licenseDate && !licenseExpired && licenseDate.getTime() - now.getTime() < thirtyDays
    const trackerId = getAssignedTrackerId(emp)
    const assignedTracker = trackerId ? filteredTrackers?.find((t) => String(t.id) === String(trackerId)) : null
    const truckLabel = assignedTracker?.label || (trackerId ? `Tracker #${trackerId}` : '-')
    const rowId = driverId(emp)
    const hasOverride = !!overrides[rowId]
    const isCustom = emp._custom

    return (
      <>
        <td>
          <strong>{fullName}</strong>
          {isCustom && <span style={{ fontSize: '0.7em', color: '#38bdf8', marginLeft: 6 }}>➕</span>}
          {hasOverride && !isCustom && <span style={{ fontSize: '0.7em', color: '#f59e0b', marginLeft: 4 }} title="Override local">⚡</span>}
        </td>
        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Phone size={12} /> {phone}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8em', color: '#94a3b8' }}><Mail size={12} /> {email}</div>
        </td>
        <td style={{ fontFamily: 'monospace' }}>{licenseNumber}</td>
        <td>{licenseCategories}</td>
        <td>
          {licenseDate ? (
            licenseExpired ? (
              <span style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: 4 }}><AlertTriangle size={14} /> Expiré {licenseDate.toLocaleDateString('fr-FR')}</span>
            ) : licenseUrgent ? (
              <span style={{ color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 4 }}><AlertTriangle size={14} /> {licenseDate.toLocaleDateString('fr-FR')}</span>
            ) : (
              <span style={{ color: '#22c55e', display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle size={14} /> {licenseDate.toLocaleDateString('fr-FR')}</span>
            )
          ) : (
            <span style={{ color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={14} /> Non renseigné</span>
          )}
        </td>
        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><BadgeCheck size={12} /> {badge}</div>
          <small style={{ color: '#94a3b8' }}>Mat. {matricule}</small>
        </td>
        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Truck size={12} /> {truckLabel}</div>
        </td>
        {isAdmin && (
          <td>
            <button type="button" onClick={() => startEdit(emp)} style={{ ...iconBtn, color: '#38bdf8' }} title="Modifier"><Edit3 size={14} /></button>
            {hasOverride && (
              <button type="button" onClick={() => handleDelete(emp)} style={{ ...iconBtn, color: '#ef4444' }} title="Supprimer l'override"><Trash2 size={14} /></button>
            )}
          </td>
        )}
      </>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <section className="panel panel-large">
        <SectionHeader
          title="Chauffeurs"
          description={`${allEmployees.length} chauffeurs${isAdmin ? ' — admin : ✏️ modifier, 🗑️ supprimer override, + ajouter' : ''}`}
        />

        {/* Bouton ajout chauffeur */}
        {isAdmin && !adding && (
          <div style={{ marginBottom: 12 }}>
            <button type="button" className="chip" onClick={() => setAdding(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <UserPlus size={14} /> Ajouter un chauffeur
            </button>
          </div>
        )}

        {/* Formulaire ajout */}
        {adding && (
          <div className="panel" style={{ marginBottom: 16, padding: 16, borderRadius: 10, background: 'rgba(15,23,42,0.7)', border: '1px solid #1e293b' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <UserPlus size={16} style={{ color: '#38bdf8' }} />
              <strong style={{ color: '#e2e8f0' }}>Nouveau chauffeur</strong>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <label style={labelStyle}>Prénom</label>
                <input value={newDriver.firstName} onChange={(e) => setNewDriver({ ...newDriver, firstName: e.target.value })} style={inputStyle} placeholder="Prénom" />
              </div>
              <div>
                <label style={labelStyle}>Nom</label>
                <input value={newDriver.lastName} onChange={(e) => setNewDriver({ ...newDriver, lastName: e.target.value })} style={inputStyle} placeholder="Nom" />
              </div>
              <div>
                <label style={labelStyle}>Camion</label>
                <select value={newDriver.trackerId} onChange={(e) => setNewDriver({ ...newDriver, trackerId: e.target.value })} style={selectStyle}>
                  <option value="">-- Aucun --</option>
                  {(filteredTrackers || []).map((t) => <option key={t.id} value={String(t.id)}>{t.label || `Tracker #${t.id}`}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Téléphone</label>
                <input value={newDriver.phone} onChange={(e) => setNewDriver({ ...newDriver, phone: e.target.value })} style={{ ...inputStyle, width: 130 }} placeholder="+221..." />
              </div>
              <div>
                <label style={labelStyle}>Email</label>
                <input value={newDriver.email} onChange={(e) => setNewDriver({ ...newDriver, email: e.target.value })} style={{ ...inputStyle, width: 180 }} placeholder="email" />
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
                <button type="button" onClick={handleAdd} disabled={saving} className="chip selected" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Plus size={14} /> Ajouter
                </button>
                <button type="button" onClick={() => { setAdding(false); setNewDriver({ firstName: '', lastName: '', trackerId: '', phone: '', email: '' }) }} className="chip">Annuler</button>
              </div>
            </div>
          </div>
        )}

        <div className="reports-table-wrap">
          <table className="reports-table">
            <thead>
              <tr>
                <th>Nom complet</th>
                <th>Contact</th>
                <th>Permis N°</th>
                <th>Catégories</th>
                <th>Validité permis</th>
                <th>Badge / Matricule</th>
                <th>Camion assigné</th>
                {isAdmin && <th style={{ width: 60 }}></th>}
              </tr>
            </thead>
            <tbody>
              {allEmployees.map((emp) => {
                const rowId = driverId(emp)
                const isEditing = editing === rowId
                return (
                  <tr key={rowId || emp.first_name + emp.last_name}>
                    {isEditing ? editCell(emp) : viewCell(emp)}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Mobile cards */}
      <div className="mobile-cards-grid" style={{ display: 'none' }}>
        {allEmployees.map((emp) => {
          const fullName = [getEffectiveField(emp, 'firstName'), getEffectiveField(emp, 'lastName')].filter(Boolean).join(' ') || 'Non renseigné'
          const phone = getEffectiveField(emp, 'phone') || '-'
          const licenseNumber = emp.license_number || emp.license_no || emp.driving_license || '-'
          const licenseValidTill = emp.license_valid_till || emp.license_expiry || emp.driving_license_expiry || null
          const licenseDate = licenseValidTill ? new Date(licenseValidTill) : null
          const licenseExpired = licenseDate && licenseDate.getTime() < new Date().getTime()
          const trackerId = getAssignedTrackerId(emp)
          const assignedTracker = trackerId ? filteredTrackers?.find((t) => String(t.id) === String(trackerId)) : null
          const truckLabel = assignedTracker?.label || (trackerId ? `Tracker #${trackerId}` : '-')
          const rowId = driverId(emp)
          return (
            <div key={`mob-${rowId}`} className="stat-card">
              <strong>{fullName}</strong>
              <small><Phone size={12} /> {phone}</small>
              <small><IdCard size={12} /> {licenseNumber}</small>
              <span>Permis: {licenseDate ? (licenseExpired ? `Expiré ${licenseDate.toLocaleDateString('fr-FR')}` : `Valide ${licenseDate.toLocaleDateString('fr-FR')}`) : 'Non renseigné'}</span>
              <span><Truck size={12} /> {truckLabel}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const inputStyle = {
  background: '#0f172a',
  color: '#e2e8f0',
  border: '1px solid #334155',
  borderRadius: 6,
  padding: '4px 8px',
  fontSize: '0.85em',
  width: 100,
}

const selectStyle = {
  background: '#0f172a',
  color: '#e2e8f0',
  border: '1px solid #334155',
  borderRadius: 6,
  padding: '4px 8px',
  fontSize: '0.85em',
  maxWidth: 150,
}

const iconBtn = { background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'inline-flex' }

const labelStyle = { display: 'block', fontSize: '0.75em', color: '#94a3b8', marginBottom: 2 }
