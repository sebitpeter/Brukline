import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { openFile } from '../api'
import { useAuth } from '../auth'
import { useApi } from '../hooks'
import { Empty, ErrorBox, Loading, Pill, Stat, toast } from '../components/ui'
import Icon from '../components/Icon'
import ExpenseForm from '../components/ExpenseForm'
import ReviewButtons from '../components/ReviewButtons'
import { METHODS, date, money } from '../format'

export default function Expenses() {
  const { isFinance } = useAuth()
  const [sp, setSp] = useSearchParams()
  const status = sp.get('status') || (isFinance ? 'PENDING' : '')
  const userId = sp.get('userId') || ''
  const [adding, setAdding] = useState(sp.get('new') === '1')
  const { data, error, loading, reload } = useApi<any[]>(`/expenses?status=${status}&userId=${userId}`)
  const { data: staff } = useApi<any[]>(isFinance ? '/staff/options' : null)
  const total = data?.reduce((a, e) => a + e.amount, 0) || 0
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); n.delete('new'); if (v) n.set(k, v); else n.delete(k); if (k === 'status' && !v) n.set('status', ''); setSp(n) }
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{isFinance ? 'Expenses' : 'My expenses'}</h1>
          <p className="muted">{isFinance ? 'What staff spent on each truck and shipment. Approve, then bill disbursements to the client.' : 'Everything you paid for on your shipments.'}</p>
        </div>
        <div className="actions"><button className="btn" onClick={() => setAdding(true)}><Icon name="plus" size={15} />Log an expense</button></div>
      </div>
      <div className="filters">
        <select value={status} onChange={(e) => set('status', e.target.value)} aria-label="Status">
          <option value="">All statuses</option><option value="PENDING">Waiting for approval</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option>
        </select>
        {isFinance && <select value={userId} onChange={(e) => set('userId', e.target.value)} aria-label="Staff"><option value="">All staff</option>{staff?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>}
        <span className="spacer" />
        {data && <span className="muted small">{data.length} entries · <strong>{money(total)}</strong></span>}
      </div>
      <ErrorBox error={error} />
      {!isFinance && data && (
        <div className="stats">
          <Stat label="Waiting for approval" value={money(data.filter((e) => e.status === 'PENDING').reduce((a, e) => a + e.amount, 0))} tone="warn" />
          <Stat label="Approved" value={money(data.filter((e) => e.status === 'APPROVED').reduce((a, e) => a + e.amount, 0))} tone="good" />
        </div>
      )}
      <div className="card">
        {loading && !data ? <Loading /> : !data?.length ? <Empty>No expenses here.</Empty> : (
          <div className="table-wrap">
            <table className="table responsive">
              <thead><tr><th>Date</th><th>Shipment</th><th>What</th>{isFinance && <th>By</th>}<th className="num">Amount</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {data.map((e) => (
                  <tr key={e.id}>
                    <td data-label="Date" className="nowrap">{date(e.spentOn)}</td>
                    <td data-label="Shipment"><Link to={`/shipments/${e.shipment.id}`}><strong>{e.shipment.ref}</strong></Link><span className="sub mono">{e.shipment.truckRegs?.split(',')[0]}</span></td>
                    <td data-label="What"><strong>{e.categoryLabel}</strong><span className="sub">{e.description} · {METHODS[e.method]}{e.reference ? ` ${e.reference}` : ''}</span>{e.reviewNote && <span className="sub bad-text">“{e.reviewNote}”</span>}</td>
                    {isFinance && <td data-label="By">{e.spentBy.name}</td>}
                    <td data-label="Amount" className="num"><strong>{money(e.amount)}</strong>{!e.billable && <span className="sub">not billable</span>}</td>
                    <td data-label="Status"><Pill status={e.status} />{e.lineItem?.doc && <span className="sub"><Link to={`/docs/${e.lineItem.doc.id}`}>{e.lineItem.doc.number}</Link></span>}</td>
                    <td data-label="" className="num">
                      <span className="actions" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                        {e.receiptFile && <button className="btn sm ghost" onClick={() => openFile(`/expenses/${e.id}/receipt?inline=1`).catch((x) => toast(x.message))}><Icon name="file" size={14} />Receipt</button>}
                        <ReviewButtons e={e} onDone={reload} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {adding && <ExpenseForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); toast('Expense saved, waiting for approval'); reload() }} />}
    </>
  )
}
