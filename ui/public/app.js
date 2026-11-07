const main = document.getElementById('main')

async function boot () {
  const r = await fetch('/api/status')
  const s = await r.json()
  main.innerHTML = `<h1>FOBE Care Plans</h1><p>Server running. AI: ${s.ai}. Database writable: ${s.db.writable}.</p>`
}
boot()
