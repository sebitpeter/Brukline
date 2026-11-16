import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { api, download, openFile } from '../api'
import { useAuth } from '../auth'
import { useApi } from '../hooks'
import { ErrorBox, Field, Loading, toast } from '../components/ui'
import Icon from '../components/Icon'
import { dayToIso, isoDay } from '../format'

type Item = { marks: string; description: string; hsCode: string; quantity: string; unit: string; packageType: string; packages: string; netKg: string; grossKg: string; dimensions: string; cbm: string }
const blank = (): Item => ({ marks: '', description: '', hsCode: '', quantity: '', unit: 'pcs', packageType: 'cartons', packages: '', netKg: '', grossKg: '', dimensions: '', cbm: '' })

// same rules as the server (lib/packing.js) so the totals on screen match the PDF
function cbmOf(it: Item) {
  if (it.cbm !== '' && Number.isFinite(Number(it.cbm))) return Math.round(Number(it.cbm) * 1000) / 1000
  const m = it.dimensions.toLowerCase().match(/([\d.]+)\s*[x*×]\s*([\d.]+)\s*[x*×]\s*([\d.]+)\s*(mm|cm|m)?\b/)
  if (!m) return null
  const f = m[4] === 'mm' ? 1e-3 : m[4] === 'm' ? 1 : 1e-2
  return Math.round(Number(m[1]) * f * Number(m[2]) * f * Number(m[3]) * f * (Number(it.packages) || 0) * 1000) / 1000
}

export default function PackingEditor() {
  const { id } = useParams()
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const { me, isFinance } = useAuth()
  const existing = useApi<any>(id ? `/packing-lists/${id}` : null)
  const { data: ships } = useApi<any[]>('/shipments?status=ALL')
  const { data: clients } = useApi<any[]>(isFinance ? '/clients' : null)
  const [h, setH] = useState({ shipmentId: sp.get('shipmentId') || '', clientId: '', shipper: '', consignee: '', invoiceRef: '', containerNo: '', blAwb: '', truckReg: '', origin: '', destination: '', date: isoDay(), notes: '' })
  const [items, setItems] = useState<Item[]>([blank()])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const shipDetail = useApi<any>(!id && h.shipmentId ? `/shipments/${h.shipmentId}` : null)

  useEffect(() => {
    const p = existing.data
    if (!p) return
    setH({ shipmentId: p.shipmentId || '', clientId: p.clientId, shipper: p.shipper, consignee: p.consignee, invoiceRef: p.invoiceRef || '', containerNo: p.containerNo || '', blAwb: p.blAwb || '', truckReg: p.truckReg || '', origin: p.origin || '', destination: p.destination || '', date: isoDay(p.date), notes: p.notes || '' })
    setItems(p.items.map((i: any) => Object.fromEntries(Object.entries(blank()).map(([k]) => [k, i[k] == null ? '' : String(i[k])])) as Item))
  }, [existing.data])
  useEffect(() => {
    // prefill from the shipment on a new list
    const s = shipDetail.data
    if (!s || id) return
    setH((p) => ({ ...p, clientId: s.clientId, containerNo: s.containerNo || '', blAwb: s.blAwb || '', truckReg: s.truckRegs || '', origin: s.origin || '', destination: s.destination || '',
      ...(s.direction === 'EXPORT' ? { shipper: p.shipper || `${s.client.name}${s.client.address ? '\n' + s.client.address : ''}` } : { consignee: p.consignee || `${s.client.name}${s.client.address ? '\n' + s.client.address : ''}${s.client.taxId ? `\n${me!.company.taxIdLabel} ${s.client.taxId}` : ''}` }) }))
    setItems((it) => (it.length === 1 && !it[0].description ? [{ ...blank(), description: s.goods, hsCode: s.hsCode || '', packages: s.packages ? String(s.packages) : '' }] : it))
  }, [shipDetail.data])

  const totals = useMemo(() => {
    let packages = 0, net = 0, gross = 0, cbm = 0, has = false
    for (const it of items) { packages += Number(it.packages) || 0; net += Number(it.netKg) || 0; gross += Number(it.grossKg) || 0; const c = cbmOf(it); if (c != null) { cbm += c; has = true } }
    return { packages, net: Math.round(net * 100) / 100, gross: Math.round(gross * 100) / 100, cbm: has ? Math.round(cbm * 1000) / 1000 : null }
  }, [items])
  const upd = (i: number, k: keyof Item, v: string) => setItems(items.map((it, x) => (x === i ? { ...it, [k]: v } : it)))

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    const num = (v: string) => (v === '' ? 0 : Number(v))
    const body = { ...h, shipmentId: h.shipmentId || null, clientId: h.clientId || undefined, date: dayToIso(h.date), items: items.map((it) => ({ ...it, quantity: num(it.quantity), packages: Math.round(num(it.packages)), netKg: num(it.netKg), grossKg: num(it.grossKg), cbm: it.cbm === '' ? null : Number(it.cbm), marks: it.marks || null, hsCode: it.hsCode || null, unit: it.unit || null, packageType: it.packageType || null, dimensions: it.dimensions || null })) }
    try {
      const p = id ? await api(`/packing-lists/${id}`, { method: 'PUT', body }) : await api('/packing-lists', { body })
      toast(`${p.number} saved`)
      if (!id) nav(`/packing-lists/${p.id}`, { replace: true })
      else existing.reload()
    } catch (x: any) { setErr(x.message) } finally { setBusy(false) }
  }
  if (id && !existing.data) return existing.error ? <ErrorBox error={existing.error} /> : <Loading />
  const set = (k: string) => (e: any) => setH({ ...h, [k]: e.target.value })
  return (
    <form onSubmit={save}>
      <div className="page-head">
        <div>
          <Link to={h.shipmentId ? `/shipments/${h.shipmentId}` : '/packing-lists'} className="crumb">← {h.shipmentId ? 'Shipment' : 'Packing lists'}</Link>
          <h1>{id ? `Packing list ${existing.data.number}` : 'New packing list'}</h1>
          <p className="muted">Totals are worked out as you type. CBM comes from the dimensions × packages if you leave it blank.</p>
        </div>
        <div className="actions">
          {id && <><button type="button" className="btn secondary" onClick={() => openFile(`/packing-lists/${id}/pdf`)}><Icon name="eye" size={15} />Preview PDF</button>
            <button type="button" className="btn secondary" onClick={() => download(`/packing-lists/${id}/pdf?download=1`, `${existing.data.number}.pdf`)}><Icon name="download" size={15} />Download</button></>}
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : id ? 'Save changes' : 'Create packing list'}</button>
        </div>
      </div>
      <ErrorBox error={err} />
      <div className="card pad">
        <div className="grid4">
          <Field label="Shipment" className="span2">
            <select value={h.shipmentId} onChange={set('shipmentId')} required={!isFinance}>
              <option value="">{isFinance ? 'Not linked' : 'Choose…'}</option>
              {ships?.map((s) => <option key={s.id} value={s.id}>{s.ref} · {s.client.name}</option>)}
            </select>
          </Field>
          {isFinance && !h.shipmentId ? (
            <Field label="Client" className="span2"><select value={h.clientId} onChange={set('clientId')} required><option value="">Choose…</option>{clients?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          ) : <Field label="Date"><input type="date" value={h.date} onChange={set('date')} /></Field>}
          <Field label="Commercial invoice ref."><input value={h.invoiceRef} onChange={set('invoiceRef')} /></Field>
          <Field label="Shipper / exporter" className="span2"><textarea rows={3} value={h.shipper} onChange={set('shipper')} required placeholder={'Name\nAddress, country'} /></Field>
          <Field label="Consignee / importer" className="span2"><textarea rows={3} value={h.consignee} onChange={set('consignee')} required placeholder={'Name\nAddress, country'} /></Field>
          <Field label="Container no."><input value={h.containerNo} onChange={set('containerNo')} /></Field>
          <Field label="BL / AWB"><input value={h.blAwb} onChange={set('blAwb')} /></Field>
          <Field label="Truck reg."><input value={h.truckReg} onChange={set('truckReg')} /></Field>
          {isFinance && !h.shipmentId && <Field label="Date"><input type="date" value={h.date} onChange={set('date')} /></Field>}
          <Field label="Origin"><input value={h.origin} onChange={set('origin')} /></Field>
          <Field label="Destination"><input value={h.destination} onChange={set('destination')} /></Field>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2>Items</h2><button type="button" className="btn sm" onClick={() => setItems([...items, blank()])}><Icon name="plus" size={14} />Add item</button></div>
        <div className="table-wrap">
          <table className="table lines-table">
            <thead><tr><th>Marks & nos.</th><th>Description</th><th>HS code</th><th>Qty</th><th>Unit</th><th>Packages</th><th>Type</th><th>Net kg</th><th>Gross kg</th><th>Dimensions</th><th>CBM</th><th></th></tr></thead>
            <tbody>{items.map((it, i) => {
              const c = cbmOf(it)
              return (
                <tr key={i}>
                  <td><input value={it.marks} onChange={(e) => upd(i, 'marks', e.target.value)} style={{ minWidth: 100 }} /></td>
                  <td><input value={it.description} onChange={(e) => upd(i, 'description', e.target.value)} required style={{ minWidth: 200 }} /></td>
                  <td><input value={it.hsCode} onChange={(e) => upd(i, 'hsCode', e.target.value)} style={{ width: 90 }} /></td>
                  <td><input type="number" min="0" step="any" value={it.quantity} onChange={(e) => upd(i, 'quantity', e.target.value)} style={{ width: 80 }} /></td>
                  <td><input value={it.unit} onChange={(e) => upd(i, 'unit', e.target.value)} style={{ width: 60 }} /></td>
                  <td><input type="number" min="0" step="1" value={it.packages} onChange={(e) => upd(i, 'packages', e.target.value)} style={{ width: 75 }} /></td>
                  <td><input value={it.packageType} onChange={(e) => upd(i, 'packageType', e.target.value)} style={{ width: 80 }} /></td>
                  <td><input type="number" min="0" step="any" value={it.netKg} onChange={(e) => upd(i, 'netKg', e.target.value)} style={{ width: 90 }} /></td>
                  <td><input type="number" min="0" step="any" value={it.grossKg} onChange={(e) => upd(i, 'grossKg', e.target.value)} style={{ width: 90 }} className={Number(it.grossKg) < Number(it.netKg) ? 'bad-text' : ''} /></td>
                  <td><input value={it.dimensions} onChange={(e) => upd(i, 'dimensions', e.target.value)} placeholder="120x80x100 cm" style={{ width: 120 }} /></td>
                  <td><input type="number" min="0" step="any" value={it.cbm} onChange={(e) => upd(i, 'cbm', e.target.value)} placeholder={c != null ? String(c) : ''} style={{ width: 80 }} /></td>
                  <td><button type="button" className="icon-btn" onClick={() => setItems(items.length > 1 ? items.filter((_, x) => x !== i) : [blank()])} aria-label="Remove">×</button></td>
                </tr>
              )
            })}</tbody>
            <tfoot><tr><td colSpan={5}>Totals</td><td className="num">{totals.packages}</td><td></td><td className="num">{totals.net.toLocaleString()}</td><td className="num">{totals.gross.toLocaleString()}</td><td></td><td className="num">{totals.cbm ?? '-'}</td><td></td></tr></tfoot>
          </table>
        </div>
      </div>
      <div className="card pad"><Field label="Notes"><textarea rows={2} value={h.notes} onChange={set('notes')} /></Field></div>
    </form>
  )
}
