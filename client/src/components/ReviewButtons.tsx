import { useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { toast } from './ui'
import Icon from './Icon'

export default function ReviewButtons({ e, onDone }: { e: any; onDone: () => void }) {
  const { me, isFinance } = useAuth()
  const [busy, setBusy] = useState(false)
  if (!isFinance || e.status !== 'PENDING') return null
  if (e.spentById === me!.id && me!.role !== 'ADMIN') return <span className="small muted">Needs another approver</span>
  const go = async (decision: string) => {
    let note: string | null = null
    if (decision === 'REJECTED') {
      note = window.prompt('Reason for rejecting?')
      if (!note) return
    }
    setBusy(true)
    try {
      await api(`/expenses/${e.id}/review`, { body: { decision, note } })
      toast(decision === 'APPROVED' ? 'Expense approved' : 'Expense rejected')
      onDone()
    } catch (err: any) {
      toast(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="actions" style={{ flexWrap: 'nowrap' }}>
      <button className="btn sm" disabled={busy} onClick={() => go('APPROVED')}><Icon name="check" size={14} />Approve</button>
      <button className="btn sm danger" disabled={busy} onClick={() => go('REJECTED')}>Reject</button>
    </span>
  )
}
