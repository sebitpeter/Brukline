import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { api } from '../api'
import { useAuth } from '../auth'
import { useApi } from '../hooks'
import { Empty, ErrorBox, Field, Loading, Modal, Pill, toast } from '../components/ui'
import { date, money } from '../format'

export default function Clients() {
  const [q, setQ] = useState('')
  const [sp, setSp] = useSearchParams()
  const { data, error, loading, reload } = useApi<any[]>(`/clients?q=${encodeURIComponent(q)}`)
  const [edit, setEdit] = useState<any | null>(null)
  const openId = sp.get('open')
  return (
    <>
      <div className="page-head">
        <div><h1>Clients</h1><p className="muted">Importers and exporters you clear for.</p></div>
        <div className="actions"><button className="btn" onClick={() => setEdit({})}>Add client</button></div>
      </div>
      <div className="filters"><input type="search" placeholder="Search name, TIN or phone…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <ErrorBox error={error} />
      <div className="card">
        {loading && !data ? <Loading /> : !data?.length ? <Empty>No clients yet.</Empty> : (
          <table className="table responsive">
            <thead><tr><th>Client</th><th>Contact</th><th>Tax ID</th><th className="num">Shipments</th><th className="num">Balance owed</th></tr></thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="click" onClick={() => setSp({ open: c.id })}>
                  <td data-label="Client"><strong>{c.name}</strong><span className="sub">{c.kind.toLowerCase()} · {c.address}</span></td>
                  <td data-label="Contact">{c.contactPerson}<span className="sub">{c.phone} {c.channel === 'WHATSAPP' && <Pill status="WHATSAPP" label="WhatsApp" />}</span></td>
                  <td data-label="Tax ID" className="mono">{c.taxId || '-'}</td>
                  <td data-label="Shipments" className="num">{c.shipments}</td>
                  <td data-label="Balance" className={'num ' + (c.balance > 0 ? 'bad-text' : '')}>{money(c.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {edit && <ClientForm client={edit.id ? edit : null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload() }} />}
      {openId && <ClientDrawer id={openId} onClose={() => setSp({})} onEdit={(c) => { setSp({}); setEdit(c) }} />}
    </>
  )
}

function ClientDrawer({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (c: any) => void }) {
  const { data: c } = useApi<any>(`/clients/${id}`)
  const nav = useNavigate()
  return (
    <Modal title={c?.name || 'Client'} onClose={onClose} wide>
      {!c ? <Loading /> : (
        <>
          <dl className="kv">
            <dt>Contact</dt><dd>{c.contactPerson || '-'} · {c.phone || 'no phone'} · {c.email || 'no email'}</dd>
            <dt>Address</dt><dd>{c.address || '-'}</dd>
            <dt>Tax ID</dt><dd>{c.taxId || '-'}</dd>
            <dt>Messages by</dt><dd>{c.channel === 'WHATSAPP' ? 'WhatsApp' : 'SMS'}</dd>
          </dl>
          <h3 className="mt">Shipments</h3>
          {c.shipments.length ? <table className="table"><tbody>{c.shipments.slice(0, 8).map((s: any) => <tr key={s.id} className="click" onClick={() => nav(`/shipments/${s.id}`)}><td><strong>{s.ref}</strong><span className="sub">{s.goods}</span></td><td><Pill status={s.status} /></td><td className="num small muted">{date(s.createdAt)}</td></tr>)}</tbody></table> : <p className="muted">None yet.</p>}
          <h3 className="mt">Quotations & invoices</h3>
          {c.salesDocs.length ? <table className="table"><tbody>{c.salesDocs.slice(0, 10).map((d: any) => <tr key={d.id} className="click" onClick={() => nav(`/docs/${d.id}`)}><td><strong>{d.number}</strong><span className="sub">{date(d.issueDate)}</span></td><td><Pill status={d.state || d.status} /></td><td className="num">{money(d.total, d.currency)}{d.balance > 0 && <span className="sub">balance {money(d.balance, d.currency)}</span>}</td></tr>)}</tbody></table> : <p className="muted">None yet.</p>}
          <div className="modal-actions mt">
            <Link className="btn secondary" to={`/docs/new?type=QUOTATION&clientId=${c.id}`}>New quotation</Link>
            <button className="btn" onClick={() => onEdit(c)}>Edit client</button>
          </div>
        </>
      )}
    </Modal>
  )
}

export function ClientForm({ client, onClose, onSaved }: { client: any | null; onClose: () => void; onSaved: (c: any) => void }) {
  const { me } = useAuth()
  const [f, setF] = useState<any>({ name: '', kind: 'IMPORTER', taxId: '', contactPerson: '', phone: '', email: '', address: '', channel: 'SMS', notes: '' })
  useEffect(() => { if (client) setF({ ...f, ...Object.fromEntries(Object.entries(client).filter(([k]) => k in f).map(([k, v]) => [k, v ?? ''])) }) }, [client])
  const [err, setErr] = useState<string | null>(null)
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value })
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const body = { ...f, phone: f.phone || null }
      const c = client ? await api(`/clients/${client.id}`, { method: 'PATCH', body }) : await api('/clients', { body })
      toast('Client saved')
      onSaved(c)
    } catch (x: any) { setErr(x.message) }
  }
  return (
    <Modal title={client ? 'Edit client' : 'Add client'} onClose={onClose}>
      <form onSubmit={save}>
        <ErrorBox error={err} />
        <Field label="Company / name"><input value={f.name} onChange={set('name')} required /></Field>
        <div className="grid2">
          <Field label="Type"><select value={f.kind} onChange={set('kind')}><option value="IMPORTER">Importer</option><option value="EXPORTER">Exporter</option><option value="BOTH">Both</option></select></Field>
          <Field label={me!.company.taxIdLabel}><input value={f.taxId} onChange={set('taxId')} /></Field>
          <Field label="Contact person"><input value={f.contactPerson} onChange={set('contactPerson')} /></Field>
          <Field label="Phone" hint={`Local numbers get +${me!.company.dialCode}`}><input value={f.phone} onChange={set('phone')} inputMode="tel" /></Field>
          <Field label="Email"><input type="email" value={f.email} onChange={set('email')} /></Field>
          <Field label="Send updates by"><select value={f.channel} onChange={set('channel')}><option value="SMS">SMS</option><option value="WHATSAPP">WhatsApp</option></select></Field>
        </div>
        <Field label="Address"><textarea rows={2} value={f.address} onChange={set('address')} /></Field>
        <div className="modal-actions"><button type="button" className="btn secondary" onClick={onClose}>Cancel</button><button className="btn">Save</button></div>
      </form>
    </Modal>
  )
}
