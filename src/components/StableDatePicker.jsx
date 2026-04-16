import { useEffect, useMemo, useRef, useState } from 'react'
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
  const [open, setOpen] = useState(false)
  const [timeValue, setTimeValue] = useState('00:00')
  const [popoverStyle, setPopoverStyle] = useState(null)

  const selected = useMemo(() => normalizeDate(value), [value])

  useEffect(() => {
    function handleClickOutside(event) {
      const popover = document.querySelector('.stable-date-picker-popover')
      if (!wrapperRef.current?.contains(event.target) && !popover?.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (!open || !wrapperRef.current) return
    const rect = wrapperRef.current.getBoundingClientRect()
    setPopoverStyle({
      position: 'fixed',
      top: rect.bottom + 8,
      left: rect.left,
      zIndex: 2147483647,
    })
  }, [open])

  useEffect(() => {
    if (selected && withTime) {
      setTimeValue(format(selected, 'HH:mm'))
    }
  }, [selected, withTime])

  function applyDate(nextDate) {
    if (!nextDate) {
      onChange?.(null)
      setOpen(false)
      return
    }
    if (withTime) {
      const [hours, minutes] = String(timeValue || '00:00').split(':').map((part) => Number(part) || 0)
      const merged = new Date(nextDate)
      merged.setHours(hours, minutes, 0, 0)
      onChange?.(merged)
    } else {
      onChange?.(nextDate)
      setOpen(false)
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
      <div className={`${className} stable-date-picker-trigger-wrap`}>
        <button type="button" className="stable-date-picker-trigger" onClick={() => setOpen((prev) => !prev)}>
          <span>{displayValue || placeholder}</span>
          <CalendarDays size={16} />
        </button>
        {clearable && selected ? (
          <button type="button" className="stable-date-picker-inline-clear" onClick={() => onChange?.(null)} aria-label="Réinitialiser la date">
            <X size={12} />
          </button>
        ) : null}
      </div>
      {open && popoverStyle ? createPortal(
        <div className="stable-date-picker-popover" style={popoverStyle}>
          <DayPicker
            mode="single"
            selected={selected || undefined}
            onSelect={applyDate}
            locale={fr}
            weekStartsOn={1}
          />
          {withTime ? (
            <div className="stable-date-picker-time-row">
              <input type="time" value={timeValue} onChange={(event) => applyTime(event.target.value)} />
              <button type="button" className="ghost-btn small-btn" onClick={() => setOpen(false)}>Valider</button>
            </div>
          ) : null}
        </div>,
        document.body,
      ) : null}
    </div>
  )
}
