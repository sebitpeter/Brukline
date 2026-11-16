import { Link, useNavigate } from 'react-router'
import { useAuth } from '../auth'
import { useApi } from '../hooks'
import { ErrorBox, Loading, Pill, Stat, Empty } from '../components/ui'
import { STATUS_LABEL, ago, date, money } from '../format'

export default function Dashboard() {
  const { me, isFinance } = useAuth()
  const { data: d, error } = useApi<any>('/dashboard')
  const nav = useNavigate()
  if (error) return <ErrorBox error={error} />
  if (!d) return <Loading />
  const max = Math.max(1, ...d.shipments.byStatus.map((s: any) => s.count))
  const m = d.month
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, {me!.name.split(' ')[0]}</h1>
          <p className="muted">{isFinance ? `${me!.company.name} · ${typeof m === 'string' ? m : m.label}` : 'Your shipments and expenses'}</p>
        </div>
        <div className="actions">
          {isFinance && <Link className="btn secondary" to="/docs/new?type=INVOICE">New invoice</Link>}
          {isFinance ? <Link className="btn" to="/shipments?new=1">New shipment</Link> : <Link className="btn" to="/expenses?new=1">Log an expense</Link>}
        </div>
      </div>

      <div className="stats">
        <Stat label="Active shipments" value={d.shipments.active} sub={`${d.shipments.byStatus.find((s: any) => s.status === 'RELEASED')?.count || 0} released, awaiting delivery`} />
        {isFinance ? (
          <>
            <Stat label="Unpaid invoices" value={money(d.invoices.unpaidAmount)} sub={`${d.invoices.unpaidCount} invoices · ${d.invoices.overdueCount} overdue`} tone={d.invoices.overdueCount ? 'bad' : undefined} />
            <Stat label="Expenses to approve" value={d.expenses.pendingCount} sub={money(d.expenses.pendingAmount)} tone={d.expenses.pendingCount ? 'warn' : undefined} />
            <Stat label={`Profit, ${m.label}`} value={money(m.profit)} sub={`Invoiced ${money(m.invoiced)}`} tone="good" />
          </>
        ) : (
          <>
            <Stat label="My expenses waiting" value={d.expenses.pendingCount} sub={money(d.expenses.pendingAmount)} tone={d.expenses.pendingCount ? 'warn' : undefined} />
            <Stat label="Approved this month" value={money(d.expenses.monthApproved)} />
          </>
        )}
      </div>

      <div className="two-col">
        <div>
          <div className="card">
            <div className="card-head"><h2>Active shipments by status</h2><Link to="/shipments" className="small">All shipments</Link></div>
            <div style={{ padding: '8px 0' }}>
              {d.shipments.byStatus.map((s: any) => (
                <div className="bar-row" key={s.status} style={{ cursor: 'pointer' }} onClick={() => nav(`/shipments?status=${s.status}`)}>
                  <div>{STATUS_LABEL[s.status]}<div className="bar"><i style={{ width: `${(s.count / max) * 100}%` }} /></div></div>
                  <div className="num"><strong>{s.count}</strong></div>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h2>Latest movement</h2></div>
            {d.shipments.recent.length ? (
              <table className="table responsive">
                <tbody>
                  {d.shipments.recent.map((s: any) => (
                    <tr key={s.id} className="click" onClick={() => nav(`/shipments/${s.id}`)}>
                      <td data-label="Shipment"><strong>{s.ref}</strong><span className="sub">{s.client.name}</span></td>
                      <td data-label="Truck / container" className="mono">{s.truckRegs?.split(',')[0] || s.containerNo || s.blAwb}</td>
                      <td data-label="Status"><Pill status={s.status} /></td>
                      <td data-label="Updated" className="num muted small">{ago(s.statusChangedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <Empty>No active shipments.</Empty>}
          </div>
        </div>
        <div>
          {isFinance && (
            <>
              <div className="card">
                <div className="card-head"><h2>{m.label}: money in and out</h2><Link to="/reports" className="small">Reports</Link></div>
                <MonthBars m={m} />
              </div>
              <div className="card">
                <div className="card-head"><h2>Waiting for approval</h2><Link to="/expenses?status=PENDING" className="small">Review</Link></div>
                {d.pendingExpenses.length ? (
                  <table className="table"><tbody>
                    {d.pendingExpenses.map((e: any) => (
                      <tr key={e.id} className="click" onClick={() => nav('/expenses?status=PENDING')}>
                        <td>{e.description}<span className="sub">{e.spentBy.name} · {e.shipment.ref}</span></td>
                        <td className="num">{money(e.amount)}</td>
                      </tr>
                    ))}
                  </tbody></table>
                ) : <Empty>Nothing to approve.</Empty>}
              </div>
              <div className="card">
                <div className="card-head"><h2>Oldest unpaid invoices</h2><Link to="/billing?tab=INVOICE&state=OPEN_BALANCE" className="small">All</Link></div>
                {d.invoices.oldest.length ? (
                  <table className="table"><tbody>
                    {d.invoices.oldest.map((i: any) => (
                      <tr key={i.id} className="click" onClick={() => nav(`/docs/${i.id}`)}>
                        <td><strong>{i.number}</strong><span className="sub">{i.client}</span></td>
                        <td className="small">{i.overdue ? <span className="bad-text">Overdue · {date(i.dueDate)}</span> : <span className="muted">Due {date(i.dueDate)}</span>}</td>
                        <td className="num">{money(i.balance)}</td>
                      </tr>
                    ))}
                  </tbody></table>
                ) : <Empty>All invoices are paid.</Empty>}
              </div>
            </>
          )}
          {!isFinance && (
            <div className="card pad">
              <h2>At the border today?</h2>
              <p className="muted" style={{ marginTop: 0 }}>Log every payment as you make it, with a photo of the receipt. The office approves it and bills it to the client.</p>
              <Link className="btn block" to="/expenses?new=1">Log an expense</Link>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function MonthBars({ m }: { m: any }) {
  const rows = [['Invoiced', m.invoiced, 'var(--navy)'], ['Collected', m.collected, 'var(--teal)'], ['Expenses (approved)', m.expenses, 'var(--amber)']] as const
  const max = Math.max(1, ...rows.map((r) => r[1]))
  return (
    <div style={{ padding: '10px 0 6px' }}>
      {rows.map(([l, v, c]) => (
        <div className="bar-row" key={l}>
          <div>{l}<div className="bar" style={{ height: 10 }}><i style={{ width: `${(v / max) * 100}%`, background: c }} /></div></div>
          <div className="num"><strong>{money(v)}</strong></div>
        </div>
      ))}
      <div className="bar-row"><div className="muted small">Not yet invoiced (work in progress)</div><div className="num">{money(m.wip)}</div></div>
      <div className="bar-row"><div className="muted small">Profit: invoiced before tax minus billed and own costs</div><div className="num"><strong className={m.profit < 0 ? 'bad-text' : 'good-text'}>{money(m.profit)}</strong></div></div>
    </div>
  )
}
