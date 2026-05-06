import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Copy, MessageCircle, QrCode, RefreshCcw, Send, ShieldCheck, Smartphone, Webhook } from 'lucide-react'
import { loadWhatsAppQr, loadWhatsAppStatus } from '../lib/fleeti.js'

const WHATSAPP_API_PHONE_DISPLAY = '+225 07 00 184 839'
const WHATSAPP_API_PHONE_E164 = '2250700184839'
const DEFAULT_MESSAGE = 'Bonjour, ici Teliman Logistique. Nous vous contactons concernant votre opération de transport.'

export function WhatsAppPage() {
  const [recipientPhone, setRecipientPhone] = useState('')
  const [message, setMessage] = useState(DEFAULT_MESSAGE)
  const [copied, setCopied] = useState('')
  const [whatsAppStatus, setWhatsAppStatus] = useState(null)
  const [whatsAppQr, setWhatsAppQr] = useState(null)
  const [statusError, setStatusError] = useState('')

  const normalizedRecipient = useMemo(() => normalizePhoneForWhatsApp(recipientPhone), [recipientPhone])
  const previewLink = useMemo(() => {
    const target = normalizedRecipient || WHATSAPP_API_PHONE_E164
    return `https://wa.me/${target}?text=${encodeURIComponent(message || DEFAULT_MESSAGE)}`
  }, [message, normalizedRecipient])
  const connectionLabel = whatsAppStatus?.connected ? 'Connecté' : whatsAppQr?.hasQr ? 'QR à scanner' : whatsAppStatus?.state || 'Chargement…'

  const refreshWhatsAppConnection = useCallback(async () => {
    try {
      const [status, qr] = await Promise.all([loadWhatsAppStatus(), loadWhatsAppQr()])
      setWhatsAppStatus(status)
      setWhatsAppQr(qr)
      setStatusError('')
    } catch (error) {
      setStatusError(error?.message || 'Impossible de charger le statut WhatsApp.')
    }
  }, [])

  useEffect(() => {
    const initialTimer = window.setTimeout(refreshWhatsAppConnection, 0)
    const timer = window.setInterval(refreshWhatsAppConnection, 10000)
    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(timer)
    }
  }, [refreshWhatsAppConnection])

  async function copyValue(value, label) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(label)
      window.setTimeout(() => setCopied(''), 1600)
    } catch {
      setCopied('copie manuelle requise')
    }
  }

  return (
    <div className="whatsapp-page page-stack">
      <section className="panel panel-large mission-hero-card whatsapp-hero-card">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Canal client</p>
            <h3>WhatsApp Baileys</h3>
            <p>Connexion simple via QR code WhatsApp Web pour envoyer les notifications BL automatiques aux clients.</p>
          </div>
          <div className="whatsapp-hero-icon"><MessageCircle size={28} /></div>
        </div>
        <div className="mission-highlight-grid compact-mission-grid">
          <div className="mission-highlight-card whatsapp-number-card">
            <span>Numéro API WhatsApp</span>
            <strong>{WHATSAPP_API_PHONE_DISPLAY}</strong>
            <small>Format API : {WHATSAPP_API_PHONE_E164}</small>
          </div>
          <div className="mission-highlight-card">
            <span>Statut connexion</span>
            <strong>{connectionLabel}</strong>
            <small>{statusError || (whatsAppStatus?.lastError ? whatsAppStatus.lastError : 'Session stockée côté serveur hors Git.')}</small>
          </div>
          <div className="mission-highlight-card">
            <span>Lien rapide</span>
            <strong>wa.me/{WHATSAPP_API_PHONE_E164}</strong>
            <small>Ouverture WhatsApp Web/mobile.</small>
          </div>
        </div>
        <div className="table-actions" style={{ marginTop: 18 }}>
          <a className="primary-btn" href={`https://wa.me/${WHATSAPP_API_PHONE_E164}`} target="_blank" rel="noreferrer"><Send size={16} /> Ouvrir WhatsApp</a>
          <button type="button" className="ghost-btn small-btn" onClick={() => copyValue(WHATSAPP_API_PHONE_DISPLAY, 'numéro copié')}><Copy size={16} /> Copier le numéro</button>
          <button type="button" className="ghost-btn small-btn" onClick={refreshWhatsAppConnection}><RefreshCcw size={16} /> Actualiser statut</button>
          {copied && <span className="success-chip"><CheckCircle2 size={14} /> {copied}</span>}
        </div>
      </section>

      <section className="panel panel-large">
        <div className="panel-header">
          <div>
            <h3>Connexion WhatsApp</h3>
            <p>Scanne ce QR code avec le téléphone WhatsApp Teliman : WhatsApp → Appareils connectés → Connecter un appareil.</p>
          </div>
          <QrCode size={22} />
        </div>
        {whatsAppQr?.qrDataUrl ? (
          <div className="whatsapp-qr-box">
            <img src={whatsAppQr.qrDataUrl} alt="QR code de connexion WhatsApp" />
            <small>Le QR code se renouvelle automatiquement. Actualise si besoin.</small>
          </div>
        ) : (
          <div className="empty-state small-empty">
            {whatsAppStatus?.connected ? 'WhatsApp est déjà connecté.' : 'QR code en attente de génération côté serveur.'}
          </div>
        )}
      </section>

      <section className="panel panel-large">
        <div className="panel-header">
          <div>
            <h3>Composer un message</h3>
            <p>Prépare un message puis ouvre WhatsApp avec le texte prérempli.</p>
          </div>
        </div>
        <div className="delivery-form whatsapp-compose-grid">
          <label>
            <span>Numéro destinataire</span>
            <input value={recipientPhone} onChange={(event) => setRecipientPhone(event.target.value)} placeholder="Ex : +225 07 01 02 03 04" />
          </label>
          <label>
            <span>Message</span>
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={5} placeholder="Saisis le message WhatsApp…" />
          </label>
        </div>
        <div className="table-actions" style={{ marginTop: 16 }}>
          <a className="primary-btn" href={previewLink} target="_blank" rel="noreferrer"><MessageCircle size={16} /> Envoyer via WhatsApp</a>
          <button type="button" className="ghost-btn small-btn" onClick={() => copyValue(previewLink, 'lien copié')}><Copy size={16} /> Copier le lien</button>
        </div>
      </section>

      <section className="stats-grid stats-grid-tight whatsapp-info-grid">
        <article className="stat-card"><div className="stat-icon"><Smartphone size={18} /></div><div><p>Numéro émetteur</p><strong>{WHATSAPP_API_PHONE_DISPLAY}</strong></div></article>
        <article className="stat-card"><div className="stat-icon"><Webhook size={18} /></div><div><p>Déclencheurs BL</p><strong>Création, statut, départ, arrivée</strong></div></article>
        <article className="stat-card"><div className="stat-icon"><ShieldCheck size={18} /></div><div><p>Provider</p><strong>Baileys / WhatsApp Web</strong></div></article>
      </section>

      <section className="panel panel-large">
        <div className="panel-header">
          <div>
            <h3>Notifications automatiques BL</h3>
            <p>Les clients avec un téléphone renseigné dans Données → Téléphones clients recevront automatiquement un message détaillé.</p>
          </div>
        </div>
        <div className="data-list-grid">
          <article className="data-item-card"><div className="data-item-main"><span className="data-item-title">Création de BL</span><small>Référence, client, camion, chauffeur, chargement, destination, marchandise, quantité et notes.</small></div></article>
          <article className="data-item-card"><div className="data-item-main"><span className="data-item-title">Changement de statut</span><small>Message envoyé quand le statut passe par exemple de Prévu à En cours ou Livré.</small></div></article>
          <article className="data-item-card"><div className="data-item-main"><span className="data-item-title">Départ</span><small>Message envoyé quand la date/heure de départ est renseignée pour la première fois.</small></div></article>
          <article className="data-item-card"><div className="data-item-main"><span className="data-item-title">Arrivée</span><small>Message envoyé quand la date/heure d’arrivée est renseignée pour la première fois.</small></div></article>
        </div>
      </section>
    </div>
  )
}

function normalizePhoneForWhatsApp(value) {
  const digits = String(value || '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('00')) return digits.slice(2)
  if (digits.startsWith('225')) return digits
  if (digits.length === 10 && digits.startsWith('0')) return `225${digits}`
  return digits
}
