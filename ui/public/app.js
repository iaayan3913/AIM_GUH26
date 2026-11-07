// FOBE Care Plans: tiny hash router. Everything is served from this PC.
import { esc, toast } from './js/util.js'
import { renderList } from './js/list.js'
import { renderPlanPage } from './js/plan.js'
import { renderPrint } from './js/print.js'
import { renderVisit, renderReview } from './js/visit.js'
import { renderLogin, refreshAuth } from './js/auth.js'

// WebAuthn rpID is 'localhost', so 127.0.0.1 would break the YubiKey.
if (location.hostname === '127.0.0.1') location.replace(location.href.replace('127.0.0.1', 'localhost'))

const main = document.getElementById('main')

const routes = [
  [/^login$/, renderLogin],
  [/^$/, renderList],
  [/^child\/([^/]+)$/, renderPlanPage],
  [/^child\/([^/]+)\/print$/, renderPrint],
  [/^visit$/, renderVisit],
  [/^visit\/([^/]+)$/, renderVisit],
  [/^review\/([^/]+)$/, renderReview]
]

async function route () {
  const path = location.hash.replace(/^#\/?/, '')
  for (const [re, fn] of routes) {
    const m = path.match(re)
    if (!m) continue
    document.querySelectorAll('.topbar nav a').forEach((a) => {
      a.toggleAttribute('aria-current', a.getAttribute('href') === '#/' + path.split('/')[0])
      if (a.hasAttribute('aria-current')) a.setAttribute('aria-current', 'page')
    })
    main.innerHTML = '<p class="loading">Loading…</p>'
    try {
      await fn(main, ...m.slice(1).map(decodeURIComponent))
    } catch (e) {
      console.error(e)
      main.innerHTML = `<div class="notice red"><strong>Something went wrong.</strong> ${esc(e.message)}</div><p><a class="btn" href="#/">Back to children</a></p>`
    }
    main.focus({ preventScroll: true })
    window.scrollTo(0, 0)
    return
  }
  main.innerHTML = '<h1>Page not found</h1><p><a class="btn" href="#/">Back to children</a></p>'
}

window.addEventListener('hashchange', route)
window.addEventListener('unhandledrejection', (e) => toast(e.reason?.message || 'Something went wrong', 'error'))
refreshAuth().catch(() => {}).finally(route)
