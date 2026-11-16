import { useState } from 'react'
import { Link } from 'react-router'
import { api } from '../api'
import { useAuth } from '../auth'
import { useApi } from '../hooks'
import { Empty, ErrorBox, Field, Loading, Modal, Pill, toast } from '../components/ui'
import Icon from '../components/Icon'
import { dateTime } from '../format'

const KINDS: Record<string, string> = { STATUS: 'Status update', INVOICE: 'Invoice', QUOTATION: 'Quotation', RECEIPT: 'Receipt', CUSTOM: 'Message' }

export default function Messages() {
  const { isFinance } = useAuth()
  const [kind, setKind] = useState('')
  const { data, error, loading, reload } = useApi<any>(`/messages?kind=${kind}`)
  const [compose, setCompose] = useState(false)
  return (
    <>
      <div className="page-head">
        <div><h1>Messages</h1><p className="muted">{isFinance ? 'Every SMS and WhatsApp sent to clients.' : 'Messages you sent to clients.'}{data && <> Sending through: SMS <strong>{data.providers.SMS}</strong>, WhatsApp <strong>{data.providers.WHATSAPP}</strong>{data.providers.SMS === 'console' && ' (test mode: logged, not delivered)'}.</>}</p></div>
        {isFinance && <div className="actions"><button className="btn" onClick={() => setCompose(true)}><Icon name="send" size={15} />Message clients</button></div>}
      </div>
      <div className="filters">
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type"><option value="">All types</option>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </div>
      <ErrorBox error={error} />
      <div className="card">
        {loading && !data ? <Loading /> : !data?.messages.length ? <Empty>No messages yet.</Empty> : (
          <table className="table responsive">
            <thead><tr><th>When</th><th>To</th><th>Message</th><th>About</th><th>Status</th></tr></thead>
            <tbody>{data.messages.map((m: any) => (
              <tr key={m.id}>
                <td data-label="When" className="nowrap small">{dateTime(m.createdAt)}<span className="sub">{m.sentBy?.name}</span></td>
                <td data-label="To">{m.client?.name || '-'}<span className="sub mono">{m.to}</span> <Pill status={m.channel} label={m.channel === 'WHATSAPP' ? 'WhatsApp' : 'SMS'} /></td>
                <td data-label="Message"><div className="bubble">{m.body}</div><span className="sub">{KINDS[m.kind]} · {m.segments} SMS part{m.segments > 1 ? 's' : ''} · {m.provider}</span></td>
                <td data-label="About">{m.shipment && <Link to={`/shipments/${m.shipment.id}`}>{m.shipment.ref}</Link>}{m.doc && <span className="sub"><Link to={`/docs/${m.doc.id}`}>{m.doc.number}</Link></span>}</td>
                <td data-label="Status"><Pill status={m.status} />{m.error && <span className="sub bad-text">{m.error}</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {compose && <Compose onClose={() => setCompose(false)} onDone={() => { setCompose(false); reload() }} />}
    </>
  )
}

function Compose({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { data: clients } = useApi<any[]>('/clients')
  const [ids, setIds] = useState<string[]>([])
  const [text, setText] = useState('Dear {client}, ')
  const [channel, setChannel] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [preview, setPreview] = useState<any[] | null>(null)
  const doPreview = async () => {
    try { const r = await api('/messages', { body: { clientIds: ids.slice(0, 3), text, preview: true } }); setPreview(r.items); setErr(null) } catch (x: any) { setErr(x.message) }
  }
  const send = async () => {
    try {
      const r = await api('/messages', { body: { clientIds: ids, text, channel: channel || undefined } })
      toast(`Sent ${r.sent} of ${r.total}${r.failed ? `, ${r.failed} failed` : ''}`)
      onDone()
    } catch (x: any) { setErr(x.message) }
  }
  return (
    <Modal title="Message clients" onClose={onClose} wide>
      <ErrorBox error={err} />
      <div className="cols-2">
        <div>
          <div className="field"><span>Clients ({ids.length} chosen)</span></div>
          <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 10px' }}>
            <label className="check"><input type="checkbox" checked={!!clients && ids.length === clients.length} onChange={(e) => setIds(e.target.checked ? clients!.map((c) => c.id) : [])} /> <strong>Everyone</strong></label>
            {clients?.map((c) => <label key={c.id} className="check"><input type="checkbox" checked={ids.includes(c.id)} onChange={(e) => setIds(e.target.checked ? [...ids, c.id] : ids.filter((x) => x !== c.id))} disabled={!c.phone} /> {c.name} <span className="muted small">{c.phone || 'no phone'}</span></label>)}
          </div>
        </div>
        <div>
          <Field label="Send by"><select value={channel} onChange={(e) => setChannel(e.target.value)}><option value="">Each client's choice</option><option value="SMS">SMS</option><option value="WHATSAPP">WhatsApp</option></select></Field>
          <Field label="Message" hint="{client} and {company} are filled in"><textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} maxLength={918} /></Field>
          <div className="small muted">{text.length} characters</div>
          {preview && <div className="mt">{preview.map((p) => <div key={p.name} style={{ marginBottom: 8 }}><div className="small muted">{p.name} · {p.to || 'no phone'} · {p.segments} SMS part{p.segments > 1 ? 's' : ''}</div><div className="bubble">{p.body}</div></div>)}</div>}
        </div>
      </div>
      <div className="modal-actions mt"><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn secondary" onClick={doPreview} disabled={!ids.length}>Preview</button><button className="btn" onClick={send} disabled={!ids.length}>Send to {ids.length}</button></div>
    </Modal>
  )
}
