import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirmer', onConfirm, onCancel }) {
  const titleId = useId()
  const messageId = useId()
  const cancelRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const previousFocus = document.activeElement
    cancelRef.current?.focus()
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onCancel?.()
      if (event.key === 'Tab') {
        const buttons = document.querySelectorAll('.confirm-dialog button')
        const first = buttons[0]
        const last = buttons[buttons.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus?.()
    }
  }, [open, onCancel])

  if (!open) return null
  return createPortal(
    <div className="confirm-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel?.() }}>
      <section className="confirm-dialog panel" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId}>
        <h2 id={titleId}>{title}</h2>
        <p id={messageId}>{message}</p>
        <div className="table-actions">
          <button ref={cancelRef} type="button" className="ghost-btn" onClick={onCancel}>Annuler</button>
          <button type="button" className="danger-btn" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </section>
    </div>,
    document.body,
  )
}

export function useAccessibleConfirm() {
  const [request, setRequest] = useState(null)
  // Le résolveur est gardé hors de l'état React : le résoudre depuis un updater
  // (setRequest(current => { current.resolve() })) exécute un effet pendant la
  // phase de rendu et, si une demande en remplace une autre, la première promesse
  // n'est jamais résolue — l'appelant reste bloqué et le bouton semble ne rien faire.
  const pendingRef = useRef(null)

  const confirm = useCallback((options) => new Promise((resolve) => {
    pendingRef.current?.(false)
    pendingRef.current = resolve
    setRequest({ ...options })
  }), [])

  const close = useCallback((accepted) => {
    const resolve = pendingRef.current
    pendingRef.current = null
    setRequest(null)
    resolve?.(Boolean(accepted))
  }, [])

  const confirmationDialog = request ? (
    <ConfirmDialog
      open
      title={request.title || 'Confirmer cette action'}
      message={request.message || 'Cette action est irréversible.'}
      confirmLabel={request.confirmLabel}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  ) : null
  return { confirm, confirmationDialog }
}
