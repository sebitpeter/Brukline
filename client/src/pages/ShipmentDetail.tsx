import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api, download, openFile } from '../api'
import { useAuth } from '../auth'
import { useApi } from '../hooks'
import { Empty, ErrorBox, Field, Loading, Modal, Pill, Tabs, toast } from '../components/ui'
import Icon from '../components/Icon'
import ShipmentForm from '../components/ShipmentForm'
import ExpenseForm from '../components/ExpenseForm'
import ReviewButtons from '../components/ReviewButtons'
import { FILE_TYPES, METHODS, STATUSES, STATUS_LABEL, bytes, categoryLabel, date, dateTime, money } from '../format'

type Tab = 'expenses' | 'files' | 'timeline' | 'billing' | 'packing'

export default function ShipmentDetail() {
  const { id } = useParams()
  const { me, isFinance } = useAuth()
  const nav = useNavigate()
  const { data: s, error, reload } = useApi<any>(`/shipments/${id}`)
  const [tab, setTab] = useState<Tab>('expenses')
  const [modal, setModal] = useState<null | 'edit' | 'status' | 'expense' | 'upload' | 'message'>(null)
  if (error) return <ErrorBox error={error} />
  if (!s) return <Loading />
  const idx = STATUSES.indexOf(s.status)
  const next = STATUSES[idx + 1]
  const done = () => { setModal(null); reload() }

  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/shipments" className="crumb">← Shipments</Link>
          <h1>{s.ref} <Pill status={s.status} /></h1>
          <p className="muted">{s.client.name} · {s.goods}</p>
        </div>
        <div className="actions">
          <button className="btn secondary" onClick={() => setModal('message')}><Icon name="send" size={15} />Message client</button>
          <button className="btn secondary" onClick={() => setModal('edit')}><Icon name="edit" size={15} />Edit</button>
          {next && (next !== 'CLOSED' || isFinance) && <button className="btn" onClick={() => setModal('status')}>Move to {STATUS_LABEL[next]}<Icon name="arrow" size={15} /></button>}
        </div>
      </div>

      <div className="card pad" style={{ paddingBottom: 10 }}>
        <div className="stepper">
          {STATUSES.map((st, i) => (
            <div key={st} className={'step ' + (i < idx ? 'done' : i === idx ? 'now' : '')}><span className="dot" />{STATUS_LABEL[st]}</div>
          ))}
        </div>
      </div>

      <div className="two-col mt">
        <div>
          {isFinance && s.finance && (
            <div className="card">
              <div className="profit-box">
                <div><div className="stat-label">Invoiced</div><div className="stat-value">{money(s.finance.invoiced)}</div><div className="stat-sub">Paid {money(s.finance.paid)}</div></div>
                <div><div className="stat-label">Approved costs</div><div className="stat-value">{money(s.finance.costs)}</div><div className="stat-sub">{s.costs.pending ? `${money(s.costs.pending)} pending` : 'none pending'}</div></div>
                <div><div className="stat-label">Not yet billed</div><div className="stat-value">{money(s.finance.unbilled)}</div><div className="stat-sub">approved disbursements</div></div>
                <div><div className="stat-label">Profit</div><div className={'stat-value ' + (s.finance.profit < 0 ? 'bad-text' : 'good-text')}>{money(s.finance.profit)}</div><div className="stat-sub">invoiced before tax − costs</div></div>
              </div>
            </div>
          )}
          <div className="card">
            <Tabs<Tab> value={tab} onChange={setTab} tabs={[
              ['expenses', <>Expenses ({s.expenses.length})</>], ['files', <>Documents ({s.files.length})</>], ['packing', <>Packing lists ({s.packingLists.length})</>],
              ...(isFinance ? [['billing', <>Billing ({s.salesDocs.length})</>] as [Tab, any]] : []), ['timeline', 'Timeline'],
            ]} />
            {tab === 'expenses' && <ExpensesTab s={s} reload={reload} onAdd={() => setModal('expense')} />}
            {tab === 'files' && <FilesTab s={s} reload={reload} onAdd={() => setModal('upload')} meId={me!.id} isFinance={isFinance} />}
            {tab === 'packing' && (
              <div>
                <div className="card-head" style={{ borderTop: 0 }}><span className="muted small">Generated packing lists for this shipment</span><Link className="btn sm" to={`/packing-lists/new?shipmentId=${s.id}`}>New packing list</Link></div>
                {s.packingLists.length ? s.packingLists.map((p: any) => (
                  <div className="file-row" key={p.id}>
                    <div className="file-ico">PL</div>
                    <div className="grow"><strong>{p.number}</strong><span className="small muted">{date(p.date)}</span></div>
                    <Link className="btn sm secondary" to={`/packing-lists/${p.id}`}>Open</Link>
                    <button className="btn sm secondary" onClick={() => openFile(`/packing-lists/${p.id}/pdf`)}>PDF</button>
                  </div>
                )) : <Empty>No packing list yet.</Empty>}
              </div>
            )}
            {tab === 'billing' && isFinance && (
              <div>
                <div className="card-head"><span className="muted small">Quotations and invoices for this shipment</span>
                  <span className="actions"><Link className="btn sm secondary" to={`/docs/new?type=QUOTATION&shipmentId=${s.id}`}>New quotation</Link><Link className="btn sm" to={`/docs/new?type=INVOICE&shipmentId=${s.id}`}>New invoice</Link></span></div>
                {s.salesDocs.length ? (
                  <table className="table"><tbody>
                    {s.salesDocs.map((d: any) => (
                      <tr key={d.id} className="click" onClick={() => nav(`/docs/${d.id}`)}>
                        <td><strong>{d.number}</strong><span className="sub">{d.type === 'QUOTATION' ? 'Quotation' : 'Invoice'} · {date(d.issueDate)}</span></td>
                        <td><Pill status={d.state || d.status} /></td>
                        <td className="num">{money(d.total, d.currency)}{d.type === 'INVOICE' && d.balance > 0 && <span className="sub">balance {money(d.balance, d.currency)}</span>}</td>
                      </tr>
                    ))}
                  </tbody></table>
                ) : <Empty>Nothing billed yet.</Empty>}
              </div>
            )}
            {tab === 'timeline' && <Timeline s={s} reload={reload} />}
          </div>
        </div>
        <div>
          <div className="card">
            <div className="card-head"><h2>Consignment</h2><span className="small muted">{s.direction.toLowerCase()} · {s.mode.toLowerCase()}</span></div>
            <dl className="kv pad">
              <dt>Client</dt><dd>{isFinance ? <Link to={`/clients?open=${s.client.id}`}>{s.client.name}</Link> : s.client.name}{s.client.phone && <span className="sub small muted">{s.client.contactPerson ? s.client.contactPerson + ' · ' : ''}{s.client.phone}</span>}</dd>
              <dt>Station</dt><dd>{s.station || '-'}</dd>
              <dt>Entry no.</dt><dd className="mono">{s.entryNumber || '-'}</dd>
              <dt>Truck(s)</dt><dd className="mono">{s.truckRegs || '-'}{s.trailerReg ? ` · trailer ${s.trailerReg}` : ''}</dd>
              <dt>Driver</dt><dd>{s.driverName || '-'}{s.driverPhone && <> · <a href={`tel:${s.driverPhone}`}>{s.driverPhone}</a></>}</dd>
              <dt>Container</dt><dd className="mono">{s.containerNo || '-'}</dd>
              <dt>BL / AWB</dt><dd className="mono">{s.blAwb || '-'}</dd>
              <dt>Route</dt><dd>{s.origin || '?'} → {s.destination || '?'}</dd>
              <dt>Goods</dt><dd>{s.goods}{s.hsCode && <span className="muted"> · HS {s.hsCode}</span>}</dd>
              <dt>Packages / weight</dt><dd>{s.packages ?? '-'} pkgs · {s.weightKg ? `${Number(s.weightKg).toLocaleString()} kg` : '-'}</dd>
              {isFinance && <><dt>Customs value</dt><dd>{s.customsValue ? money(s.customsValue) : '-'}</dd></>}
              <dt>ETA</dt><dd>{date(s.eta) || '-'}</dd>
              <dt>Field agent</dt><dd>{s.assignedTo?.name || '-'}</dd>
              <dt>Opened</dt><dd>{date(s.createdAt)}</dd>
            </dl>
          </div>
        </div>
      </div>

      {modal === 'edit' && <ShipmentForm shipment={s} onClose={() => setModal(null)} onSaved={done} />}
      {modal === 'status' && <StatusModal s={s} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'expense' && <ExpenseForm shipmentId={s.id} onClose={() => setModal(null)} onSaved={() => { toast('Expense saved, waiting for approval'); done() }} />}
      {modal === 'upload' && <UploadModal s={s} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'message' && <MessageModal s={s} onClose={() => setModal(null)} onDone={done} />}
    </>
  )
}

function ExpensesTab({ s, reload, onAdd }: { s: any; reload: () => void; onAdd: () => void }) {
  const total = s.expenses.filter((e: any) => e.status !== 'REJECTED').reduce((a: number, e: any) => a + e.amount, 0)
  return (
    <div>
      <div className="card-head"><span className="muted small">Money spent on this shipment by staff</span><button className="btn sm" onClick={onAdd}><Icon name="plus" size={14} />Log expense</button></div>
      {s.expenses.length ? (
        <div className="table-wrap">
          <table className="table responsive">
            <thead><tr><th>Date</th><th>What</th><th>By</th><th className="num">Amount</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {s.expenses.map((e: any) => (
                <tr key={e.id}>
                  <td data-label="Date" className="nowrap">{date(e.spentOn)}</td>
                  <td data-label="What"><strong>{categoryLabel(e.category)}</strong><span className="sub">{e.description}{e.reference ? ` · ${e.reference}` : ''} · {METHODS[e.method]}{!e.billable ? ' · not billable' : ''}</span>
                    {e.lineItem?.doc && <span className="sub">Billed on <Link to={`/docs/${e.lineItem.doc.id}`}>{e.lineItem.doc.number}</Link></span>}
                    {e.reviewNote && <span className="sub bad-text">“{e.reviewNote}”</span>}</td>
                  <td data-label="By">{e.spentBy.name}</td>
                  <td data-label="Amount" className="num">{money(e.amount)}</td>
                  <td data-label="Status"><Pill status={e.status} /></td>
                  <td data-label="" className="num">
                    <span className="actions" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                      {e.receiptFile && <button className="btn sm ghost" title="View receipt" onClick={() => openFile(`/expenses/${e.id}/receipt?inline=1`).catch((x) => toast(x.message))}><Icon name="file" size={14} />Receipt</button>}
                      <ReviewButtons e={e} onDone={reload} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={3}>Total (excluding rejected)</td><td className="num">{money(total)}</td><td colSpan={2}></td></tr></tfoot>
          </table>
        </div>
      ) : <Empty>No expenses logged yet.</Empty>}
    </div>
  )
}

function FilesTab({ s, reload, onAdd, meId, isFinance }: { s: any; reload: () => void; onAdd: () => void; meId: string; isFinance: boolean }) {
  const del = async (f: any) => {
    if (!confirm(`Delete ${f.originalName}?`)) return
    try { await api(`/files/${f.id}`, { method: 'DELETE' }); reload() } catch (e: any) { toast(e.message) }
  }
  return (
    <div>
      <div className="card-head"><span className="muted small">Commercial invoice, BL, entry, release order…</span><button className="btn sm" onClick={onAdd}><Icon name="upload" size={14} />Upload</button></div>
      {s.files.length ? s.files.map((f: any) => (
        <div className="file-row" key={f.id}>
          <div className="file-ico">{f.originalName.split('.').pop()?.toUpperCase().slice(0, 4)}</div>
          <div className="grow"><strong title={f.originalName}>{f.originalName}</strong><span className="small muted">{FILE_TYPES[f.type]} · {bytes(f.size)} · {f.uploadedBy?.name || '-'} · {date(f.createdAt)}</span></div>
          <button className="btn sm ghost" onClick={() => openFile(`/files/${f.id}/download?inline=1`).catch((x) => toast(x.message))}><Icon name="eye" size={14} /></button>
          <button className="btn sm secondary" onClick={() => download(`/files/${f.id}/download`, f.originalName).catch((x) => toast(x.message))}><Icon name="download" size={14} />Download</button>
          {(isFinance || f.uploadedById === meId) && <button className="btn sm ghost" onClick={() => del(f)} aria-label="Delete"><Icon name="trash" size={14} /></button>}
        </div>
      )) : <Empty>No documents uploaded.</Empty>}
    </div>
  )
}

function Timeline({ s, reload }: { s: any; reload: () => void }) {
  const [text, setText] = useState('')
  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    await api(`/shipments/${s.id}/notes`, { body: { text } })
    setText('')
    reload()
  }
  return (
    <div>
      <form onSubmit={add} className="pad" style={{ display: 'flex', gap: 8, paddingBottom: 4 }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note, e.g. 'Truck at Malaba yard, waiting for scanning'" />
        <button className="btn">Add</button>
      </form>
      <ul className="timeline">
        {s.events.map((ev: any) => (
          <li key={ev.id} className={'k-' + ev.kind.toLowerCase()}>
            <span className="mark" />
            <div>{ev.text}<div className="meta">{dateTime(ev.createdAt)} · {ev.user?.name || 'system'}</div></div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StatusModal({ s, onClose, onDone }: { s: any; onClose: () => void; onDone: () => void }) {
  const { me, isFinance } = useAuth()
  const idx = STATUSES.indexOf(s.status)
  const [status, setStatus] = useState(STATUSES[idx + 1])
  const [note, setNote] = useState('')
  const [notify, setNotify] = useState(me!.company.autoStatusMessages && !!s.client.phone)
  const [err, setErr] = useState<string | null>(null)
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const r = await api(`/shipments/${s.id}/status`, { body: { status, note, notify } })
      toast(r.message ? (r.message.status === 'SENT' ? `Client notified by ${r.message.channel}` : `Message failed: ${r.message.error}`) : 'Status updated')
      onDone()
    } catch (x: any) { setErr(x.message) }
  }
  return (
    <Modal title="Update status" onClose={onClose}>
      <form onSubmit={save}>
        <ErrorBox error={err} />
        <Field label="New status">
          <select value={status} onChange={(e) => setStatus(e.target.value as any)}>
            {STATUSES.filter((x) => x !== s.status && (x !== 'CLOSED' || isFinance)).map((x) => <option key={x} value={x}>{STATUS_LABEL[x]}</option>)}
          </select>
        </Field>
        <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Assessment received, taxes to pay" /></Field>
        {status !== 'CLOSED' && <label className="check"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} disabled={!s.client.phone} /> Send the client a {s.client.channel === 'WHATSAPP' ? 'WhatsApp' : 'SMS'} update {!s.client.phone && '(no phone on file)'}</label>}
        <div className="modal-actions"><button type="button" className="btn secondary" onClick={onClose}>Cancel</button><button className="btn">Update</button></div>
      </form>
    </Modal>
  )
}

function UploadModal({ s, onClose, onDone }: { s: any; onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState('COMMERCIAL_INVOICE')
  const [file, setFile] = useState<File | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) return setErr('Choose a file')
    setBusy(true)
    const fd = new FormData()
    fd.set('type', type)
    fd.set('file', file)
    try { await api(`/shipments/${s.id}/files`, { form: fd }); toast('Uploaded'); onDone() } catch (x: any) { setErr(x.message) } finally { setBusy(false) }
  }
  return (
    <Modal title={`Upload a document to ${s.ref}`} onClose={onClose}>
      <form onSubmit={save}>
        <ErrorBox error={err} />
        <Field label="Document type"><select value={type} onChange={(e) => setType(e.target.value)}>{Object.entries(FILE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <label className="dropzone">
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.csv" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <Icon name="upload" size={22} />
          {file ? <strong>{file.name} · {bytes(file.size)}</strong> : <><strong>Choose a file</strong>PDF, image, Word or Excel, up to 10 MB</>}
        </label>
        <div className="modal-actions mt"><button type="button" className="btn secondary" onClick={onClose}>Cancel</button><button className="btn" disabled={busy}>{busy ? 'Uploading…' : 'Upload'}</button></div>
      </form>
    </Modal>
  )
}

function MessageModal({ s, onClose, onDone }: { s: any; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState(`Dear {client}, update on {ref}: `)
  const [channel, setChannel] = useState(s.client.channel || 'SMS')
  const [err, setErr] = useState<string | null>(null)
  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const m = await api(`/shipments/${s.id}/message`, { body: { text, channel } })
      toast(m.status === 'SENT' ? 'Message sent' : `Failed: ${m.error}`)
      onDone()
    } catch (x: any) { setErr(x.message) }
  }
  return (
    <Modal title={`Message ${s.client.name}`} onClose={onClose}>
      <form onSubmit={send}>
        <ErrorBox error={err} />
        {!s.client.phone && <div className="alert warn">This client has no phone number yet.</div>}
        <Field label="Send by"><select value={channel} onChange={(e) => setChannel(e.target.value)}><option value="SMS">SMS</option><option value="WHATSAPP">WhatsApp</option></select></Field>
        <Field label="Message" hint="{client}, {ref} and {company} are filled in for you"><textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={918} /></Field>
        <div className="modal-actions"><button type="button" className="btn secondary" onClick={onClose}>Cancel</button><button className="btn" disabled={!s.client.phone}>Send</button></div>
      </form>
    </Modal>
  )
}
