import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle,
  Clock,
  Edit3,
  IdCard,
  Mail,
  Phone,
  Save,
  Truck,
  X,
} from 'lucide-react'
import { EmptyBanner } from '../components/FeedbackBanners'
import { SectionHeader } from '../components/UIPrimitives'
import { loadDriverAssignments, loadEmployeesDetail, saveDriverAssignments } from '../lib/fleeti'

export function DriversPage({ filteredTrackers }) {
  const [employees, setEmployees] = useState([])
  const [assignments, setAssignments] = useState({})
  const [editing, setEditing] = useState(null) // employee id being edited
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)
  const userRole = (() => {
    try { return localStorage.getItem('teliman_user_role') || '' } catch { return '' }
  })()
  const isAdmin = userRole === 'admin'

  useEffect(() => {
    let cancelled = false
    Promise.all([
      loadEmployeesDetail(),
      loadDriverAssignments().catch(() => ({ assignments: {} })),
    ]).then(([empData, assignData]) => {
      if (cancelled) return
      setEmployees(Array.isArray(empData) ? empData : empData?.employees || empData?.items || [])
      setAssignments(assignData?.assignments || {})
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  async function handleSave() {
    if (!editing) return
    setSaving(true)
    try {
      const next = { ...assignments, [String(editing)]: String(editValue) }
      await saveDriverAssignments(next)
      setAssignments(next)
      setEditing(null)
    } catch (err) {
      alert('Erreur lors de la sauvegarde : ' + (err?.message || 'inconnue'))
    } finally {
      setSaving(false)
    }
  }

  function startEdit(emp) {
    const empId = String(emp.id || emp.employee_id || emp.tracker_id || '')
    const current = assignments[empId] || String(emp.tracker_id || emp.trackerId || '')
    setEditing(empId)
    setEditValue(current)
  }

  function getAssignedTrackerId(emp) {
    const empId = String(emp.id || emp.employee_id || emp.tracker_id || '')
    // Priorité: override local > API Fleeti
    return assignments[empId] || String(emp.tracker_id || emp.trackerId || '')
  }

  if (employees.length === 0) {
    return (
      <section className="panel panel-large">
        <div className="panel-header">
          <div><h3>Chauffeurs</h3><p>Vue people + unité + activité</p></div>
        </div>
        <EmptyBanner message="Aucun chauffeur trouvé. Vérifiez l'API employés." />
      </section>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <section className="panel panel-large">
        <SectionHeader
          title="Chauffeurs"
          description={`${employees.length} chauffeurs dans le système${isAdmin ? ' — admin : cliquez ✏️ pour modifier le camion' : ''}`}
        />
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
                {isAdmin && <th style={{ width: 40 }}></th>}
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => {
                const fullName = [
                  emp.first_name || emp.firstname || emp.firstName,
                  emp.last_name || emp.lastname || emp.lastName,
                ].filter(Boolean).join(' ') || 'Non renseigné'

                const phone = emp.phone || emp.mobile || emp.tel || '-'
                const email = emp.email || '-'
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
                const assignedTracker = trackerId
                  ? filteredTrackers?.find((t) => String(t.id) === String(trackerId))
                  : null
                const truckLabel = assignedTracker?.label || (trackerId ? `Tracker #${trackerId}` : '-')
                const isOverridden = !!assignments[String(emp.id || emp.employee_id || emp.tracker_id || '')]
                const empId = String(emp.id || emp.employee_id || emp.tracker_id || '')
                const isEditingThis = editing === empId

                return (
                  <tr key={emp.id || emp.employee_id || fullName}>
                    <td><strong>{fullName}</strong></td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Phone size={12} /> {phone}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8em', color: '#94a3b8' }}>
                        <Mail size={12} /> {email}
                      </div>
                    </td>
                    <td style={{ fontFamily: 'monospace' }}>{licenseNumber}</td>
                    <td>{licenseCategories}</td>
                    <td>
                      {licenseDate ? (
                        licenseExpired ? (
                          <span style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <AlertTriangle size={14} /> Expiré {licenseDate.toLocaleDateString('fr-FR')}
                          </span>
                        ) : licenseUrgent ? (
                          <span style={{ color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <AlertTriangle size={14} /> {licenseDate.toLocaleDateString('fr-FR')}
                          </span>
                        ) : (
                          <span style={{ color: '#22c55e', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <CheckCircle size={14} /> {licenseDate.toLocaleDateString('fr-FR')}
                          </span>
                        )
                      ) : (
                        <span style={{ color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Clock size={14} /> Non renseigné
                        </span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <BadgeCheck size={12} /> {badge}
                      </div>
                      <small style={{ color: '#94a3b8' }}>Mat. {matricule}</small>
                    </td>
                    <td>
                      {isEditingThis ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <select
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            style={{
                              background: '#0f172a',
                              color: '#e2e8f0',
                              border: '1px solid #334155',
                              borderRadius: 6,
                              padding: '4px 8px',
                              fontSize: '0.85em',
                              maxWidth: 150,
                            }}
                          >
                            <option value="">-- Aucun --</option>
                            {(filteredTrackers || []).map((t) => (
                              <option key={t.id} value={String(t.id)}>{t.label || `Tracker #${t.id}`}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={handleSave}
                            disabled={saving}
                            style={{ background: 'none', border: 'none', color: '#22c55e', cursor: 'pointer', padding: 2 }}
                            title="Enregistrer"
                          ><Save size={14} /></button>
                          <button
                            type="button"
                            onClick={() => setEditing(null)}
                            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 2 }}
                            title="Annuler"
                          ><X size={14} /></button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Truck size={12} /> {truckLabel}
                          {isOverridden && (
                            <span style={{ fontSize: '0.7em', color: '#f59e0b', marginLeft: 4 }} title="Override local">⚡</span>
                          )}
                        </div>
                      )}
                    </td>
                    {isAdmin && (
                      <td>
                        {!isEditingThis && (
                          <button
                            type="button"
                            onClick={() => startEdit(emp)}
                            style={{ background: 'none', border: 'none', color: '#38bdf8', cursor: 'pointer', padding: 4 }}
                            title="Modifier le camion"
                          ><Edit3 size={14} /></button>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Version mobile cards */}
      <div className="mobile-cards-grid" style={{ display: 'none' }}>
        {employees.map((emp) => {
          const fullName = [
            emp.first_name || emp.firstname || emp.firstName,
            emp.last_name || emp.lastname || emp.lastName,
          ].filter(Boolean).join(' ') || 'Non renseigné'
          const phone = emp.phone || emp.mobile || emp.tel || '-'
          const licenseNumber = emp.license_number || emp.license_no || emp.driving_license || '-'
          const licenseValidTill = emp.license_valid_till || emp.license_expiry || emp.driving_license_expiry || null
          const licenseDate = licenseValidTill ? new Date(licenseValidTill) : null
          const licenseExpired = licenseDate && licenseDate.getTime() < new Date().getTime()
          const trackerId = getAssignedTrackerId(emp)
          const assignedTracker = trackerId
            ? filteredTrackers?.find((t) => String(t.id) === String(trackerId))
            : null
          const truckLabel = assignedTracker?.label || (trackerId ? `Tracker #${trackerId}` : '-')

          return (
            <div key={`mob-${emp.id || fullName}`} className="stat-card">
              <strong>{fullName}</strong>
              <small><Phone size={12} /> {phone}</small>
              <small><IdCard size={12} /> {licenseNumber}</small>
              <span>
                Permis:{' '}
                {licenseDate
                  ? licenseExpired
                    ? `Expiré ${licenseDate.toLocaleDateString('fr-FR')}`
                    : `Valide ${licenseDate.toLocaleDateString('fr-FR')}`
                  : 'Non renseigné'}
              </span>
              <span><Truck size={12} /> {truckLabel}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
