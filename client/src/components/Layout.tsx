import { useState } from 'react'
import { NavLink, Outlet } from 'react-router'
import { useAuth } from '../auth'
import { useApi } from '../hooks'
import { Toaster, Logo } from './ui'
import Icon from './Icon'
import { ROLE_LABEL } from '../format'

type Item = { to: string; label: string; icon: string; who: 'all' | 'finance' | 'admin'; count?: number }

export default function Layout() {
  const { me, logout, isFinance, isAdmin } = useAuth()
  const [open, setOpen] = useState(false)
  const { data: dash } = useApi<any>('/dashboard')
  const pending = dash?.expenses?.pendingCount || 0
  const groups: [string, Item[]][] = [
    ['Operations', [
      { to: '/', label: 'Dashboard', icon: 'dashboard', who: 'all' },
      { to: '/shipments', label: isFinance ? 'Shipments' : 'My shipments', icon: 'truck', who: 'all' },
      { to: '/expenses', label: isFinance ? 'Expenses' : 'My expenses', icon: 'wallet', who: 'all', count: isFinance ? pending : 0 },
      { to: '/packing-lists', label: 'Packing lists', icon: 'box', who: 'all' },
    ]],
    ['Billing', [
      { to: '/clients', label: 'Clients', icon: 'clients', who: 'finance' },
      { to: '/billing', label: 'Quotes & invoices', icon: 'invoice', who: 'finance' },
      { to: '/reports', label: 'Reports', icon: 'chart', who: 'finance' },
    ]],
    ['Office', [
      { to: '/messages', label: 'Messages', icon: 'messages', who: 'all' },
      { to: '/staff', label: 'Staff', icon: 'staff', who: 'admin' },
      { to: '/settings', label: 'Settings', icon: 'settings', who: 'all' },
    ]],
  ]
  const allowed = (i: Item) => i.who === 'all' || (i.who === 'finance' && isFinance) || (i.who === 'admin' && isAdmin)

  return (
    <div className="shell">
      <aside className={'sidebar' + (open ? ' open' : '')}>
        <div className="brand"><Logo dark /></div>
        <div className="company-chip">
          {me!.company.name}
          <small>{me!.company.country} · {me!.company.currency} · {me!.company.customsAuthority}</small>
        </div>
        <nav>
          {groups.map(([g, items]) => {
            const vis = items.filter(allowed)
            if (!vis.length) return null
            return (
              <div key={g}>
                <div className="nav-group">{g}</div>
                {vis.map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.to === '/'} onClick={() => setOpen(false)}>
                    <Icon name={n.icon} />
                    {n.label}
                    {!!n.count && <span className="count">{n.count}</span>}
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>
        <div className="sidebar-foot">
          <div className="who">
            <strong>{me!.name}</strong>
            <span>{ROLE_LABEL[me!.role]}</span>
          </div>
          <button className="btn ghost sm" onClick={logout}>Sign out</button>
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <div className="main">
        <header className="topbar">
          <button className="icon-btn" onClick={() => setOpen(true)} aria-label="Open menu"><Icon name="menu" size={22} /></button>
          <Logo dark />
          <span className="right" />
        </header>
        <main className="content">
          <Outlet />
        </main>
        <footer className="app-foot"><img src="/brand/brukline-c-icon.svg" alt="" /> Brukline · {me!.company.name}</footer>
      </div>
      <Toaster />
    </div>
  )
}
