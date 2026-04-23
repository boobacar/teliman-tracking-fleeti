export function PageStack({ children, className = '' }) {
  return <div className={`page-stack ${className}`.trim()}>{children}</div>
}

export function SectionHeader({ title, description, right = null }) {
  return (
    <div className="ui-section-header">
      <div>
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
      </div>
      {right}
    </div>
  )
}

export function StatGrid({ children, className = '' }) {
  return <section className={`ui-stat-grid ${className}`.trim()}>{children}</section>
}

export function StatCard({ label, value, helper }) {
  return (
    <div className="ui-stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {helper ? <small>{helper}</small> : null}
    </div>
  )
}
