import { useState } from 'react'
import { login } from '../lib/fleeti'

export function LoginPage({ onLoggedIn }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const payload = await login(email, password)
      onLoggedIn?.(payload?.user || null)
    } catch (err) {
      setError(err.message || 'Connexion impossible. Veuillez vérifier vos identifiants.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'linear-gradient(180deg, #0f172a, #111827)' }}>
      <form onSubmit={submit} style={{ width: 'min(420px, 92vw)', background: '#fff', padding: 28, borderRadius: 20, display: 'grid', gap: 14, boxShadow: '0 20px 40px rgba(0,0,0,0.25)' }}>
        <div>
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 700, letterSpacing: 1 }}>TELIMAN LOGISTIQUE</div>
          <h2 style={{ margin: '6px 0 0 0' }}>Connexion administrateur</h2>
          <p style={{ margin: '8px 0 0 0', color: '#64748b' }}>Accès réservé aux administrateurs autorisés.</p>
        </div>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Adresse email" type="text" autoComplete="username" required style={{ padding: 14, borderRadius: 12, border: '1px solid #cbd5e1' }} />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mot de passe" type="password" autoComplete="current-password" required style={{ padding: 14, borderRadius: 12, border: '1px solid #cbd5e1' }} />
        {error ? <div style={{ color: '#b91c1c', fontWeight: 600, background: '#fef2f2', border: '1px solid #fecaca', padding: '10px 12px', borderRadius: 10 }}>{error}</div> : null}
        <button className="primary-btn" type="submit" disabled={loading}>{loading ? 'Connexion...' : 'Se connecter'}</button>
      </form>
    </div>
  )
}
