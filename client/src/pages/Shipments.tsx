import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useAuth } from '../auth'
import { useApi } from '../hooks'
import { Empty, ErrorBox, Loading, Pill } from '../components/ui'
import ShipmentForm from '../components/ShipmentForm'
import { STATUSES, STATUS_LABEL, ago } from '../format'

export default function Shipments() {
  const { isFinance } = useAuth()
  const [sp, setSp] = useSearchParams()
  const status = sp.get('status') || 'ACTIVE'
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(sp.get('new') === '1')
  const nav = useNavigate()
  const { data, error, loading } = useApi<any[]>(`/shipments?status=${status === 'ALL' ? '' : status}&q=${encodeURIComponent(q)}`)
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{isFinance ? 'Shipments' : 'My shipments'}</h1>
          <p className="muted">Consignments from documents received to delivery and close.</p>
        </div>
        {isFinance && <div className="actions"><button className="btn" onClick={() => setCreating(true)}>New shipment</button></div>}
      </div>
      <div className="filters">
        <input type="search" placeholder="Search ref, truck, container, BL, entry, client…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={status} onChange={(e) => setSp({ status: e.target.value })} aria-label="Status">
          <option value="ACTIVE">All active</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          <option value="ALL">Everything</option>
        </select>
      </div>
      <ErrorBox error={error} />
      <div className="card">
        {loading && !data ? <Loading /> : !data?.length ? <Empty>No shipments here.</Empty> : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>Shipment</th><th>Goods</th><th>Truck / container</th><th>Station</th><th>Agent</th><th>Status</th><th className="num">Updated</th></tr></thead>
              <tbody>
                {data.map((s) => (
                  <tr key={s.id} className="click" onClick={() => nav(`/shipments/${s.id}`)}>
                    <td data-label="Shipment"><strong>{s.ref}</strong><span className="sub">{s.client.name}</span></td>
                    <td data-label="Goods">{s.goods}<span className="sub">{s.direction.toLowerCase()} · {s.mode.toLowerCase()}{s.entryNumber ? ` · entry ${s.entryNumber}` : ''}</span></td>
                    <td data-label="Truck / container" className="mono">{s.truckRegs || '-'}<span className="sub">{s.containerNo || s.blAwb}</span></td>
                    <td data-label="Station">{s.station || '-'}</td>
                    <td data-label="Agent">{s.assignedTo?.name || <span className="muted">-</span>}</td>
                    <td data-label="Status"><Pill status={s.status} /></td>
                    <td data-label="Updated" className="num small muted">{ago(s.statusChangedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating && <ShipmentForm onClose={() => setCreating(false)} onSaved={(s) => nav(`/shipments/${s.id}`)} />}
    </>
  )
}
