import { useCallback, useEffect, useState } from 'react'
import { api } from './api'

/** Load JSON from the API; returns data, error, loading and a reload function. */
export function useApi<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!!path)
  const load = useCallback(async () => {
    if (!path) return
    setLoading(true)
    try {
      setData(await api<T>(path))
      setError(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [path])
  useEffect(() => {
    load()
  }, [load])
  return { data, error, loading, reload: load, setData }
}
