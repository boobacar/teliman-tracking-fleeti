import { Component } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '60vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 24,
          color: '#e2e8f0',
          textAlign: 'center',
        }}>
          <AlertTriangle size={48} style={{ color: '#f59e0b' }} />
          <h2 style={{ margin: 0, fontSize: 22 }}>Une erreur est survenue</h2>
          <p style={{ color: '#94a3b8', maxWidth: 400, margin: 0 }}>
            {this.state.error?.message || 'Erreur inattendue dans ce composant.'}
          </p>
          <button
            type="button"
            className="primary-btn"
            onClick={this.handleReset}
            style={{ marginTop: 8 }}
          >
            <RefreshCw size={16} />
            Réessayer
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
