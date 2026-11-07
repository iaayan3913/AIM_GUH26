// Files received from the work phone over Holepunch (peer-to-peer, no cloud).
import { api, esc, fmtDateTime, toast, auth } from './util.js'

const ICON = { audio: '🎙️', photo: '📷', text: '📝' }
const LABEL = { audio: 'Recording', photo: 'Photo of notes', text: 'Typed notes' }
const size = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`)

export async function renderInbox (main) {
  if (!(await auth.ensure('see files from the work phone'))) {
    main.innerHTML = '<h1>From work phone</h1><p>Please sign in with your YubiKey.</p>'
    return
  }
  main.innerHTML = `
    <h1>From work phone</h1>
    <p class="muted">Recordings and photos sent from the work phone arrive here directly, peer-to-peer. No email, WhatsApp or cloud.</p>
    <div id="p2p"></div>
    <section class="panel">
      <div class="list-head" style="margin-bottom:8px">
        <h2 style="margin:0">Received files</h2>
        <button class="btn primary" id="useSel" disabled>Create care plan from selected</button>
      </div>
      <div id="files"><p class="loading">Loading…</p></div>
    </section>`

  const selected = new Set()
  let lastSig = ''

  const draw = (d) => {
    main.querySelector('#p2p').innerHTML = !d.p2p
      ? `<div class="notice amber"><strong>Peer-to-peer is off.</strong> ${esc(d.error || '')}</div>`
      : `<div class="notice ${d.peers.length ? 'green' : ''}">
          ${d.peers.length
            ? `<strong>Connected:</strong> ${d.peers.map((p) => esc(p.name)).join(', ')}`
            : '<strong>Waiting for the work phone.</strong> It connects automatically when both are online.'}
          <div style="margin-top:6px">Pairing key for a new phone: <strong style="font-family:Consolas,monospace;font-size:1.2rem;letter-spacing:.05em">${esc(d.pairingKey)}</strong></div>
        </div>`

    const sig = JSON.stringify(d.files.map((f) => [f.name, f.usedFor]))
    if (sig === lastSig) return
    lastSig = sig
    const box = main.querySelector('#files')
    if (!d.files.length) { box.innerHTML = '<p class="muted">Nothing received yet.</p>'; return }
    box.innerHTML = `<table class="children">
      <thead><tr><th><span class="sr-only">Select</span></th><th>File</th><th>From</th><th>Received</th><th></th></tr></thead>
      <tbody>${d.files.map((f) => `
        <tr data-name="${esc(f.name)}" data-kind="${f.kind}">
          <td><input type="checkbox" aria-label="Select ${esc(f.name)}" style="width:24px;height:24px" ${selected.has(f.name) ? 'checked' : ''}></td>
          <td><span aria-hidden="true">${ICON[f.kind]}</span> <strong>${esc(f.name)}</strong><span class="id">${LABEL[f.kind]} · ${size(f.size)}</span>
            ${f.usedFor ? `<span class="badge ok">Used${typeof f.usedFor === 'string' ? ` for ${esc(f.usedFor)}` : ''}</span>` : '<span class="badge amber">New</span>'}</td>
          <td>${esc(f.from)}</td>
          <td>${esc(fmtDateTime(f.receivedAt))}</td>
          <td><button class="btn small" data-use>Create care plan</button></td>
        </tr>`).join('')}</tbody></table>`
    box.querySelectorAll('tbody tr').forEach((tr) => {
      tr.querySelector('input').addEventListener('change', (e) => {
        e.target.checked ? selected.add(tr.dataset.name) : selected.delete(tr.dataset.name)
        main.querySelector('#useSel').disabled = !selected.size
      })
      tr.querySelector('[data-use]').addEventListener('click', () => go([[tr.dataset.kind, tr.dataset.name]]))
    })
  }

  const go = (picks) => {
    const q = new URLSearchParams()
    for (const [kind, name] of picks) {
      if (q.has(kind)) return toast(`Pick only one ${LABEL[kind].toLowerCase()}`, 'error')
      q.set(kind, name)
    }
    location.hash = `#/visit?${q}`
  }
  main.querySelector('#useSel').addEventListener('click', () => {
    go([...main.querySelectorAll('tbody tr')].filter((tr) => selected.has(tr.dataset.name)).map((tr) => [tr.dataset.kind, tr.dataset.name]))
  })

  const refresh = async () => draw(await api('/api/inbox'))
  await refresh()
  // Live: new files from the phone appear without reloading.
  const filesEl = main.querySelector('#files')
  const timer = setInterval(() => {
    if (!document.body.contains(filesEl)) return clearInterval(timer)
    api('/api/inbox', { quiet: true }).then(draw).catch(() => {})
  }, 2000)
}
