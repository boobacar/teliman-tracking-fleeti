export function LoadingBanner({ message = 'Chargement…' }) {
  return <div className="info-banner" role="status" aria-live="polite">{message}</div>
}

export function ErrorBanner({ message }) {
  if (!message) return null
  return <div className="error-banner" role="alert" aria-live="assertive">{message}</div>
}

export function EmptyBanner({ message }) {
  return <div className="empty-banner" role="status" aria-live="polite">{message}</div>
}
