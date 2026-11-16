import { useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { useApi } from '../hooks'
import { ErrorBox, Field, Modal, MoneyInput } from './ui'
import { isoDay, dayToIso } from '../format'

export default function ShipmentForm({ shipment, onClose, onSaved }: { shipment?: any; onClose: () => void; onSaved: (s: any) => void }) {
  const { me, isFinance } = useAuth()
  const { data: clients } = useApi<any[]>(isFinance ? '/clients' : null)
  const { data: staff } = useApi<any[]>(isFinance ? '/staff/options' : null)
  const s = shipment || {}
  const [f, setF] = useState<any>({
    clientId: s.clientId || '', assignedToId: s.assignedToId || '', direction: s.direction || 'IMPORT', mode: s.mode || 'ROAD',
    truckRegs: s.truckRegs || '', trailerReg: s.trailerReg || '', driverName: s.driverName || '', driverPhone: s.driverPhone || '',
    containerNo: s.containerNo || '', blAwb: s.blAwb || '', entryNumber: s.entryNumber || '', station: s.station || '', origin: s.origin || '', destination: s.destination || '',
    goods: s.goods || '', hsCode: s.hsCode || '', packages: s.packages ?? '', weightKg: s.weightKg ?? '', customsValue: s.customsValue ?? null, eta: s.eta ? isoDay(s.eta) : '',
  })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value })
  const agentOnly = !isFinance

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    const body: any = { ...f, packages: f.packages === '' ? null : Number(f.packages), weightKg: f.weightKg === '' ? null : Number(f.weightKg), eta: f.eta ? dayToIso(f.eta) : null }
    if (agentOnly) for (const k of ['clientId', 'assignedToId', 'direction', 'mode', 'origin', 'destination', 'goods', 'hsCode', 'customsValue']) delete body[k]
    try {
      const r = shipment ? await api(`/shipments/${shipment.id}`, { method: 'PATCH', body }) : await api('/shipments', { body })
      onSaved(r)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={shipment ? `Edit ${shipment.ref}` : 'New shipment'} onClose={onClose} wide>
      <form onSubmit={save}>
        <ErrorBox error={err} />
        {!agentOnly && (
          <div className="grid2">
            <Field label="Client">
              <select value={f.clientId} onChange={set('clientId')} required>
                <option value="">Choose a client…</option>
                {clients?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Field agent">
              <select value={f.assignedToId} onChange={set('assignedToId')}>
                <option value="">Not assigned</option>
                {staff?.filter((u) => u.role !== 'ADMIN' || true).map((u) => <option key={u.id} value={u.id}>{u.name}{u.role === 'AGENT' ? '' : ` (${u.role.toLowerCase()})`}</option>)}
              </select>
            </Field>
            <Field label="Goods description" className="span2"><input value={f.goods} onChange={set('goods')} required placeholder="e.g. Roofing sheets, 1 x 40ft" /></Field>
          </div>
        )}
        <div className="grid4">
          {!agentOnly && <>
            <Field label="Direction"><select value={f.direction} onChange={set('direction')}><option value="IMPORT">Import</option><option value="EXPORT">Export</option><option value="TRANSIT">Transit</option></select></Field>
            <Field label="Mode"><select value={f.mode} onChange={set('mode')}><option value="ROAD">Road</option><option value="SEA">Sea</option><option value="AIR">Air</option><option value="RAIL">Rail</option></select></Field>
            <Field label="HS code (optional)"><input value={f.hsCode} onChange={set('hsCode')} placeholder="7308.90" /></Field>
            <Field label={`Customs value (${me!.company.currency})`}><MoneyInput value={f.customsValue} onChange={(v) => setF({ ...f, customsValue: v })} /></Field>
          </>}
          <Field label="Customs station / border">
            <input list="stations" value={f.station} onChange={set('station')} placeholder="Choose or type" />
            <datalist id="stations">{me!.company.stationList.map((s) => <option key={s} value={s} />)}</datalist>
          </Field>
          <Field label="Entry number"><input value={f.entryNumber} onChange={set('entryNumber')} placeholder="e.g. MAL C 24518" /></Field>
          <Field label="Container no."><input value={f.containerNo} onChange={set('containerNo')} placeholder="MSKU1234567" /></Field>
          <Field label="BL / AWB"><input value={f.blAwb} onChange={set('blAwb')} /></Field>
          <Field label="Truck reg(s)" hint="Comma-separate several"><input value={f.truckRegs} onChange={set('truckRegs')} placeholder="KCX 482A / ZF 3127" /></Field>
          <Field label="Trailer"><input value={f.trailerReg} onChange={set('trailerReg')} /></Field>
          <Field label="Driver"><input value={f.driverName} onChange={set('driverName')} /></Field>
          <Field label="Driver phone"><input value={f.driverPhone} onChange={set('driverPhone')} inputMode="tel" placeholder={`+${me!.company.dialCode}…`} /></Field>
          {!agentOnly && <>
            <Field label="Origin"><input value={f.origin} onChange={set('origin')} placeholder="Mombasa, Kenya" /></Field>
            <Field label="Destination"><input value={f.destination} onChange={set('destination')} placeholder="Kampala" /></Field>
          </>}
          <Field label="Packages"><input type="number" min="0" value={f.packages} onChange={set('packages')} /></Field>
          <Field label="Weight (kg)"><input type="number" min="0" step="0.01" value={f.weightKg} onChange={set('weightKg')} /></Field>
          <Field label="ETA"><input type="date" value={f.eta} onChange={set('eta')} /></Field>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : shipment ? 'Save changes' : 'Open shipment'}</button>
        </div>
      </form>
    </Modal>
  )
}
