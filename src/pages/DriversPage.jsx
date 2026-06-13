import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle,
  Clock,
  IdCard,
  Mail,
  Phone,
  Truck,
} from 'lucide-react'
import { EmptyBanner } from '../components/FeedbackBanners'
import { SectionHeader } from '../components/UIPrimitives'
import { loadEmployeesDetail } from '../lib/fleeti'

export function DriversPage({ filteredTrackers }) {
  const [employees, setEmployees] = useState([])

  useEffect(() => {
    let cancelled = false
    loadEmployeesDetail().then((data) => {
      if (!cancelled) setEmployees(Array.isArray(data) ? data : data?.employees || data?.items || [])
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

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
          description={`${employees.length} chauffeurs dans le système`}
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

                const trackerId = emp.tracker_id || emp.trackerId
                const assignedTracker = trackerId
                  ? filteredTrackers?.find((t) => String(t.id) === String(trackerId))
                  : null
                const truckLabel = assignedTracker?.label || (trackerId ? `Tracker #${trackerId}` : '-')

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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Truck size={12} /> {truckLabel}
                      </div>
                    </td>
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
          const now = new Date()
          const licenseExpired = licenseDate && licenseDate.getTime() < now.getTime()
          const trackerId = emp.tracker_id || emp.trackerId
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
