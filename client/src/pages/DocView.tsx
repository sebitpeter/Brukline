import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api, blobUrl, download, openFile } from '../api'
import { useApi } from '../hooks'
import { ErrorBox, Field, Loading, Modal, MoneyInput, Pill, toast } from '../components/ui'
import Icon from '../components/Icon'
import { METHODS, date, dateTime, dayToIso, isoDay, money } from '../format'

export default function DocView() {
  const { id } = useParams()
  const nav = useNavigate()
  const { data: d, error, reload } = useApi<any>(`/docs/${id}`)
  const [pdf, setPdf] = useState<string | null>(null)
  const [modal, setModal] = useState<null | 'pay' | 'send'>(null)
  useEffect(() => {
    if (!d) return
    let url: string | null = null
    blobUrl(`/docs/${d.id}/pdf`).then((u) => { url = u; setPdf(u) }).catch(() => setPdf(null))
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [d])
  if (error) return <ErrorBox error={error} />
  if (!d) return <Loading />
  const isQ = d.type === 'QUOTATION'
  const act = async (path: string, body: any = {}, msg = 'Saved') => {
    try { const r = await api(`/docs/${d.id}${path}`, { body }); toast(msg); return r } catch (x: any) { toast(x.message) }
  }
  return (
    <>
      <div className="page-head">
        <div>
          <Link to={`/billing?tab=${d.type}`} className="crumb">← {isQ ? 'Quotations' : 'Invoices'}</Link>
          <h1>{d.number} <Pill status={d.overdue ? 'OVERDUE' : d.state || d.status} label={d.overdue ? 'Overdue' : undefined} /></h1>
          <p className="muted">{d.client.name}{d.shipment && <> · <Link to={`/shipments/${d.shipment.id}`}>{d.shipment.ref}</Link></>} · {date(d.issueDate)}{d.sourceQuote && <> · from <Link to={`/docs/${d.sourceQuote.id}`}>{d.sourceQuote.number}</Link></>}{d.invoice && <> · invoiced as <Link to={`/docs/${d.invoice.id}`}>{d.invoice.number}</Link></>}</p>
        </div>
        <div className="actions">
          <button className="btn secondary" onClick={() => download(`/docs/${d.id}/pdf?download=1`, `${d.number}.pdf`)}><Icon name="download" size={15} />PDF</button>
          <button className="btn secondary" onClick={() => setModal('send')} disabled={d.status === 'VOID'}><Icon name="send" size={15} />Send to client</button>
          {d.editable && <Link className="btn secondary" to={`/docs/${d.id}/edit`}><Icon name="edit" size={15} />Edit</Link>}
          {isQ && d.status !== 'CONVERTED' && d.status !== 'DECLINED' && <button className="btn" onClick={async () => { const r = await act('/convert', {}, 'Invoice created'); if (r) nav(`/docs/${r.id}`) }}>Convert to invoice</button>}
          {!isQ && d.state !== 'VOID' && d.balance > 0 && <button className="btn" onClick={() => setModal('pay')}><Icon name="wallet" size={15} />Record payment</button>}
        </div>
      </div>
      {!isQ && d.unbilled?.length > 0 && d.editable && (
        <div className="notice">{d.unbilled.length} approved disbursement{d.unbilled.length > 1 ? 's' : ''} on this shipment ({money(d.unbilled.reduce((a: number, e: any) => a + e.amount, 0))}) {d.unbilled.length > 1 ? 'are' : 'is'} not billed yet. <button className="btn sm" style={{ marginLeft: 8 }} onClick={async () => { await act('/pull-expenses', {}, 'Disbursements added'); reload() }}>Add to this invoice</button></div>
      )}
      <div className="two-col">
        <div className="card" style={{ padding: 8 }}>
          {pdf ? <iframe className="pdf-frame" src={pdf} title="Document preview" /> : <Loading />}
        </div>
        <div>
          <div className="card pad">
            <div className="totals" style={{ width: '100%' }}>
              <div><span>Subtotal</span><span>{money(d.subtotal, d.currency)}</span></div>
              <div><span>{d.taxName} {d.taxRateBp / 100}%</span><span>{money(d.taxTotal, d.currency)}</span></div>
              <div className="grand"><span>Total</span><span>{money(d.total, d.currency)}</span></div>
              {!isQ && <><div><span>Paid</span><span>{money(d.paid, d.currency)}</span></div><div className="grand"><span>Balance</span><span className={d.balance > 0 ? 'bad-text' : 'good-text'}>{money(d.balance, d.currency)}</span></div></>}
            </div>
          </div>
          {!isQ && (
            <div className="card">
              <div className="card-head"><h2>Payments & receipts</h2></div>
              {d.payments.length ? <table className="table"><tbody>{d.payments.map((p: any) => (
                <tr key={p.id}><td><strong>{p.receiptNumber}</strong><span className="sub">{date(p.paidAt)} · {METHODS[p.method]} {p.reference}</span></td><td className="num">{money(p.amount, d.currency)}</td>
                  <td className="num"><button className="btn sm secondary" onClick={() => openFile(`/docs/payments/${p.id}/pdf`)}>Receipt</button></td></tr>
              ))}</tbody></table> : <p className="pad muted" style={{ margin: 0 }}>No payments yet.</p>}
            </div>
          )}
          {isQ && d.status !== 'CONVERTED' && (
            <div className="card pad">
              <h2>Client's answer</h2>
              <div className="actions">
                <button className="btn secondary" disabled={d.status === 'ACCEPTED'} onClick={async () => { await act('/status', { status: 'ACCEPTED' }, 'Marked accepted'); reload() }}>Accepted</button>
                <button className="btn danger" disabled={d.status === 'DECLINED'} onClick={async () => { await act('/status', { status: 'DECLINED' }, 'Marked declined'); reload() }}>Declined</button>
                {d.status !== 'OPEN' && <button className="btn ghost" onClick={async () => { await act('/status', { status: 'OPEN' }, 'Reopened'); reload() }}>Reopen</button>}
              </div>
            </div>
          )}
          <div className="card">
            <div className="card-head"><h2>Sent to client</h2></div>
            {d.messages.length ? <div className="pad" style={{ display: 'grid', gap: 10 }}>{d.messages.map((m: any) => (
              <div key={m.id}><div className="bubble">{m.body}</div><div className="small muted" style={{ marginTop: 3 }}>{m.channel} · {dateTime(m.createdAt)} · <Pill status={m.status} /></div></div>
            ))}</div> : <p className="pad muted" style={{ margin: 0 }}>Not sent yet.</p>}
          </div>
          {!isQ && d.state !== 'VOID' && d.payments.length === 0 && (
            <p className="small" style={{ textAlign: 'right' }}><button className="btn sm danger" onClick={async () => { if (confirm('Void this invoice? Its number stays used and its disbursements can be billed again.')) { await act('/status', { status: 'VOID' }, 'Invoice voided'); reload() } }}>Void invoice</button></p>
          )}
          {isQ && d.status !== 'CONVERTED' && (
            <p className="small" style={{ textAlign: 'right' }}><button className="btn sm danger" onClick={async () => { if (confirm('Delete this quotation?')) { await api(`/docs/${d.id}`, { method: 'DELETE' }); nav('/billing?tab=QUOTATION') } }}>Delete quotation</button></p>
          )}
        </div>
      </div>
      {modal === 'pay' && <PayModal d={d} onClose={() => setModal(null)} onDone={() => { setModal(null); reload() }} />}
      {modal === 'send' && <SendModal d={d} onClose={() => setModal(null)} onDone={() => { setModal(null); reload() }} />}
    </>
  )
}

function PayModal({ d, onClose, onDone }: { d: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ amount: d.balance as number | null, method: 'MOBILE_MONEY', reference: '', paidAt: isoDay(), notify: !!d.client.phone })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await api(`/docs/${d.id}/payments`, { body: { ...f, paidAt: dayToIso(f.paidAt), reference: f.reference || null } })
      toast(`Receipt ${r.payment.receiptNumber} issued`)
      openFile(`/docs/payments/${r.payment.id}/pdf`).catch(() => {})
      onDone()
    } catch (x: any) { setErr(x.message); setBusy(false) }
  }
  return (
    <Modal title={`Record payment on ${d.number}`} onClose={onClose}>
      <form onSubmit={save}>
        <ErrorBox error={err} />
        <p className="muted" style={{ marginTop: 0 }}>Balance {money(d.balance, d.currency)}</p>
        <Field label={`Amount (${d.currency})`} className="big-amount"><MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} decimals={d.decimals} required /></Field>
        <div className="grid2">
          <Field label="Method"><select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Date received"><input type="date" value={f.paidAt} max={isoDay()} onChange={(e) => setF({ ...f, paidAt: e.target.value })} /></Field>
        </div>
        <Field label="Reference" hint={f.method === 'CASH' ? 'Optional for cash' : 'Transaction ID, cheque or bank reference'}><input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} required={f.method !== 'CASH'} /></Field>
        <label className="check"><input type="checkbox" checked={f.notify} disabled={!d.client.phone} onChange={(e) => setF({ ...f, notify: e.target.checked })} /> Send the client a receipt message</label>
        <div className="modal-actions"><button type="button" className="btn secondary" onClick={onClose}>Cancel</button><button className="btn" disabled={busy}>Save & issue receipt</button></div>
      </form>
    </Modal>
  )
}

function SendModal({ d, onClose, onDone }: { d: any; onClose: () => void; onDone: () => void }) {
  const [channel, setChannel] = useState(d.client.channel || 'SMS')
  const [includeLink, setIncludeLink] = useState(true)
  const [preview, setPreview] = useState<any>(null)
  useEffect(() => { api(`/docs/${d.id}/send`, { body: { channel, includeLink, preview: true } }).then(setPreview).catch((x) => toast(x.message)) }, [channel, includeLink])
  const send = async () => {
    try { const m = await api(`/docs/${d.id}/send`, { body: { channel, includeLink } }); toast(m.status === 'SENT' ? `Sent by ${m.channel}` : `Failed: ${m.error}`); onDone() } catch (x: any) { toast(x.message) }
  }
  return (
    <Modal title={`Send ${d.number} to ${d.client.name}`} onClose={onClose}>
      {!d.client.phone && <div className="alert warn">This client has no phone number. Add one on the client first.</div>}
      <div className="grid2">
        <Field label="Send by"><select value={channel} onChange={(e) => setChannel(e.target.value)}><option value="SMS">SMS</option><option value="WHATSAPP">WhatsApp</option></select></Field>
        <Field label="To"><input value={d.client.phone || ''} readOnly /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={includeLink} onChange={(e) => setIncludeLink(e.target.checked)} /> Include a link to view the PDF</label>
      {preview && <div className="bubble">{preview.body}</div>}
      <div className="modal-actions mt"><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn" onClick={send} disabled={!d.client.phone}><Icon name="send" size={15} />Send</button></div>
    </Modal>
  )
}
