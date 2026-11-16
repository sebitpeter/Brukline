import { Link, useNavigate } from 'react-router'
import { download } from '../api'
import { useApi } from '../hooks'
import { Empty, ErrorBox, Loading, toast } from '../components/ui'
import Icon from '../components/Icon'
import { date } from '../format'

const n = (v: number | null, d = 2) => (v == null ? '-' : v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }))

export default function PackingLists() {
  const { data, error, loading } = useApi<any[]>('/packing-lists')
  const nav = useNavigate()
  return (
    <>
      <div className="page-head">
        <div><h1>Packing lists</h1><p className="muted">Generated packing lists with totals, ready to print or send with the entry.</p></div>
        <div className="actions"><Link className="btn" to="/packing-lists/new">New packing list</Link></div>
      </div>
      <ErrorBox error={error} />
      <div className="card">
        {loading && !data ? <Loading /> : !data?.length ? <Empty>No packing lists yet. Open a shipment and create one from there.</Empty> : (
          <table className="table responsive">
            <thead><tr><th>Number</th><th>Client</th><th>Shipment</th><th>Date</th><th className="num">Packages</th><th className="num">Gross kg</th><th className="num">CBM</th><th></th></tr></thead>
            <tbody>{data.map((p) => (
              <tr key={p.id} className="click" onClick={() => nav(`/packing-lists/${p.id}`)}>
                <td data-label="Number"><strong>{p.number}</strong></td>
                <td data-label="Client">{p.client.name}</td>
                <td data-label="Shipment">{p.shipment?.ref || '-'}</td>
                <td data-label="Date">{date(p.date)}</td>
                <td data-label="Packages" className="num">{p.totals.packages}</td>
                <td data-label="Gross kg" className="num">{n(p.totals.grossKg)}</td>
                <td data-label="CBM" className="num">{n(p.totals.cbm, 3)}</td>
                <td className="num"><button className="btn sm secondary" onClick={(e) => { e.stopPropagation(); download(`/packing-lists/${p.id}/pdf?download=1`, `${p.number}.pdf`).catch((x) => toast(x.message)) }}><Icon name="download" size={14} />PDF</button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  )
}
