export function PageStack({ children, className = '' }) {
  return <div className={`page-stack ${className}`.trim()}>{children}</div>
}

export function SectionHeader({ title, description, right = null, headingLevel = 'h3' }) {
  const Heading = headingLevel
  return (
    <div className="ui-section-header">
      <div>
        <Heading>{title}</Heading>
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
