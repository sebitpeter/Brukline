import { useState } from 'react'
import { useAuth } from '../auth'
import { Logo } from '../components/ui'

// Demo logins show in dev, or in a build made with VITE_DEMO_HINT=true
const SHOW_DEMO = import.meta.env.DEV || import.meta.env.VITE_DEMO_HINT === 'true'
const DEMO = [
  ['admin@pearlclearing.demo', 'Admin'],
  ['accounts@pearlclearing.demo', 'Accountant'],
  ['agent@pearlclearing.demo', 'Field agent'],
  ['admin@bandariclearing.demo', 'Kenya company'],
]

export default function Login() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email.trim(), password)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-intro">
        <Logo dark />
        <div>
          <h1>Every truck, every entry, every shilling spent at the border.</h1>
          <p>Brukline runs a clearing and forwarding office: shipments from documents to delivery, quotations, invoices and receipts, field staff expenses with receipts, and updates to clients by SMS or WhatsApp.</p>
          <ul>
            <li>Track consignments through declaration, assessment, taxes and release</li>
            <li>Bill agency fees and disbursements, and see the profit on each job</li>
            <li>Field agents log what they spent on each truck from their phone</li>
            <li>Monthly and yearly reports in your own currency and tax</li>
          </ul>
        </div>
        <svg className="route" viewBox="0 0 400 200" fill="none" stroke="#148A80" strokeWidth="6" strokeLinecap="round"><path d="M10 160 H120 V60 H260 V140 H390" /><path d="M200 20 V45 M200 75 V100" /></svg>
        <small>Made for customs agents in East Africa and beyond.</small>
      </div>
      <div className="login-side">
        <form className="login-card" onSubmit={submit}>
          <Logo />
          <h2>Sign in</h2>
          <p className="muted">Use the staff account your office admin gave you.</p>
          {error && <div className="alert error">{error}</div>}
          <label className="field">
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
          <button className="btn block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          {SHOW_DEMO && <div className="demo-box">
            Demo accounts (password <code>Demo@2026</code>):
            <div style={{ display: 'grid', gap: 3, marginTop: 6 }}>
              {DEMO.map(([e, l]) => (
                <span key={e}><button type="button" onClick={() => { setEmail(e); setPassword('Demo@2026') }}>{e}</button> · {l}</span>
              ))}
            </div>
          </div>}
        </form>
      </div>
    </div>
  )
}
