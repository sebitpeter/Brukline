import { useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { useApi } from '../hooks'
import { ErrorBox, Field, Modal, MoneyInput } from './ui'
import Icon from './Icon'
import { CATEGORIES, METHODS, bytes, categoryLabel, dayToIso, isoDay } from '../format'

/** Log an expense against a shipment. Big touch targets: field agents use this on a phone at the border. */
export default function ExpenseForm({ shipmentId, onClose, onSaved }: { shipmentId?: string; onClose: () => void; onSaved: () => void }) {
  const { me } = useAuth()
  const { data: ships } = useApi<any[]>(shipmentId ? null : '/shipments?status=ACTIVE')
  const [f, setF] = useState({ shipmentId: shipmentId || '', category: 'CUSTOMS_TAXES', description: '', amount: null as number | null, spentOn: isoDay(), method: 'MOBILE_MONEY', reference: '', billable: true })
  const [file, setFile] = useState<File | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!f.amount) return setErr('Enter the amount')
    setBusy(true)
    setErr(null)
    const fd = new FormData()
    fd.set('shipmentId', f.shipmentId)
    fd.set('category', f.category)
    fd.set('description', f.description || categoryLabel(f.category))
    fd.set('amount', String(f.amount))
    fd.set('spentOn', dayToIso(f.spentOn)!)
    fd.set('method', f.method)
    if (f.reference) fd.set('reference', f.reference)
    fd.set('billable', String(f.billable))
    if (file) fd.set('receipt', file)
    try {
      await api('/expenses', { form: fd })
      onSaved()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Log an expense" onClose={onClose}>
      <form onSubmit={save}>
        <ErrorBox error={err} />
        {!shipmentId && (
          <Field label="Shipment / truck">
            <select value={f.shipmentId} onChange={(e) => setF({ ...f, shipmentId: e.target.value })} required>
              <option value="">Choose…</option>
              {ships?.map((s) => <option key={s.id} value={s.id}>{s.ref} · {s.truckRegs?.split(',')[0] || s.containerNo || s.blAwb} · {s.client.name}</option>)}
            </select>
          </Field>
        )}
        <div className="field"><span>What was it for?</span></div>
        <div className="cat-grid">
          {CATEGORIES.map((c) => (
            <button type="button" key={c} className={f.category === c ? 'on' : ''} onClick={() => setF({ ...f, category: c, billable: c !== 'OTHER' })}>{categoryLabel(c)}</button>
          ))}
        </div>
        <Field label={`Amount (${me!.company.currency})`} className="big-amount">
          <MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} required />
        </Field>
        <Field label="Details"><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. Import duty & VAT as assessed" maxLength={300} /></Field>
        <div className="grid2">
          <Field label="Paid by">
            <select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
              {Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Date"><input type="date" value={f.spentOn} max={isoDay()} onChange={(e) => setF({ ...f, spentOn: e.target.value })} required /></Field>
        </div>
        <Field label="Reference" hint="Transaction ID, PRN or receipt number"><input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        <label className="dropzone">
          <input type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <Icon name="camera" size={22} />
          {file ? <strong>{file.name} · {bytes(file.size)}</strong> : <><strong>Add a photo of the receipt</strong>JPG, PNG or PDF</>}
        </label>
        <label className="check mt"><input type="checkbox" checked={f.billable} onChange={(e) => setF({ ...f, billable: e.target.checked })} /> Recharge to the client (disbursement)</label>
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save expense'}</button>
        </div>
      </form>
    </Modal>
  )
}
