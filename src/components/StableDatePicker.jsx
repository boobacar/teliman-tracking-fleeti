import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { CalendarDays, X } from 'lucide-react'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/dist/style.css'

function normalizeDate(value) {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function StableDatePicker({
  value,
  onChange,
  placeholder = 'Choisir une date',
  withTime = false,
  clearable = true,
  className = 'filter-control modern-date-input',
}) {
  const wrapperRef = useRef(null)
  const triggerRef = useRef(null)
  const popoverRef = useRef(null)
  const dialogId = useId()
  const [open, setOpen] = useState(false)
  const [timeValue, setTimeValue] = useState('00:00')
  const [popoverStyle, setPopoverStyle] = useState(null)
  const selected = useMemo(() => normalizeDate(value), [value])

  function closePopover({ restoreFocus = true } = {}) {
    setOpen(false)
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }

  useEffect(() => {
    function handleClickOutside(event) {
      if (!wrapperRef.current?.contains(event.target) && !popoverRef.current?.contains(event.target)) {
        closePopover({ restoreFocus: false })
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const handleEscape = (event) => {
      if (event.key === 'Escape') closePopover()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [open])

  useEffect(() => {
    if (!open || !popoverStyle) return undefined
    const frame = requestAnimationFrame(() => {
      const target = popoverRef.current?.querySelector('[aria-selected="true"], button:not([disabled]), input')
      target?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [open, popoverStyle])

  useEffect(() => {
    if (!open || !wrapperRef.current) return undefined

    function updatePopoverPosition() {
      if (!wrapperRef.current) return
      const rect = wrapperRef.current.getBoundingClientRect()
      const popoverWidth = Math.min(320, window.innerWidth - 16)
      const popoverHeight = withTime ? 390 : 340
      const spaceBelow = window.innerHeight - rect.bottom
      const top = spaceBelow >= popoverHeight + 8
        ? rect.bottom + 8
        : Math.max(8, rect.top - popoverHeight - 8)
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - popoverWidth - 8))
      setPopoverStyle({
        position: 'fixed',
        top,
        left,
        width: popoverWidth,
        maxHeight: Math.max(240, window.innerHeight - 16),
        overflowY: 'auto',
        zIndex: 2147483647,
      })
    }

    updatePopoverPosition()
    window.addEventListener('resize', updatePopoverPosition)
    window.addEventListener('scroll', updatePopoverPosition, true)
    return () => {
      window.removeEventListener('resize', updatePopoverPosition)
      window.removeEventListener('scroll', updatePopoverPosition, true)
    }
  }, [open, withTime])

  useEffect(() => {
    if (selected && withTime) setTimeValue(format(selected, 'HH:mm'))
  }, [selected, withTime])

  function applyDate(nextDate) {
    if (!nextDate) {
      onChange?.(null)
      closePopover()
      return
    }
    if (withTime) {
      const [hours, minutes] = String(timeValue || '00:00').split(':').map((part) => Number(part) || 0)
      const merged = new Date(nextDate)
      merged.setHours(hours, minutes, 0, 0)
      onChange?.(merged)
    } else {
      onChange?.(nextDate)
      closePopover()
    }
  }

  function applyTime(nextTime) {
    setTimeValue(nextTime)
    if (!selected) return
    const [hours, minutes] = String(nextTime || '00:00').split(':').map((part) => Number(part) || 0)
    const merged = new Date(selected)
    merged.setHours(hours, minutes, 0, 0)
    onChange?.(merged)
  }

  const displayValue = selected ? format(selected, withTime ? 'dd/MM/yyyy HH:mm' : 'dd/MM/yyyy', { locale: fr }) : ''

  return (
    <div className="stable-date-picker-shell" ref={wrapperRef}>
      <div className="stable-date-picker-trigger-wrap">
        <button
          ref={triggerRef}
          type="button"
          className={`${className} stable-date-picker-trigger ${selected ? '' : 'is-placeholder'}`.trim()}
          onClick={() => open ? closePopover({ restoreFocus: false }) : setOpen(true)}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-controls={dialogId}
          aria-label={placeholder}
        >
          <span>{displayValue || placeholder}</span>
          <CalendarDays size={18} />
        </button>
        {clearable && selected ? (
          <button type="button" className="stable-date-picker-inline-clear" onClick={() => { onChange?.(null); triggerRef.current?.focus() }} aria-label="Réinitialiser la date">
            <X size={18} />
          </button>
        ) : null}
      </div>
      {open && popoverStyle ? createPortal(
        <div ref={popoverRef} id={dialogId} className="stable-date-picker-popover" style={popoverStyle} role="dialog" aria-modal="false" aria-label={placeholder}>
          <DayPicker mode="single" selected={selected || undefined} onSelect={applyDate} locale={fr} weekStartsOn={1} />
          {withTime ? (
            <div className="stable-date-picker-time-row">
              <input type="time" value={timeValue} onChange={(event) => applyTime(event.target.value)} aria-label="Heure" />
              <button type="button" className="ghost-btn" onClick={() => closePopover()}>Valider</button>
            </div>
          ) : null}
        </div>,
        document.body,
      ) : null}
    </div>
  )
}
