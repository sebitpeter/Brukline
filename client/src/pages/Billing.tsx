import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { openFile } from '../api'
import { useApi } from '../hooks'
import { Empty, ErrorBox, Loading, Pill, Tabs, toast } from '../components/ui'
import Icon from '../components/Icon'
import { METHODS, date, money } from '../format'

type Tab = 'INVOICE' | 'QUOTATION' | 'RECEIPTS'

export default function Billing() {
  const [sp, setSp] = useSearchParams()
  const tab = (sp.get('tab') as Tab) || 'INVOICE'
  const state = sp.get('state') || ''
  const [q, setQ] = useState('')
  const nav = useNavigate()
  const docs = useApi<any[]>(tab === 'RECEIPTS' ? null : `/docs?type=${tab}&state=${state}&q=${encodeURIComponent(q)}`)
  const receipts = useApi<any[]>(tab === 'RECEIPTS' ? '/docs/payments/list' : null)
  return (
    <>
      <div className="page-head">
        <div><h1>Quotes & invoices</h1><p className="muted">Quotations, tax invoices and payment receipts.</p></div>
        <div className="actions">
          <Link className="btn secondary" to="/docs/new?type=QUOTATION">New quotation</Link>
          <Link className="btn" to="/docs/new?type=INVOICE">New invoice</Link>
        </div>
      </div>
      <Tabs<Tab> value={tab} onChange={(t) => setSp({ tab: t })} tabs={[['INVOICE', 'Invoices'], ['QUOTATION', 'Quotations'], ['RECEIPTS', 'Receipts']]} />
      {tab !== 'RECEIPTS' && (
        <div className="filters">
          <input type="search" placeholder="Search number, client or shipment…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={state} onChange={(e) => setSp({ tab, state: e.target.value })} aria-label="Filter">
            <option value="">All</option>
            {tab === 'INVOICE' ? <><option value="OPEN_BALANCE">With a balance</option><option value="OVERDUE">Overdue</option><option value="PAID">Paid</option><option value="VOID">Void</option></>
              : <><option value="OPEN">Open</option><option value="ACCEPTED">Accepted</option><option value="CONVERTED">Invoiced</option><option value="DECLINED">Declined</option></>}
          </select>
        </div>
      )}
      <ErrorBox error={docs.error || receipts.error} />
      <div className="card">
        {tab === 'RECEIPTS' ? (
          !receipts.data ? <Loading /> : !receipts.data.length ? <Empty>No receipts yet.</Empty> : (
            <table className="table responsive">
              <thead><tr><th>Receipt</th><th>Date</th><th>Client / invoice</th><th>Method</th><th className="num">Amount</th><th></th></tr></thead>
              <tbody>{receipts.data.map((p) => (
                <tr key={p.id}>
                  <td data-label="Receipt"><strong>{p.receiptNumber}</strong></td>
                  <td data-label="Date">{date(p.paidAt)}</td>
                  <td data-label="Client">{p.invoice.client.name}<span className="sub"><Link to={`/docs/${p.invoice.id}`}>{p.invoice.number}</Link></span></td>
                  <td data-label="Method">{METHODS[p.method]}<span className="sub mono">{p.reference}</span></td>
                  <td data-label="Amount" className="num">{money(p.amount, p.invoice.currency)}</td>
                  <td className="num"><button className="btn sm secondary" onClick={() => openFile(`/docs/payments/${p.id}/pdf`).catch((x) => toast(x.message))}><Icon name="print" size={14} />PDF</button></td>
                </tr>
              ))}</tbody>
            </table>
          )
        ) : docs.loading && !docs.data ? <Loading /> : !docs.data?.length ? <Empty>Nothing here.</Empty> : (
          <table className="table responsive">
            <thead><tr><th>Number</th><th>Client</th><th>Shipment</th><th>Date</th><th>{tab === 'INVOICE' ? 'Due' : 'Valid until'}</th><th className="num">Total</th>{tab === 'INVOICE' && <th className="num">Balance</th>}<th>Status</th></tr></thead>
            <tbody>{docs.data.map((d) => (
              <tr key={d.id} className="click" onClick={() => nav(`/docs/${d.id}`)}>
                <td data-label="Number"><strong>{d.number}</strong></td>
                <td data-label="Client">{d.client.name}</td>
                <td data-label="Shipment">{d.shipment?.ref || '-'}</td>
                <td data-label="Date">{date(d.issueDate)}</td>
                <td data-label="Due" className={d.overdue ? 'bad-text' : ''}>{date(d.dueDate)}</td>
                <td data-label="Total" className="num">{money(d.total, d.currency)}</td>
                {tab === 'INVOICE' && <td data-label="Balance" className="num">{d.balance > 0 ? money(d.balance, d.currency) : '-'}</td>}
                <td data-label="Status"><Pill status={d.overdue ? 'OVERDUE' : d.state || d.status} label={d.overdue ? 'Overdue' : undefined} /></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  )
}
