import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Copy, MessageCircle, Power, QrCode, RefreshCcw, RotateCcw, Save, Send, ShieldCheck, Smartphone, Webhook } from 'lucide-react'
import {
  disconnectWhatsApp,
  loadWhatsAppQr,
  loadWhatsAppStatus,
  loadWhatsAppTemplates,
  reconnectWhatsApp,
  resetWhatsAppTemplates,
  saveWhatsAppTemplates,
  sendWhatsAppTestMessage,
} from '../lib/fleeti.js'

const FALLBACK_PHONE_DISPLAY = '+225 07 00 184 839'
const FALLBACK_PHONE_E164 = '2250700184839'
const DEFAULT_MESSAGE = 'Bonjour, ici Teliman Logistique. Nous vous contactons concernant votre opération de transport.'
const TEMPLATE_LABELS = {
  created: 'Création BL',
  arrived: 'Arrivée / statut Livré',
}
const TEMPLATE_HELP = 'Variables disponibles : {{reference}}, {{client}}, {{status}}, {{truckLabel}}, {{driver}}, {{loadingPoint}}, {{destination}}, {{goods}}, {{quantity}}, {{date}}, {{departureDateTime}}, {{arrivalDateTime}}, {{notes}}'

export function WhatsAppPage() {
  const [recipientPhone, setRecipientPhone] = useState('')
  const [message, setMessage] = useState(DEFAULT_MESSAGE)
  const [copied, setCopied] = useState('')
  const [whatsAppStatus, setWhatsAppStatus] = useState(null)
  const [whatsAppQr, setWhatsAppQr] = useState(null)
  const [templates, setTemplates] = useState({})
  const [statusError, setStatusError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [busyAction, setBusyAction] = useState('')

  const connectedPhone = whatsAppStatus?.connectedPhone || ''
  const connectedPhoneRaw = whatsAppStatus?.user?.phoneRaw || normalizePhoneForWhatsApp(connectedPhone)
  const displayedSender = connectedPhone || FALLBACK_PHONE_DISPLAY
  const displayedSenderRaw = connectedPhoneRaw || FALLBACK_PHONE_E164
  const normalizedRecipient = useMemo(() => normalizePhoneForWhatsApp(recipientPhone), [recipientPhone])
  const previewLink = useMemo(() => {
    const target = normalizedRecipient || displayedSenderRaw
    return `https://wa.me/${target}?text=${encodeURIComponent(message || DEFAULT_MESSAGE)}`
  }, [displayedSenderRaw, message, normalizedRecipient])
  const connectionLabel = whatsAppStatus?.connected ? 'Connecté' : whatsAppQr?.hasQr ? 'QR à scanner' : whatsAppStatus?.state || 'Chargement…'

  const refreshWhatsAppConnection = useCallback(async () => {
    try {
      const [status, qr, templatePayload] = await Promise.all([loadWhatsAppStatus(), loadWhatsAppQr(), loadWhatsAppTemplates()])
      setWhatsAppStatus(status)
      setWhatsAppQr(qr)
      setTemplates(templatePayload.templates || {})
      setStatusError('')
    } catch (error) {
      setStatusError(error?.message || 'Impossible de charger la configuration WhatsApp.')
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

  async function runAction(label, action) {
    setBusyAction(label)
    setActionMessage('')
    try {
      const result = await action()
      setActionMessage(result?.reason || result?.message || 'Action effectuée.')
      await refreshWhatsAppConnection()
    } catch (error) {
      setActionMessage(error?.message || 'Action impossible.')
    } finally {
      setBusyAction('')
    }
  }

  async function copyValue(value, label) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(label)
      window.setTimeout(() => setCopied(''), 1600)
    } catch {
      setCopied('copie manuelle requise')
    }
  }

  const updateTemplate = (key, value) => setTemplates((current) => ({ ...current, [key]: value }))

  return (
    <div className="whatsapp-page page-stack">
      <section className="panel panel-large mission-hero-card whatsapp-hero-card">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Canal client</p>
            <h3>WhatsApp Baileys</h3>
            <p>Configuration complète : connexion, déconnexion, test d’envoi et templates actifs des notifications BL.</p>
          </div>
          <div className="whatsapp-hero-icon"><MessageCircle size={28} /></div>
        </div>
        <div className="mission-highlight-grid compact-mission-grid">
          <div className="mission-highlight-card whatsapp-number-card">
            <span>Numéro WhatsApp connecté</span>
            <strong>{displayedSender}</strong>
            <small>{whatsAppStatus?.connected ? `Compte : ${whatsAppStatus?.connectedName || 'WhatsApp connecté'}` : 'Aucun compte connecté actuellement.'}</small>
          </div>
          <div className="mission-highlight-card">
            <span>Statut connexion</span>
            <strong>{connectionLabel}</strong>
            <small>{statusError || (whatsAppStatus?.lastError ? whatsAppStatus.lastError : 'Session stockée côté serveur hors Git.')}</small>
          </div>
          <div className="mission-highlight-card">
            <span>Lien rapide</span>
            <strong>wa.me/{displayedSenderRaw}</strong>
            <small>Basé sur le numéro actuellement connecté.</small>
          </div>
        </div>
        <div className="table-actions" style={{ marginTop: 18 }}>
          <a className="primary-btn" href={`https://wa.me/${displayedSenderRaw}`} target="_blank" rel="noreferrer"><Send size={16} /> Ouvrir WhatsApp</a>
          <button type="button" className="ghost-btn small-btn" onClick={() => copyValue(displayedSender, 'numéro copié')}><Copy size={16} /> Copier le numéro connecté</button>
          <button type="button" className="ghost-btn small-btn" onClick={refreshWhatsAppConnection}><RefreshCcw size={16} /> Actualiser</button>
          {copied && <span className="success-chip"><CheckCircle2 size={14} /> {copied}</span>}
        </div>
      </section>

      <section className="panel panel-large">
        <div className="panel-header">
          <div>
            <h3>Connexion / reconfiguration WhatsApp</h3>
            <p>Déconnecte la session actuelle puis scanne un nouveau QR avec WhatsApp → Appareils connectés → Connecter un appareil.</p>
          </div>
          <QrCode size={22} />
        </div>
        <div className="table-actions" style={{ marginBottom: 16 }}>
          <button type="button" className="danger-btn" disabled={Boolean(busyAction)} onClick={() => runAction('disconnect', () => disconnectWhatsApp(true))}><Power size={16} /> Déconnecter ce WhatsApp</button>
          <button type="button" className="primary-btn" disabled={Boolean(busyAction)} onClick={() => runAction('reconnect', () => reconnectWhatsApp(true))}><QrCode size={16} /> Générer un nouveau QR</button>
          <button type="button" className="ghost-btn small-btn" disabled={Boolean(busyAction)} onClick={() => runAction('soft-reconnect', () => reconnectWhatsApp(false))}><RefreshCcw size={16} /> Relancer la connexion</button>
        </div>
        {whatsAppQr?.qrDataUrl ? (
          <div className="whatsapp-qr-box">
            <img src={whatsAppQr.qrDataUrl} alt="QR code de connexion WhatsApp" />
            <small>Scanne ce QR avec le nouveau téléphone WhatsApp à connecter.</small>
          </div>
        ) : (
          <div className="empty-state small-empty">
            {whatsAppStatus?.connected ? `WhatsApp est connecté avec ${displayedSender}.` : 'QR code en attente de génération côté serveur.'}
          </div>
        )}
        {actionMessage && <p className="form-hint success-text">{actionMessage}</p>}
      </section>

      <section className="panel panel-large">
        <div className="panel-header">
          <div>
            <h3>Envoyer un message test avec Baileys</h3>
            <p>Ce bouton envoie directement depuis le WhatsApp connecté, sans ouvrir WhatsApp Web.</p>
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
          <button type="button" className="primary-btn" disabled={Boolean(busyAction) || !recipientPhone || !message} onClick={() => runAction('test-message', () => sendWhatsAppTestMessage({ to: recipientPhone, message }))}><MessageCircle size={16} /> Envoyer test Baileys</button>
          <a className="ghost-btn small-btn" href={previewLink} target="_blank" rel="noreferrer"><MessageCircle size={16} /> Prévisualiser wa.me</a>
          <button type="button" className="ghost-btn small-btn" onClick={() => copyValue(previewLink, 'lien copié')}><Copy size={16} /> Copier le lien</button>
        </div>
      </section>

      <section className="stats-grid stats-grid-tight whatsapp-info-grid">
        <article className="stat-card"><div className="stat-icon"><Smartphone size={18} /></div><div><p>Numéro émetteur</p><strong>{displayedSender}</strong></div></article>
        <article className="stat-card"><div className="stat-icon"><Webhook size={18} /></div><div><p>Déclencheurs BL</p><strong>Création BL, statut Livré</strong></div></article>
        <article className="stat-card"><div className="stat-icon"><ShieldCheck size={18} /></div><div><p>Provider</p><strong>Baileys / WhatsApp Web</strong></div></article>
      </section>

      <section className="panel panel-large">
        <div className="panel-header">
          <div>
            <h3>Templates des notifications BL</h3>
            <p>Modifie ici les 2 messages automatiques envoyés aux clients : création de BL et passage du statut à Livré. Les variables entre doubles accolades seront remplacées par les données du BL.</p>
          </div>
        </div>
        <p className="form-hint">{TEMPLATE_HELP}</p>
        <div className="whatsapp-template-grid">
          {Object.entries(TEMPLATE_LABELS).map(([key, label]) => (
            <label key={key}>
              <span>{label}</span>
              <textarea rows={7} value={templates[key] || ''} onChange={(event) => updateTemplate(key, event.target.value)} />
            </label>
          ))}
        </div>
        <div className="table-actions" style={{ marginTop: 16 }}>
          <button type="button" className="primary-btn" disabled={Boolean(busyAction)} onClick={() => runAction('save-templates', () => saveWhatsAppTemplates(templates))}><Save size={16} /> Enregistrer les templates</button>
          <button type="button" className="ghost-btn small-btn" disabled={Boolean(busyAction)} onClick={() => runAction('reset-templates', resetWhatsAppTemplates)}><RotateCcw size={16} /> Réinitialiser</button>
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
