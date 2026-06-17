import { PageStack } from './UIPrimitives'

function shimmerStyle(delay = 0) {
  return {
    background: 'linear-gradient(90deg, rgba(148,163,184,0.06) 25%, rgba(148,163,184,0.12) 37%, rgba(148,163,184,0.06) 63%)',
    backgroundSize: '200% 100%',
    animation: `skeleton-shimmer 1.8s ease-in-out ${delay}ms infinite`,
    borderRadius: 12,
  }
}

export function SkeletonCard({ height = 96, delay = 0 }) {
  return <div style={{ ...shimmerStyle(delay), height, borderRadius: 16 }} />
}

export function SkeletonText({ width = '100%', height = 14, delay = 0 }) {
  return <div style={{ ...shimmerStyle(delay), width, height, borderRadius: 8 }} />
}

export function SkeletonTable({ rows = 5, cols = 6, delay = 0 }) {
  return (
    <div className="reports-table-wrap">
      <table className="reports-table">
        <thead>
          <tr>
            {Array.from({ length: cols }).map((_, i) => (
              <th key={i}><div style={{ ...shimmerStyle(delay + i * 60), height: 12, width: '70%', borderRadius: 6 }} /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c}>
                  <div style={{ ...shimmerStyle(delay + r * 80 + c * 40), height: 10, width: c === 0 ? '85%' : '60%', borderRadius: 6 }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function SkeletonPage({ cards = 4, tableRows = 5 }) {
  return (
    <PageStack className="ops-page-stack">
      {/* Hero KPI cards */}
      <section className="panel panel-large delivery-hero-panel">
        <SkeletonText width="200px" height={20} delay={0} />
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(cards, 5)}, minmax(120px, 1fr))`, gap: 12, marginTop: 16 }}>
          {Array.from({ length: cards }).map((_, i) => (
            <SkeletonCard key={i} height={88} delay={i * 120} />
          ))}
        </div>
      </section>

      {/* Table section */}
      <section className="panel panel-large delivery-table-panel">
        <SkeletonText width="240px" height={20} delay={200} />
        <div style={{ marginTop: 14 }}>
          <SkeletonTable rows={tableRows} cols={6} delay={300} />
        </div>
      </section>
    </PageStack>
  )
}

export function SkeletonForm({ fields = 6, delay = 0 }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} style={{ display: 'grid', gap: 8 }}>
          <SkeletonText width="40%" height={11} delay={delay + i * 60} />
          <div style={{ ...shimmerStyle(delay + i * 80), height: 48, borderRadius: 14 }} />
        </div>
      ))}
    </div>
  )
}
