import { Navigate, Route, Routes } from 'react-router'
import { useAuth } from './auth'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Shipments from './pages/Shipments'
import ShipmentDetail from './pages/ShipmentDetail'
import Clients from './pages/Clients'
import Billing from './pages/Billing'
import DocEditor from './pages/DocEditor'
import DocView from './pages/DocView'
import Expenses from './pages/Expenses'
import PackingLists from './pages/PackingLists'
import PackingEditor from './pages/PackingEditor'
import Reports from './pages/Reports'
import Messages from './pages/Messages'
import Staff from './pages/Staff'
import Settings from './pages/Settings'

export default function App() {
  const { me, loading, isFinance, isAdmin } = useAuth()
  if (loading) return <div className="center-screen muted">Loading…</div>
  if (!me) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    )
  }
  const fin = (el: React.ReactNode) => (isFinance ? el : <Navigate to="/" replace />)
  const adm = (el: React.ReactNode) => (isAdmin ? el : <Navigate to="/" replace />)
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="shipments" element={<Shipments />} />
        <Route path="shipments/:id" element={<ShipmentDetail />} />
        <Route path="expenses" element={<Expenses />} />
        <Route path="packing-lists" element={<PackingLists />} />
        <Route path="packing-lists/new" element={<PackingEditor />} />
        <Route path="packing-lists/:id" element={<PackingEditor />} />
        <Route path="clients" element={fin(<Clients />)} />
        <Route path="billing" element={fin(<Billing />)} />
        <Route path="docs/new" element={fin(<DocEditor />)} />
        <Route path="docs/:id" element={fin(<DocView />)} />
        <Route path="docs/:id/edit" element={fin(<DocEditor />)} />
        <Route path="reports" element={fin(<Reports />)} />
        <Route path="messages" element={<Messages />} />
        <Route path="staff" element={adm(<Staff />)} />
        <Route path="settings" element={<Settings />} />
        <Route path="login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<div className="card pad">Page not found.</div>} />
      </Route>
    </Routes>
  )
}
