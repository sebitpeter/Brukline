import { useState } from 'react'
import { Link } from 'react-router'
import { download, openFile } from '../api'
import { useAuth } from '../auth'
import { useApi } from '../hooks'
import { Empty, ErrorBox, Loading, Pill, Stat, toast } from '../components/ui'
import Icon from '../components/Icon'
import { compact, isoDay, money } from '../format'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export default function Reports() {
  const { me } = useAuth()
  const today = isoDay()
  const [kind, setKind] = useState<'MONTH' | 'YEAR' | 'RANGE'>('MONTH')
  const [year, setYear] = useState(Number(today.slice(0, 4)))
  const [month, setMonth] = useState(Number(today.slice(5, 7)))
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`)
  const [to, setTo] = useState(today)
  const qs = kind === 'RANGE' ? `kind=RANGE&from=${from}&to=${to}` : kind === 'YEAR' ? `kind=YEAR&year=${year}` : `kind=MONTH&year=${year}&month=${month}`
  const { data: r, error, loading } = useApi<any>(`/reports?${qs}`)
  const years = Array.from({ length: 5 }, (_, i) => Number(today.slice(0, 4)) - i)
  const tax = me!.company.taxName
  return (
    <>
      <div className="page-head">
        <div><h1>Reports</h1><p className="muted">{me!.company.name} · amounts in {me!.company.currency} · months follow {me!.company.timezone}</p></div>
        <div className="actions">
          <button className="btn secondary" onClick={() => download(`/reports/csv?${qs}`, `report-${r?.period.label || 'period'}.csv`).catch((x) => toast(x.message))}><Icon name="download" size={15} />Excel (CSV)</button>
          <button className="btn" onClick={() => openFile(`/reports/pdf?${qs}`).catch((x) => toast(x.message))}><Icon name="print" size={15} />PDF report</button>
        </div>
      </div>
      <div className="filters card pad" style={{ padding: 10 }}>
        <div className="tabs" style={{ margin: 0, border: 0 }}>
          {(['MONTH', 'YEAR', 'RANGE'] as const).map((k) => <button key={k} type="button" className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k === 'MONTH' ? 'Month' : k === 'YEAR' ? 'Year' : 'Custom range'}</button>)}
        </div>
        {kind !== 'RANGE' && <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">{years.map((y) => <option key={y}>{y}</option>)}</select>}
        {kind === 'MONTH' && <select value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Month">{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>}
        {kind === 'RANGE' && <><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 'auto' }} aria-label="From" /><span className="muted">to</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 'auto' }} aria-label="To" /></>}
        <span className="spacer" />
        {r && <strong>{r.period.label}</strong>}
      </div>
      <ErrorBox error={error} />
      {loading && !r ? <Loading /> : r && (
        <>
          <div className="stats">
            <Stat label="Invoiced" value={money(r.summary.invoiced)} sub={`${r.summary.invoiceCount} invoices · ${tax} ${money(r.summary.tax)}`} />
            <Stat label="Collected (receipts)" value={money(r.summary.collected)} sub={`${r.summary.receiptCount} receipts`} tone="good" />
            <Stat label="Approved expenses" value={money(r.summary.expenses)} sub={`${money(r.summary.wip)} not yet invoiced`} tone="warn" />
            <Stat label="Profit" value={<span className={r.summary.profit < 0 ? 'bad-text' : ''}>{money(r.summary.profit)}</span>} sub={r.summary.margin != null ? `${r.summary.margin}% of invoiced before tax` : 'no invoices'} tone={r.summary.profit < 0 ? 'bad' : 'good'} />
            <Stat label="Outstanding receivables" value={money(r.receivables.total)} sub={`${r.receivables.count} open invoices`} tone={r.receivables.total ? 'bad' : undefined} />
            <Stat label="Shipments opened" value={r.summary.shipments} />
          </div>

          {r.monthly.length > 1 && (
            <div className="card">
              <div className="card-head"><h2>Month by month</h2></div>
              <Chart rows={r.monthly} />
              <div className="legend"><span><i style={{ background: 'var(--navy)' }} />Invoiced</span><span><i style={{ background: 'var(--teal)' }} />Collected</span><span><i style={{ background: 'var(--amber)' }} />Expenses</span></div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Month</th><th className="num">Invoiced</th><th className="num">Collected</th><th className="num">Expenses</th><th className="num">Not yet invoiced</th><th className="num">Profit</th><th className="num">{tax}</th><th className="num">Shipments</th></tr></thead>
                  <tbody>{r.monthly.map((m: any) => (
                    <tr key={m.key}><td>{m.label} {m.key.slice(0, 4)}</td><td className="num">{money(m.invoiced)}</td><td className="num">{money(m.collected)}</td><td className="num">{money(m.expenses)}</td><td className="num muted">{money(m.wip)}</td><td className={'num ' + (m.profit < 0 ? 'bad-text' : '')}>{money(m.profit)}</td><td className="num">{money(m.tax)}</td><td className="num">{m.shipments}</td></tr>
                  ))}</tbody>
                  <tfoot><tr><td>Total</td><td className="num">{money(r.summary.invoiced)}</td><td className="num">{money(r.summary.collected)}</td><td className="num">{money(r.summary.expenses)}</td><td className="num">{money(r.summary.wip)}</td><td className="num">{money(r.summary.profit)}</td><td className="num">{money(r.summary.tax)}</td><td className="num">{r.summary.shipments}</td></tr></tfoot>
                </table>
              </div>
            </div>
          )}

          <div className="cols-2 mt">
            <div className="card">
              <div className="card-head"><h2>Expenses by category</h2></div>
              <Bars rows={r.expensesByCategory.map((x: any) => [x.label, x.amount, `${x.count}`])} />
            </div>
            <div className="card">
              <div className="card-head"><h2>Expenses by staff member</h2></div>
              <Bars rows={r.expensesByStaff.map((x: any) => [x.name, x.amount, `${x.count}`])} />
            </div>
            <div className="card">
              <div className="card-head"><h2>Receivables ageing</h2><span className="small muted">at period end</span></div>
              <Bars rows={r.receivables.buckets.map((x: any) => [x.label, x.amount, `${x.count}`])} tone="var(--bad)" />
            </div>
            <div className="card">
              <div className="card-head"><h2>Shipments handled</h2></div>
              <div className="pad" style={{ display: 'grid', gap: 12 }}>
                <div><div className="small muted">By status</div><div className="actions" style={{ marginTop: 4 }}>{r.shipments.byStatus.map((x: any) => <span key={x.key}><Pill status={x.key} /> {x.count}</span>)}</div></div>
                <div><div className="small muted">By station</div>{r.shipments.byStation.map((x: any) => <div key={x.key} className="small" style={{ display: 'flex', justifyContent: 'space-between' }}><span>{x.label}</span><strong>{x.count}</strong></div>)}</div>
              </div>
            </div>
          </div>

          <div className="card mt">
            <div className="card-head"><h2>Top clients</h2></div>
            {r.topClients.length ? (
              <table className="table responsive"><thead><tr><th>Client</th><th className="num">Shipments</th><th className="num">Invoiced</th><th className="num">Collected</th><th className="num">Outstanding</th></tr></thead>
                <tbody>{r.topClients.map((c: any) => <tr key={c.clientId}><td data-label="Client">{c.name}</td><td data-label="Shipments" className="num">{c.shipments}</td><td data-label="Invoiced" className="num">{money(c.invoiced)}</td><td data-label="Collected" className="num">{money(c.collected)}</td><td data-label="Outstanding" className={'num ' + (c.outstanding ? 'bad-text' : '')}>{money(c.outstanding)}</td></tr>)}</tbody></table>
            ) : <Empty>No client activity in this period.</Empty>}
          </div>

          <div className="card">
            <div className="card-head"><h2>Profit per shipment</h2><span className="small muted">invoiced before tax − billed and own costs</span></div>
            {r.profitPerShipment.length ? (
              <div className="table-wrap"><table className="table responsive"><thead><tr><th>Shipment</th><th>Client</th><th>Status</th><th className="num">Invoiced</th><th className="num">Costs</th><th className="num">Not yet invoiced</th><th className="num">Profit</th></tr></thead>
                <tbody>{r.profitPerShipment.map((x: any) => <tr key={x.shipmentId}><td data-label="Shipment"><Link to={`/shipments/${x.shipmentId}`}>{x.ref}</Link></td><td data-label="Client">{x.client}</td><td data-label="Status">{x.status && <Pill status={x.status} />}</td><td data-label="Invoiced" className="num">{money(x.invoiced)}</td><td data-label="Costs" className="num">{money(x.expenses)}</td><td data-label="Not invoiced" className="num muted">{money(x.wip)}</td><td data-label="Profit" className={'num ' + (x.profit < 0 ? 'bad-text' : 'good-text')}><strong>{money(x.profit)}</strong></td></tr>)}</tbody></table></div>
            ) : <Empty>No shipments with money movement in this period.</Empty>}
          </div>
          <p className="small muted">Invoiced = invoices issued in the period (void ones left out). Collected = receipts dated in the period. Expenses = approved staff expenses spent in the period; billable ones not yet on an invoice count as work in progress, not cost.</p>
        </>
      )}
    </>
  )
}

function Bars({ rows, tone = 'var(--teal)' }: { rows: [string, number, string][]; tone?: string }) {
  if (!rows.length) return <Empty>Nothing in this period.</Empty>
  const max = Math.max(1, ...rows.map((r) => r[1]))
  return (
    <div style={{ padding: '8px 0' }}>
      {rows.map(([l, v, c]) => (
        <div className="bar-row" key={l}>
          <div>{l} <span className="muted small">· {c}</span><div className="bar"><i style={{ width: `${(v / max) * 100}%`, background: tone }} /></div></div>
          <div className="num"><strong>{money(v)}</strong></div>
        </div>
      ))}
    </div>
  )
}

/** Plain SVG grouped bars: invoiced / collected / expenses per month. */
function Chart({ rows }: { rows: any[] }) {
  const W = 900, H = 230, P = { l: 52, r: 10, t: 12, b: 26 }
  const max = Math.max(1, ...rows.flatMap((r) => [r.invoiced, r.collected, r.expenses]))
  const step = (W - P.l - P.r) / rows.length
  const bw = Math.min(16, step / 4)
  const y = (v: number) => P.t + (H - P.t - P.b) * (1 - v / max)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max)
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Invoiced, collected and expenses by month">
      {ticks.map((t) => <g key={t}><line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="#eef1f3" /><text x={P.l - 6} y={y(t) + 4} textAnchor="end">{compact(t)}</text></g>)}
      {rows.map((r, i) => {
        const x0 = P.l + i * step + step / 2 - bw * 1.5
        return (
          <g key={r.key}>
            {([['invoiced', '#0E2A44'], ['collected', '#148A80'], ['expenses', '#e59a3b']] as const).map(([k, c], j) => (
              <rect key={k} x={x0 + j * bw} y={y(r[k])} width={bw - 2} height={Math.max(0, H - P.b - y(r[k]))} fill={c} rx="1.5"><title>{`${r.label}: ${k} ${money(r[k])}`}</title></rect>
            ))}
            <text x={P.l + i * step + step / 2} y={H - 8} textAnchor="middle">{r.label}</text>
          </g>
        )
      })}
    </svg>
  )
}
