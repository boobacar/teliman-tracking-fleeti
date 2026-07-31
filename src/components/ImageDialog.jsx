import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { ProtectedImage } from './ProtectedImage.jsx'

export function ImageDialog({ open, source, alt, title = 'Aperçu de l’image', onClose }) {
  const titleId = useId()
  const closeRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const previousFocus = document.activeElement
    closeRef.current?.focus()

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.()
      if (event.key === 'Tab') {
        event.preventDefault()
        closeRef.current?.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus?.()
    }
  }, [open, onClose])

  if (!open || !source) return null

  return createPortal(
    <div className="image-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.() }}>
      <section className="image-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className="sr-only">{title}</h2>
        <button ref={closeRef} type="button" className="ghost-btn icon-btn image-dialog-close" onClick={onClose} aria-label="Fermer l’image">
          <X size={24} />
        </button>
        <ProtectedImage source={source} alt={alt} className="image-dialog-image" />
      </section>
    </div>,
    document.body,
  )
}
