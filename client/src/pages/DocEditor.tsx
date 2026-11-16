import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { api } from '../api'
import { useAuth } from '../auth'
import { useApi } from '../hooks'
import { ErrorBox, Field, Loading, MoneyInput } from '../components/ui'
import Icon from '../components/Icon'
import { categoryLabel, date, dayToIso, isoDay, money } from '../format'

type Line = { kind: 'AGENCY' | 'DISBURSEMENT'; description: string; quantity: number; unitPrice: number | null; taxable: boolean; expenseId?: string | null }

export default function DocEditor() {
  const { id } = useParams()
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const { me } = useAuth()
  const c = me!.company
  const existing = useApi<any>(id ? `/docs/${id}` : null)
  const { data: clients } = useApi<any[]>('/clients')
  const { data: ships } = useApi<any[]>('/shipments?status=ALL')
  const [type, setType] = useState<'QUOTATION' | 'INVOICE'>((sp.get('type') as any) || 'INVOICE')
  const [h, setH] = useState({ clientId: sp.get('clientId') || '', shipmentId: sp.get('shipmentId') || '', issueDate: isoDay(), dueDate: isoDay(new Date(Date.now() + 7 * 864e5)), notes: '', showSecondary: !!c.secondaryCurrency, fxRate: c.fxRate || null as number | null })
  const [lines, setLines] = useState<Line[]>([
    { kind: 'AGENCY', description: 'Agency fee: customs clearance', quantity: 1, unitPrice: null, taxable: true },
    { kind: 'AGENCY', description: 'Documentation & entry processing', quantity: 1, unitPrice: null, taxable: true },
  ])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ship = useApi<any>(h.shipmentId ? `/shipments/${h.shipmentId}` : null)
  const rate = id && existing.data ? existing.data.taxRateBp : c.taxRateBp

  useEffect(() => {
    const d = existing.data
    if (!d) return
    setType(d.type)
    setH({ clientId: d.clientId, shipmentId: d.shipmentId || '', issueDate: isoDay(d.issueDate), dueDate: d.dueDate ? isoDay(d.dueDate) : '', notes: d.notes || '', showSecondary: !!d.secondaryCurrency, fxRate: d.fxRate })
    setLines(d.lines.map((l: any) => ({ kind: l.kind, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, taxable: l.taxable, expenseId: l.expenseId })))
  }, [existing.data])
  useEffect(() => {
    // picking a shipment picks its client
    const s = ships?.find((x) => x.id === h.shipmentId)
    if (s && s.clientId !== h.clientId) setH((p) => ({ ...p, clientId: s.clientId }))
  }, [h.shipmentId, ships])
  useEffect(() => { if (!id) setH((p) => ({ ...p, dueDate: isoDay(new Date(new Date(p.issueDate).getTime() + (type === 'QUOTATION' ? 14 : 7) * 864e5)) })) }, [type])

  const totals = useMemo(() => {
    let sub = 0, tax = 0
    for (const l of lines) { const a = Math.round((Number(l.quantity) || 0) * (l.unitPrice || 0)); sub += a; if (l.taxable) tax += Math.round((a * rate) / 10000) }
    return { sub, tax, total: sub + tax }
  }, [lines, rate])

  const used = new Set(lines.map((l) => l.expenseId).filter(Boolean))
  const unbilled = (ship.data?.expenses || []).filter((e: any) => e.status === 'APPROVED' && e.billable && (!e.lineItem || e.lineItem.doc?.id === id) && !used.has(e.id))
  const addExpenses = () => setLines([...lines, ...unbilled.map((e: any) => ({ kind: 'DISBURSEMENT' as const, description: `${categoryLabel(e.category)}: ${e.description}${e.reference ? ` (ref ${e.reference})` : ''}`, quantity: 1, unitPrice: e.amount, taxable: false, expenseId: e.id }))])
  const upd = (i: number, p: Partial<Line>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...p } : l)))
  const clientShips = ships?.filter((s) => !h.clientId || s.clientId === h.clientId)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    if (lines.some((l) => l.unitPrice == null || !l.description.trim())) return setErr('Every line needs a description and a price')
    setBusy(true)
    const body = { type, clientId: h.clientId, shipmentId: h.shipmentId || null, issueDate: dayToIso(h.issueDate), dueDate: h.dueDate ? dayToIso(h.dueDate) : null, notes: h.notes, showSecondary: h.showSecondary, fxRate: h.showSecondary ? h.fxRate : null, lines: lines.map((l) => ({ ...l, quantity: Number(l.quantity) || 1 })) }
    try {
      const d = id ? await api(`/docs/${id}`, { method: 'PUT', body }) : await api('/docs', { body })
      nav(`/docs/${d.id}`)
    } catch (x: any) { setErr(x.message); setBusy(false) }
  }

  if (id && !existing.data) return existing.error ? <ErrorBox error={existing.error} /> : <Loading />
  const order = (k: Line['kind']) => lines.map((l, i) => [l, i] as const).filter(([l]) => l.kind === k)
  return (
    <form onSubmit={save}>
      <div className="page-head">
        <div>
          <Link to={id ? `/docs/${id}` : '/billing'} className="crumb">← {id ? existing.data.number : 'Quotes & invoices'}</Link>
          <h1>{id ? `Edit ${existing.data.number}` : type === 'QUOTATION' ? 'New quotation' : 'New invoice'}</h1>
          <p className="muted">{c.currency}{c.secondaryCurrency ? ` (also shown in ${c.secondaryCurrency})` : ''} · {c.taxName} {rate / 100}% on taxable lines</p>
        </div>
        <div className="actions">
          {!id && <select value={type} onChange={(e) => setType(e.target.value as any)} aria-label="Type"><option value="QUOTATION">Quotation</option><option value="INVOICE">Invoice</option></select>}
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : id ? 'Save changes' : `Create ${type === 'QUOTATION' ? 'quotation' : 'invoice'}`}</button>
        </div>
      </div>
      <ErrorBox error={err} />
      <div className="card pad">
        <div className="grid4">
          <Field label="Client" className="span2">
            <select value={h.clientId} onChange={(e) => setH({ ...h, clientId: e.target.value, shipmentId: '' })} required>
              <option value="">Choose…</option>
              {clients?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
          <Field label="Shipment (optional)" className="span2">
            <select value={h.shipmentId} onChange={(e) => setH({ ...h, shipmentId: e.target.value })}>
              <option value="">Not linked</option>
              {clientShips?.map((s) => <option key={s.id} value={s.id}>{s.ref} · {s.goods.slice(0, 40)}</option>)}
            </select>
          </Field>
          <Field label="Date"><input type="date" value={h.issueDate} onChange={(e) => setH({ ...h, issueDate: e.target.value })} /></Field>
          <Field label={type === 'QUOTATION' ? 'Valid until' : 'Due date'}><input type="date" value={h.dueDate} onChange={(e) => setH({ ...h, dueDate: e.target.value })} /></Field>
          {c.secondaryCurrency && <>
            <Field label={`Show total in ${c.secondaryCurrency}`}><select value={h.showSecondary ? '1' : '0'} onChange={(e) => setH({ ...h, showSecondary: e.target.value === '1' })} disabled={!!id}><option value="1">Yes</option><option value="0">No</option></select></Field>
            {h.showSecondary && <Field label={`1 ${c.secondaryCurrency} = ? ${c.currency}`}><input type="number" step="any" min="0" value={h.fxRate ?? ''} onChange={(e) => setH({ ...h, fxRate: e.target.value ? Number(e.target.value) : null })} /></Field>}
          </>}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Lines</h2>
          <span className="actions">
            {h.shipmentId && unbilled.length > 0 && <button type="button" className="btn sm" onClick={addExpenses}><Icon name="wallet" size={14} />Add {unbilled.length} approved disbursement{unbilled.length > 1 ? 's' : ''} ({money(unbilled.reduce((a: number, e: any) => a + e.amount, 0))})</button>}
          </span>
        </div>
        <div className="table-wrap">
          <table className="table lines-table">
            <thead><tr><th>Description</th><th className="w-qty">Qty</th><th className="w-amt">Unit price</th><th>{c.taxName}</th><th className="num">Amount</th><th></th></tr></thead>
            <tbody>
              {(['AGENCY', 'DISBURSEMENT'] as const).map((k) => (
                <Section key={k} title={k === 'AGENCY' ? 'Agency fees & services' : 'Disbursements (paid on behalf of the client)'}>
                  {order(k).map(([l, i]) => (
                    <tr key={i}>
                      <td><input value={l.description} onChange={(e) => upd(i, { description: e.target.value })} required />{l.expenseId && <span className="sub small muted">from an approved expense</span>}</td>
                      <td><input className="w-qty" type="number" min="0.01" step="any" value={l.quantity} onChange={(e) => upd(i, { quantity: e.target.value as any })} /></td>
                      <td><MoneyInput className="w-amt" value={l.unitPrice} onChange={(v) => upd(i, { unitPrice: v })} /></td>
                      <td style={{ textAlign: 'center' }}><input type="checkbox" checked={l.taxable} onChange={(e) => upd(i, { taxable: e.target.checked })} aria-label="Taxable" /></td>
                      <td className="num">{money(Math.round((Number(l.quantity) || 0) * (l.unitPrice || 0)))}</td>
                      <td><button type="button" className="icon-btn" onClick={() => setLines(lines.filter((_, x) => x !== i))} aria-label="Remove line">×</button></td>
                    </tr>
                  ))}
                  <tr><td colSpan={6}><button type="button" className="btn sm ghost" onClick={() => setLines([...lines, { kind: k, description: '', quantity: 1, unitPrice: null, taxable: k === 'AGENCY' }])}><Icon name="plus" size={14} />Add {k === 'AGENCY' ? 'fee' : 'disbursement'}</button></td></tr>
                </Section>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pad">
          <div className="totals">
            <div><span>Subtotal</span><span>{money(totals.sub)}</span></div>
            <div><span>{c.taxName} {rate / 100}%</span><span>{money(totals.tax)}</span></div>
            <div className="grand"><span>Total</span><span>{money(totals.total)}</span></div>
            {h.showSecondary && h.fxRate ? <div className="muted small"><span>In {c.secondaryCurrency}</span><span>{money(Math.round((totals.total / 10 ** c.decimals / h.fxRate) * 10 ** (c.secondaryDecimals ?? 2)), c.secondaryCurrency!, c.secondaryDecimals ?? 2)}</span></div> : null}
          </div>
        </div>
      </div>
      <div className="card pad">
        <Field label="Notes on the document"><textarea rows={3} value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} placeholder="e.g. Duties billed at the assessed value. Payment within 7 days." /></Field>
        {ship.data && <p className="small muted" style={{ margin: 0 }}>Shipment {ship.data.ref}: opened {date(ship.data.createdAt)}, {ship.data.expenses.length} expenses logged.</p>}
      </div>
    </form>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (<><tr className="sec"><td colSpan={6}>{title}</td></tr>{children}</>)
}
