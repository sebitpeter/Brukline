import { useEffect, useState, type ReactNode } from 'react'
import { STATUS_LABEL, moneyCtx } from '../format'

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={'modal' + (wide ? ' wide' : '')} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <div className={'stat ' + (tone || '')}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

export function Pill({ status, label }: { status: string; label?: string }) {
  return <span className={'pill pill-' + status.toLowerCase()}>{label || STATUS_LABEL[status] || status.replace(/_/g, ' ').toLowerCase()}</span>
}

export function ErrorBox({ error }: { error: string | null | undefined }) {
  return error ? <div className="alert error">{error}</div> : null
}

export function Loading() {
  return <div className="muted pad">Loading…</div>
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={'field ' + (className || '')}>
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  )
}

/** Amount input in major units (what people type) that reports minor units to the parent. */
export function MoneyInput({ value, onChange, decimals = moneyCtx().decimals, required, autoFocus, placeholder, className }: { value: number | null; onChange: (minor: number | null) => void; decimals?: number; required?: boolean; autoFocus?: boolean; placeholder?: string; className?: string }) {
  const fmt = (v: number | null) => (v == null ? '' : (v / 10 ** decimals).toLocaleString('en-US', { maximumFractionDigits: decimals, useGrouping: true }))
  const [text, setText] = useState(fmt(value))
  useEffect(() => {
    const parsed = text.trim() === '' ? null : Math.round(Number(text.replace(/,/g, '')) * 10 ** decimals)
    if (parsed !== value) setText(fmt(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <input
      className={className}
      inputMode="decimal"
      value={text}
      required={required}
      autoFocus={autoFocus}
      placeholder={placeholder ?? (decimals ? '0.00' : '0')}
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d.,]/g, '')
        setText(t)
        const n = Number(t.replace(/,/g, ''))
        onChange(t.trim() === '' || !Number.isFinite(n) ? null : Math.round(n * 10 ** decimals))
      }}
      onBlur={() => setText(fmt(value))}
    />
  )
}

let toastFn: (m: string) => void = () => {}
export const toast = (m: string) => toastFn(m)
export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    let t: number
    toastFn = (m) => {
      setMsg(m)
      clearTimeout(t)
      t = window.setTimeout(() => setMsg(null), 3500)
    }
  }, [])
  return msg ? <div className="toast" role="status">{msg}</div> : null
}

export function Logo({ dark, className }: { dark?: boolean; className?: string }) {
  return <img src={dark ? '/brand/brukline-c-lockup-reversed.svg' : '/brand/brukline-c-lockup.svg'} alt="Brukline" className={className} />
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: [T, ReactNode][] }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)} type="button">{label}</button>
      ))}
    </div>
  )
}
