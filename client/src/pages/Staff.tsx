import { useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { useApi } from '../hooks'
import { Empty, ErrorBox, Field, Loading, Modal, Pill, toast } from '../components/ui'
import Icon from '../components/Icon'
import { ROLE_LABEL, date } from '../format'

const ROLE_HELP: Record<string, string> = {
  ADMIN: 'Everything, including settings and staff',
  ACCOUNTANT: 'Clients, quotes, invoices, receipts, payments, approving expenses, reports',
  AGENT: 'Own shipments only: status, expenses, documents, packing lists. No company finance',
}

export default function Staff() {
  const { me } = useAuth()
  const { data, error, loading, reload } = useApi<any[]>('/staff')
  const [edit, setEdit] = useState<any | null>(null)
  const [secret, setSecret] = useState<{ name: string; email: string; password: string } | null>(null)
  const reset = async (u: any) => {
    if (!confirm(`Reset the password for ${u.name}? They will be signed out everywhere.`)) return
    try { const r = await api(`/staff/${u.id}/reset-password`, { body: {} }); setSecret({ name: u.name, email: u.email, password: r.tempPassword }) } catch (x: any) { toast(x.message) }
  }
  const toggle = async (u: any) => {
    if (u.active && !confirm(`Deactivate ${u.name}? They will no longer be able to sign in. Their records stay.`)) return
    try { await api(`/staff/${u.id}`, { method: 'PATCH', body: { active: !u.active } }); toast(u.active ? 'Deactivated' : 'Reactivated'); reload() } catch (x: any) { toast(x.message) }
  }
  return (
    <>
      <div className="page-head">
        <div><h1>Staff</h1><p className="muted">Register office and field staff and choose what each can see.</p></div>
        <div className="actions"><button className="btn" onClick={() => setEdit({})}><Icon name="staff" size={15} />Register staff</button></div>
      </div>
      <ErrorBox error={error} />
      <div className="card">
        {loading && !data ? <Loading /> : !data?.length ? <Empty>No staff.</Empty> : (
          <table className="table responsive">
            <thead><tr><th>Name</th><th>Role</th><th>Phone</th><th className="num">Shipments</th><th className="num">Expenses</th><th>Status</th><th></th></tr></thead>
            <tbody>{data.map((u) => (
              <tr key={u.id} style={u.active ? undefined : { opacity: 0.6 }}>
                <td data-label="Name"><strong>{u.name}</strong><span className="sub">{u.email}</span></td>
                <td data-label="Role">{ROLE_LABEL[u.role]}</td>
                <td data-label="Phone" className="mono">{u.phone || '-'}</td>
                <td data-label="Shipments" className="num">{u.shipments}</td>
                <td data-label="Expenses" className="num">{u.expenses}</td>
                <td data-label="Status">{u.active ? <Pill status="APPROVED" label="Active" /> : <Pill status="VOID" label="Deactivated" />}<span className="sub">since {date(u.createdAt)}</span></td>
                <td className="num"><span className="actions" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                  <button className="btn sm secondary" onClick={() => setEdit(u)}>Edit</button>
                  <button className="btn sm secondary" onClick={() => reset(u)} disabled={!u.active}>Reset password</button>
                  {u.id !== me!.id && <button className={'btn sm ' + (u.active ? 'danger' : 'secondary')} onClick={() => toggle(u)}>{u.active ? 'Deactivate' : 'Reactivate'}</button>}
                </span></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {edit && <StaffForm user={edit.id ? edit : null} onClose={() => setEdit(null)} onSaved={(r) => { setEdit(null); reload(); if (r.tempPassword) setSecret({ name: r.name, email: r.email, password: r.tempPassword }) }} />}
      {secret && (
        <Modal title="Temporary password" onClose={() => setSecret(null)}>
          <p>Give these sign-in details to <strong>{secret.name}</strong> in person or by phone. This password is shown only once.</p>
          <div className="notice"><div>Email: <strong>{secret.email}</strong></div><div>Password: <strong className="mono" style={{ fontSize: '1.1rem' }}>{secret.password}</strong></div></div>
          <p className="small muted">They can change it under Settings → My account after signing in.</p>
          <div className="modal-actions"><button className="btn" onClick={() => setSecret(null)}>Done</button></div>
        </Modal>
      )}
    </>
  )
}

function StaffForm({ user, onClose, onSaved }: { user: any | null; onClose: () => void; onSaved: (r: any) => void }) {
  const [f, setF] = useState({ name: user?.name || '', email: user?.email || '', phone: user?.phone || '', role: user?.role || 'AGENT', password: '' })
  const [err, setErr] = useState<string | null>(null)
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const body: any = { name: f.name, email: f.email, phone: f.phone || null, role: f.role }
      if (!user && f.password) body.password = f.password
      onSaved(user ? await api(`/staff/${user.id}`, { method: 'PATCH', body }) : await api('/staff', { body }))
      toast('Saved')
    } catch (x: any) { setErr(x.message) }
  }
  return (
    <Modal title={user ? `Edit ${user.name}` : 'Register staff'} onClose={onClose}>
      <form onSubmit={save}>
        <ErrorBox error={err} />
        <Field label="Full name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
        <div className="grid2">
          <Field label="Email (sign-in)"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
          <Field label="Phone"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" /></Field>
        </div>
        <div className="field"><span>Role</span></div>
        {(['AGENT', 'ACCOUNTANT', 'ADMIN'] as const).map((r) => (
          <label key={r} className="check" style={{ alignItems: 'flex-start' }}><input type="radio" name="role" checked={f.role === r} onChange={() => setF({ ...f, role: r })} style={{ width: 16, marginTop: 3 }} /> <span><strong>{ROLE_LABEL[r]}</strong><span className="sub small muted">{ROLE_HELP[r]}</span></span></label>
        ))}
        {!user && <Field label="Password (optional)" hint="Leave empty to generate a temporary password"><input type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} minLength={8} autoComplete="new-password" /></Field>}
        <div className="modal-actions"><button type="button" className="btn secondary" onClick={onClose}>Cancel</button><button className="btn">{user ? 'Save' : 'Register'}</button></div>
      </form>
    </Modal>
  )
}
