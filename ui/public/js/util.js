// Shared helpers for the UI.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export async function api (path, opts = {}) {
  const init = { ...opts, headers: { ...(opts.headers || {}) } }
  if (opts.body && !(opts.body instanceof FormData) && typeof opts.body !== 'string') {
    init.body = JSON.stringify(opts.body)
    init.headers['content-type'] = 'application/json'
  }
  const res = await fetch(path, init)
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { error: text } }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return data
}

let toastTimer
export function toast (msg, kind = '') {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.className = `toast show ${kind}`
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { el.className = 'toast' }, kind === 'error' ? 6000 : 3500)
}

// "2026-03-14" -> "14 Mar 2026"
export function fmtDate (d) {
  if (!d) return ''
  const date = new Date(d.length === 10 ? d + 'T12:00:00' : d)
  if (isNaN(date)) return String(d)
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function fmtDateTime (d) {
  if (!d) return ''
  const date = new Date(d)
  if (isNaN(date)) return String(d)
  return date.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function reviewBadge (c) {
  if (c.review_status === 'overdue') return `<span class="badge overdue">Review overdue by ${-c.review_days} day${c.review_days === -1 ? '' : 's'}</span>`
  if (c.review_status === 'soon') return `<span class="badge soon">Review due in ${c.review_days} day${c.review_days === 1 ? '' : 's'}</span>`
  if (c.review_status === 'ok') return `<span class="badge ok">Review ${esc(fmtDate(c.review_due))}</span>`
  return '<span class="badge grey">No review date</span>'
}

export const fullName = (p) => [p.first_name, p.surname].filter(Boolean).join(' ') || 'Unnamed child'
export const initials = (p) => ((p.first_name || '?')[0] + ((p.surname || '')[0] || '')).toUpperCase()
