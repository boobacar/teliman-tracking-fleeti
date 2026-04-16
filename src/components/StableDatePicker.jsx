import DatePicker from 'react-datepicker'
import { fr } from 'date-fns/locale'
import 'react-datepicker/dist/react-datepicker.css'

export function StableDatePicker({
  value,
  onChange,
  placeholder = 'Choisir une date',
  withTime = false,
  clearable = true,
  className = 'filter-control modern-date-input',
  popperClassName = 'modern-date-popper',
}) {
  const selected = value instanceof Date ? value : value ? new Date(value) : null
  const isValid = selected instanceof Date && !Number.isNaN(selected.getTime())

  return (
    <div className="stable-date-picker-wrap">
      <DatePicker
        selected={isValid ? selected : null}
        onChange={onChange}
        showTimeSelect={withTime}
        timeIntervals={5}
        dateFormat={withTime ? 'dd/MM/yyyy HH:mm' : 'dd/MM/yyyy'}
        locale={fr}
        placeholderText={placeholder}
        isClearable={clearable}
        className={className}
        popperClassName={popperClassName}
      />
      {clearable && isValid ? (
        <button type="button" className="stable-date-picker-clear" onClick={() => onChange(null)} aria-label="Réinitialiser la date">
          Réinitialiser
        </button>
      ) : null}
    </div>
  )
}
