import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Copy, MessageCircle, Power, QrCode, RefreshCcw, RotateCcw, Save, Send, ShieldCheck, Smartphone, Webhook } from 'lucide-react'
import {
  disconnectWhatsApp,
  loadWhatsAppHistory,
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
const TEMPLATE_CARDS = [
  {
    key: 'created',
    label: 'Création BL',
    eyebrow: 'Déclencheur automatique',
    description: 'Envoyé dès qu’un nouveau bon de livraison est créé pour un client avec numéro WhatsApp.',
    accent: 'emerald',
    icon: MessageCircle,
    chips: ['Nouveau BL', 'Client notifié'],
  },
  {
    key: 'arrived',
    label: 'Arrivée / statut Livré',
    eyebrow: 'Fin de mission',
    description: 'Envoyé uniquement quand le statut du BL passe à Livré.',
    accent: 'violet',
    icon: CheckCircle2,
    chips: ['Statut Livré', 'Arrivée confirmée'],
  },
]
const TEMPLATE_VARIABLES = ['reference', 'client', 'status', 'truckLabel', 'driver', 'loadingPoint', 'destination', 'goods', 'quantity', 'date', 'departureDateTime', 'arrivalDateTime', 'notes']

export function WhatsAppPage() {
  const [recipientPhone, setRecipientPhone] = useState('')
  const [message, setMessage] = useState(DEFAULT_MESSAGE)
  const [copied, setCopied] = useState('')
  const [whatsAppStatus, setWhatsAppStatus] = useState(null)
  const [whatsAppQr, setWhatsAppQr] = useState(null)
  const [templates, setTemplates] = useState({})
  const [history, setHistory] = useState([])
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
  const connectionStateClass = whatsAppStatus?.connected ? 'connected' : whatsAppQr?.hasQr ? 'pairing' : 'pending'
  const connectionHelperText = whatsAppStatus?.connected
    ? `Session active avec ${displayedSender}. Tu peux déconnecter ce compte avant de scanner un autre téléphone.`
    : whatsAppQr?.hasQr
      ? 'QR prêt : ouvre WhatsApp sur le téléphone, puis scanne le code dans Appareils connectés.'
      : 'Lance la génération d’un QR pour connecter ou remplacer le compte WhatsApp.'

  const refreshWhatsAppConnection = useCallback(async () => {
    try {
      const [status, qr, templatePayload, historyPayload] = await Promise.all([loadWhatsAppStatus(), loadWhatsAppQr(), loadWhatsAppTemplates(), loadWhatsAppHistory()])
      setWhatsAppStatus(status)
      setWhatsAppQr(qr)
      setTemplates(templatePayload.templates || {})
      setHistory(historyPayload.history || [])
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
            <h3>WhatsApp</h3>
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

      <section className="panel panel-large whatsapp-connection-panel">
        <div className="whatsapp-connection-hero">
          <div className="connection-hero-copy">
            <span className="connection-kicker"><ShieldCheck size={14} /> Session sécurisée</span>
            <h3>Connexion / reconfiguration WhatsApp</h3>
            <p>Gère le téléphone connecté, remplace la session si besoin et génère un nouveau QR sans quitter Teliman.</p>
          </div>
          <div className={`connection-status-orb ${connectionStateClass}`} aria-label={`Statut WhatsApp : ${connectionLabel}`}>
            <span />
            <strong>{connectionLabel}</strong>
          </div>
        </div>

        <div className="connection-console-grid">
          <article className="connection-control-card">
            <div className="connection-card-header">
              <div className="connection-card-icon"><Smartphone size={20} /></div>
              <div>
                <span>Compte connecté</span>
                <strong>{displayedSender}</strong>
              </div>
            </div>
            <p>{connectionHelperText}</p>
            <div className="connection-step-list" aria-label="Étapes de connexion WhatsApp">
              <span><b>1</b> Déconnecter l’ancien compte si nécessaire</span>
              <span><b>2</b> Générer un nouveau QR</span>
              <span><b>3</b> Scanner avec WhatsApp → Appareils connectés</span>
            </div>
            <div className="connection-action-stack">
              <button type="button" className="danger-btn" disabled={Boolean(busyAction)} onClick={() => runAction('disconnect', () => disconnectWhatsApp(true))}><Power size={16} /> Déconnecter ce WhatsApp</button>
              <button type="button" className="primary-btn" disabled={Boolean(busyAction)} onClick={() => runAction('reconnect', () => reconnectWhatsApp(true))}><QrCode size={16} /> Générer un nouveau QR</button>
              <button type="button" className="ghost-btn small-btn" disabled={Boolean(busyAction)} onClick={() => runAction('soft-reconnect', () => reconnectWhatsApp(false))}><RefreshCcw size={16} /> Relancer la connexion</button>
            </div>
          </article>

          <article className={`connection-qr-card ${whatsAppQr?.qrDataUrl ? 'has-qr' : 'no-qr'}`}>
            <div className="connection-qr-topline">
              <div>
                <span>QR de connexion</span>
                <strong>{whatsAppQr?.qrDataUrl ? 'Prêt à scanner' : whatsAppStatus?.connected ? 'Compte déjà actif' : 'En attente'}</strong>
              </div>
              <QrCode size={22} />
            </div>
            {whatsAppQr?.qrDataUrl ? (
              <div className="whatsapp-qr-box redesigned">
                <img src={whatsAppQr.qrDataUrl} alt="QR code de connexion WhatsApp" />
                <small>Scanne ce QR avec le nouveau téléphone WhatsApp à connecter.</small>
              </div>
            ) : (
              <div className="connection-empty-qr">
                <QrCode size={42} />
                <strong>{whatsAppStatus?.connected ? 'Aucun QR nécessaire' : 'QR non généré'}</strong>
                <span>{whatsAppStatus?.connected ? `WhatsApp est connecté avec ${displayedSender}.` : 'Clique sur “Générer un nouveau QR” pour démarrer l’appairage.'}</span>
              </div>
            )}
          </article>
        </div>
        {actionMessage && <p className="connection-action-message"><CheckCircle2 size={15} /> {actionMessage}</p>}
      </section>

      <section className="panel panel-large">
        <div className="panel-header">
          <div>
            <h3>Envoyer un message test WhatsApp</h3>
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
          <button type="button" className="primary-btn" disabled={Boolean(busyAction) || !recipientPhone || !message} onClick={() => runAction('test-message', () => sendWhatsAppTestMessage({ to: recipientPhone, message }))}><MessageCircle size={16} /> Envoyer le test</button>
          <a className="ghost-btn small-btn" href={previewLink} target="_blank" rel="noreferrer"><MessageCircle size={16} /> Prévisualiser wa.me</a>
          <button type="button" className="ghost-btn small-btn" onClick={() => copyValue(previewLink, 'lien copié')}><Copy size={16} /> Copier le lien</button>
        </div>
      </section>

      <section className="stats-grid stats-grid-tight whatsapp-info-grid">
        <article className="stat-card"><div className="stat-icon"><Smartphone size={18} /></div><div><p>Numéro émetteur</p><strong>{displayedSender}</strong></div></article>
        <article className="stat-card"><div className="stat-icon"><Webhook size={18} /></div><div><p>Déclencheurs BL</p><strong>Création BL, statut Livré</strong></div></article>
        <article className="stat-card"><div className="stat-icon"><ShieldCheck size={18} /></div><div><p>Canal</p><strong>WhatsApp connecté</strong></div></article>
      </section>

      <section className="panel panel-large">
        <div className="panel-header">
          <div>
            <h3>Historique WhatsApp</h3>
            <p>Derniers messages envoyés, échecs et notifications ignorées. Les données sont stockées côté serveur hors Git.</p>
          </div>
          <button type="button" className="ghost-btn small-btn" onClick={refreshWhatsAppConnection}><RefreshCcw size={16} /> Actualiser</button>
        </div>
        {history.length ? (
          <div className="whatsapp-history-list">
            {history.map((entry) => (
              <article className={`whatsapp-history-item ${entry.status || 'failed'}`} key={entry.id || `${entry.sentAt}-${entry.recipient}`}>
                <div className="whatsapp-history-topline">
                  <span className={`status-pill ${entry.status || 'failed'}`}>{historyStatusLabel(entry.status)}</span>
                  <strong>{historyEventLabel(entry)}</strong>
                  <small>{formatHistoryDate(entry.sentAt)}</small>
                </div>
                <div className="whatsapp-history-meta">
                  <span>À : {entry.recipient || '-'}</span>
                  {entry.senderPhone && <span>Depuis : {entry.senderPhone}</span>}
                  {entry.client && <span>Client : {entry.client}</span>}
                  {entry.orderReference && <span>BL : {entry.orderReference}</span>}
                </div>
                {entry.reason && <p className="form-hint danger-text">Raison : {entry.reason}</p>}
                {entry.messagePreview && <p className="whatsapp-message-preview">{entry.messagePreview}</p>}
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state small-empty">Aucun historique WhatsApp pour le moment. Les prochains envois et échecs apparaîtront ici.</div>
        )}
      </section>

      <section className="panel panel-large whatsapp-template-panel">
        <div className="template-section-hero">
          <div className="template-section-copy">
            <span className="template-section-kicker">Messages automatiques BL</span>
            <h3>Templates des notifications BL</h3>
            <p>Personnalise les deux messages envoyés aux clients : création de BL et passage du statut à Livré. Les modifications sont enregistrées côté serveur hors Git.</p>
          </div>
          <div className="template-section-metrics" aria-label="Résumé des templates WhatsApp">
            <div>
              <strong>2</strong>
              <span>templates actifs</span>
            </div>
            <div>
              <strong>0</strong>
              <span>autre déclencheur</span>
            </div>
          </div>
        </div>

        <div className="template-variable-cloud" aria-label="Variables disponibles pour les templates">
          <span className="template-variable-title">Variables rapides</span>
          {TEMPLATE_VARIABLES.map((variable) => (
            <button type="button" key={variable} className="template-variable-chip" onClick={() => copyValue(`{{${variable}}}`, `variable ${variable} copiée`)}>{`{{${variable}}}`}</button>
          ))}
        </div>

        <div className="whatsapp-template-grid redesigned">
          {TEMPLATE_CARDS.map((card) => {
            const Icon = card.icon
            const value = templates[card.key] || ''
            return (
              <article className={`whatsapp-template-card ${card.accent}`} key={card.key}>
                <div className="template-card-header">
                  <div className="template-card-icon"><Icon size={19} /></div>
                  <div>
                    <span>{card.eyebrow}</span>
                    <h4>{card.label}</h4>
                  </div>
                </div>
                <p className="template-card-description">{card.description}</p>
                <div className="template-card-chips">
                  {card.chips.map((chip) => <span key={chip}>{chip}</span>)}
                </div>
                <label className="template-editor-label">
                  <span>Texte du message</span>
                  <textarea rows={8} value={value} onChange={(event) => updateTemplate(card.key, event.target.value)} placeholder="Rédige le message WhatsApp…" />
                </label>
                <div className="template-card-footer">
                  <span>{value.length} caractères</span>
                  <span>{(value.match(/{{/g) || []).length} variables</span>
                </div>
                <div className="template-preview-bubble">
                  <span>Aperçu client</span>
                  <p>{value || 'Le message apparaîtra ici pendant la saisie.'}</p>
                </div>
              </article>
            )
          })}
        </div>

        <div className="template-actions-bar">
          <div>
            <strong>Prêt à publier ?</strong>
            <span>Enregistre pour appliquer les textes aux prochains BL. Les anciens messages ne sont pas modifiés.</span>
          </div>
          <div className="table-actions">
            <button type="button" className="primary-btn" disabled={Boolean(busyAction)} onClick={() => runAction('save-templates', () => saveWhatsAppTemplates(templates))}><Save size={16} /> Enregistrer les templates</button>
            <button type="button" className="ghost-btn small-btn" disabled={Boolean(busyAction)} onClick={() => runAction('reset-templates', resetWhatsAppTemplates)}><RotateCcw size={16} /> Réinitialiser</button>
          </div>
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

function historyStatusLabel(status) {
  if (status === 'sent') return 'Envoyé'
  if (status === 'skipped') return 'Ignoré'
  return 'Échec'
}

function historyEventLabel(entry = {}) {
  if (entry.eventType === 'created') return 'Création BL'
  if (entry.eventType === 'arrived') return 'Arrivée / statut Livré'
  if (entry.eventType === 'test') return 'Message test'
  return entry.source === 'manual_test' ? 'Message test' : 'Notification BL'
}

function formatHistoryDate(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('fr-FR', {
    timeZone: 'Africa/Abidjan',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
