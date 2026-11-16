import { useEffect, useState } from 'react'
import { api, blobUrl, setToken } from '../api'
import { useAuth } from '../auth'
import { ErrorBox, Field, Tabs, toast } from '../components/ui'
import { decimalsOf } from '../format'

const PRESETS: Record<string, any> = {
  UG: { country: 'UG', dialCode: '256', currency: 'UGX', locale: 'en-UG', timezone: 'Africa/Kampala', taxName: 'VAT', taxRateBp: 1800, taxIdLabel: 'TIN', customsAuthority: 'URA' },
  KE: { country: 'KE', dialCode: '254', currency: 'KES', locale: 'en-KE', timezone: 'Africa/Nairobi', taxName: 'VAT', taxRateBp: 1600, taxIdLabel: 'KRA PIN', customsAuthority: 'KRA' },
  TZ: { country: 'TZ', dialCode: '255', currency: 'TZS', locale: 'en-TZ', timezone: 'Africa/Dar_es_Salaam', taxName: 'VAT', taxRateBp: 1800, taxIdLabel: 'TIN', customsAuthority: 'TRA' },
  RW: { country: 'RW', dialCode: '250', currency: 'RWF', locale: 'en-RW', timezone: 'Africa/Kigali', taxName: 'VAT', taxRateBp: 1800, taxIdLabel: 'TIN', customsAuthority: 'RRA' },
  SS: { country: 'SS', dialCode: '211', currency: 'SSP', locale: 'en-SS', timezone: 'Africa/Juba', taxName: 'VAT', taxRateBp: 1800, taxIdLabel: 'TIN', customsAuthority: 'NRA' },
  ZA: { country: 'ZA', dialCode: '27', currency: 'ZAR', locale: 'en-ZA', timezone: 'Africa/Johannesburg', taxName: 'VAT', taxRateBp: 1500, taxIdLabel: 'VAT No.', customsAuthority: 'SARS' },
  NG: { country: 'NG', dialCode: '234', currency: 'NGN', locale: 'en-NG', timezone: 'Africa/Lagos', taxName: 'VAT', taxRateBp: 750, taxIdLabel: 'TIN', customsAuthority: 'NCS' },
}

export default function Settings() {
  const { isAdmin } = useAuth()
  const [tab, setTab] = useState<'company' | 'account'>(isAdmin ? 'company' : 'account')
  return (
    <>
      <div className="page-head"><div><h1>Settings</h1><p className="muted">{isAdmin ? 'Company details, country, money and tax, documents and messaging.' : 'Your account.'}</p></div></div>
      {isAdmin && <Tabs value={tab} onChange={setTab} tabs={[['company', 'Company'], ['account', 'My account']]} />}
      {tab === 'company' && isAdmin ? <CompanySettings /> : <Account />}
    </>
  )
}

function CompanySettings() {
  const { me, refresh } = useAuth()
  const c = me!.company
  const [f, setF] = useState<any>({ ...c, fxRate: c.fxRate ?? '', taxRate: String(c.taxRateBp / 100) })
  const [err, setErr] = useState<string | null>(null)
  const [logo, setLogo] = useState<string | null>(null)
  useEffect(() => { if (c.hasLogo) blobUrl('/company/logo').then(setLogo).catch(() => setLogo(null)); else setLogo(null) }, [c.hasLogo, c])
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    const keys = ['name', 'tagline', 'taxId', 'address', 'phone', 'email', 'website', 'country', 'dialCode', 'currency', 'secondaryCurrency', 'locale', 'timezone', 'taxName', 'taxIdLabel', 'customsAuthority', 'stations', 'bankDetails', 'mobileMoney', 'docFooter', 'autoStatusMessages']
    const body: any = Object.fromEntries(keys.map((k) => [k, f[k] ?? null]))
    body.currency = String(body.currency).toUpperCase()
    body.secondaryCurrency = body.secondaryCurrency ? String(body.secondaryCurrency).toUpperCase() : null
    body.country = String(body.country).toUpperCase()
    body.fxRate = f.fxRate === '' ? null : Number(f.fxRate)
    body.taxRateBp = Math.round(Number(f.taxRate) * 100)
    body.email = body.email || ''
    try { await api('/company', { method: 'PUT', body }); await refresh(); toast('Settings saved') } catch (x: any) { setErr(x.message); window.scrollTo(0, 0) }
  }
  const upload = async (file: File) => {
    const fd = new FormData()
    fd.set('logo', file)
    try { await api('/company/logo', { form: fd }); await refresh(); toast('Logo updated') } catch (x: any) { toast(x.message) }
  }
  const preset = (k: string) => setF({ ...f, ...PRESETS[k], taxRate: String(PRESETS[k].taxRateBp / 100) })
  const dec = (() => { try { return decimalsOf(String(f.currency).toUpperCase()) } catch { return 2 } })()
  return (
    <form onSubmit={save}>
      <ErrorBox error={err} />
      <div className="cols-2">
        <div className="card pad">
          <h2>Company</h2>
          <Field label="Company name"><input value={f.name} onChange={set('name')} required /></Field>
          <Field label="Tagline (on documents)"><input value={f.tagline || ''} onChange={set('tagline')} /></Field>
          <div className="grid2">
            <Field label={`${f.taxIdLabel} (your own)`}><input value={f.taxId || ''} onChange={set('taxId')} /></Field>
            <Field label="Phone"><input value={f.phone || ''} onChange={set('phone')} /></Field>
            <Field label="Email"><input type="email" value={f.email || ''} onChange={set('email')} /></Field>
            <Field label="Website"><input value={f.website || ''} onChange={set('website')} /></Field>
          </div>
          <Field label="Address"><textarea rows={3} value={f.address || ''} onChange={set('address')} /></Field>
          <div className="field"><span>Logo on quotations, invoices, receipts and packing lists</span></div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ width: 180, height: 64, border: '1px solid var(--line)', borderRadius: 6, display: 'grid', placeItems: 'center', background: '#fff' }}>
              {logo ? <img src={logo} alt="Company logo" style={{ maxWidth: 170, maxHeight: 56 }} /> : <span className="small muted">Brukline logo used</span>}
            </div>
            <label className="btn secondary sm">Upload PNG/JPG<input type="file" accept="image/png,image/jpeg" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label>
            {c.hasLogo && <button type="button" className="btn sm ghost" onClick={async () => { await api('/company/logo', { method: 'DELETE' }); await refresh() }}>Remove</button>}
          </div>
        </div>
        <div className="card pad">
          <h2>Country, money & tax</h2>
          <div className="field"><span>Quick presets</span></div>
          <div className="actions" style={{ marginBottom: 12 }}>{Object.keys(PRESETS).map((k) => <button type="button" key={k} className="btn sm secondary" onClick={() => preset(k)}>{k}</button>)}</div>
          <div className="grid3">
            <Field label="Country (ISO)"><input value={f.country} onChange={set('country')} maxLength={2} required /></Field>
            <Field label="Phone code" hint="Added to local numbers"><input value={f.dialCode} onChange={set('dialCode')} required /></Field>
            <Field label="Base currency" hint={`${dec} decimal${dec === 1 ? '' : 's'}`}><input value={f.currency} onChange={set('currency')} maxLength={3} required /></Field>
            <Field label="Second currency" hint="Optional, e.g. USD"><input value={f.secondaryCurrency || ''} onChange={set('secondaryCurrency')} maxLength={3} /></Field>
            <Field label={`1 ${f.secondaryCurrency || '…'} = ? ${f.currency}`}><input type="number" step="any" min="0" value={f.fxRate} onChange={set('fxRate')} disabled={!f.secondaryCurrency} /></Field>
            <Field label="Locale" hint="Number & date format"><input value={f.locale} onChange={set('locale')} required /></Field>
            <Field label="Timezone"><input value={f.timezone} onChange={set('timezone')} required /></Field>
            <Field label="Tax name"><input value={f.taxName} onChange={set('taxName')} required /></Field>
            <Field label="Default tax rate %"><input type="number" step="0.01" min="0" max="100" value={f.taxRate} onChange={set('taxRate')} required /></Field>
            <Field label="Tax ID label"><input value={f.taxIdLabel} onChange={set('taxIdLabel')} required /></Field>
            <Field label="Customs authority" className="span2"><input value={f.customsAuthority} onChange={set('customsAuthority')} required /></Field>
          </div>
          <p className="small muted" style={{ marginTop: 0 }}>Existing documents keep the currency, tax rate and exchange rate they were issued with.</p>
          <Field label="Customs stations, borders & ports" hint="One per line. Offered when you open a shipment; you can still type any other."><textarea rows={5} value={f.stations} onChange={set('stations')} /></Field>
        </div>
        <div className="card pad">
          <h2>Payment details on documents</h2>
          <Field label="Bank details"><textarea rows={4} value={f.bankDetails || ''} onChange={set('bankDetails')} /></Field>
          <Field label="Mobile money"><textarea rows={2} value={f.mobileMoney || ''} onChange={set('mobileMoney')} placeholder="e.g. MTN MoMo Pay 123456 · M-PESA Paybill 522533" /></Field>
          <Field label="Footer line"><input value={f.docFooter || ''} onChange={set('docFooter')} placeholder="e.g. Licensed customs agent no. …" /></Field>
        </div>
        <div className="card pad">
          <h2>Client messages</h2>
          <label className="check"><input type="checkbox" checked={!!f.autoStatusMessages} onChange={set('autoStatusMessages')} /> Text the client automatically when a shipment's status changes</label>
          <p className="small muted">SMS goes through Africa's Talking (Uganda, Kenya, Tanzania, Rwanda, Nigeria and more) and WhatsApp through Twilio or Meta. Keys live in <code>server/.env</code>; without them messages are only logged.</p>
        </div>
      </div>
      <div className="actions mt" style={{ justifyContent: 'flex-end' }}><button className="btn">Save settings</button></div>
    </form>
  )
}

function Account() {
  const { me } = useAuth()
  const [f, setF] = useState({ current: '', next: '', confirm: '' })
  const [err, setErr] = useState<string | null>(null)
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (f.next !== f.confirm) return setErr('The new passwords do not match')
    try { const r = await api('/auth/password', { body: { current: f.current, next: f.next } }); setToken(r.token); setF({ current: '', next: '', confirm: '' }); setErr(null); toast('Password changed') } catch (x: any) { setErr(x.message) }
  }
  return (
    <div className="card pad" style={{ maxWidth: 460 }}>
      <h2>{me!.name}</h2>
      <p className="muted" style={{ marginTop: -6 }}>{me!.email} · {me!.company.name}</p>
      <form onSubmit={save}>
        <ErrorBox error={err} />
        <Field label="Current password"><input type="password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} required autoComplete="current-password" /></Field>
        <Field label="New password" hint="At least 8 characters"><input type="password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} minLength={8} required autoComplete="new-password" /></Field>
        <Field label="Repeat new password"><input type="password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required autoComplete="new-password" /></Field>
        <button className="btn">Change password</button>
      </form>
    </div>
  )
}
