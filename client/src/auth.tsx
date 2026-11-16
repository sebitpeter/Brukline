import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, getToken, setToken } from './api'
import { setMoneyContext } from './format'

export type Role = 'ADMIN' | 'ACCOUNTANT' | 'AGENT'
export type Company = {
  id: string; name: string; tagline?: string; taxId?: string; address?: string; phone?: string; email?: string; website?: string; hasLogo: boolean
  country: string; dialCode: string; currency: string; decimals: number; secondaryCurrency?: string | null; secondaryDecimals?: number | null; fxRate?: number | null
  locale: string; timezone: string; taxName: string; taxRateBp: number; taxIdLabel: string; customsAuthority: string; stations: string; stationList: string[]
  bankDetails?: string; mobileMoney?: string; docFooter?: string; autoStatusMessages: boolean
}
export type Me = { id: string; name: string; email: string; phone?: string; role: Role; company: Company }

type Ctx = { me: Me | null; loading: boolean; login: (email: string, password: string) => Promise<void>; logout: () => void; refresh: () => Promise<void>; isFinance: boolean; isAdmin: boolean }
const AuthCtx = createContext<Ctx>(null!)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(!!getToken())

  const refresh = async () => {
    if (!getToken()) return setLoading(false)
    try {
      const m = await api<Me>('/auth/me')
      setMoneyContext(m.company)
      setMe(m)
    } catch {
      setToken(null)
      setMe(null)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    refresh()
  }, [])

  const login = async (email: string, password: string) => {
    const r = await api<{ token: string }>('/auth/login', { body: { email, password } })
    setToken(r.token)
    await refresh()
  }
  const logout = () => {
    setToken(null)
    setMe(null)
  }
  const isFinance = me?.role === 'ADMIN' || me?.role === 'ACCOUNTANT'
  return <AuthCtx.Provider value={{ me, loading, login, logout, refresh, isFinance, isAdmin: me?.role === 'ADMIN' }}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)
