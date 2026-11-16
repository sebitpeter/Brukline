const TOKEN_KEY = 'brukline_token'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (t: string | null) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY))

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let body: BodyInit | undefined
  if (opts.form) body = opts.form
  else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body)
    headers['Content-Type'] = 'application/json'
  }
  const res = await fetch(`/api${path}`, { method: opts.method || (body ? 'POST' : 'GET'), headers, body })
  if (res.status === 401 && token) {
    setToken(null)
    window.location.href = '/login'
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`)
  return data as T
}

async function fetchBlob(path: string) {
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${getToken()}` } })
  if (!res.ok) {
    const d = await res.json().catch(() => ({}))
    throw new ApiError(res.status, d.error || 'Download failed')
  }
  return res.blob()
}

/** Download a protected file (needs the auth header, so a plain <a href> will not do). */
export async function download(path: string, filename: string) {
  const url = URL.createObjectURL(await fetchBlob(path))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

/** Open a protected PDF/image in a new tab. */
export async function openFile(path: string) {
  const w = window.open('', '_blank')
  try {
    const url = URL.createObjectURL(await fetchBlob(path))
    if (w) w.location.href = url
    else window.location.href = url
  } catch (e) {
    w?.close()
    throw e
  }
}

export async function blobUrl(path: string) {
  return URL.createObjectURL(await fetchBlob(path))
}
