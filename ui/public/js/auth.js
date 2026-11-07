// YubiKey login + sign-off in the browser. Library served locally from node_modules.
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from '/vendor/simplewebauthn/index.js'
import { api, esc, toast, auth } from './util.js'
import { flaggedFields } from './planform.js'

let status = { registered: false, user: null }

export async function refreshAuth () {
  status = await api('/api/auth/status')
  auth.user = status.user
  const who = document.getElementById('who')
  who.innerHTML = status.user
    ? `<span>Signed in: <strong>${esc(status.user.name)}</strong></span><button class="btn small" id="logout">Sign out</button>`
    : '<a class="btn small" href="#/login" style="color:var(--primary);border-bottom:2px solid var(--primary)">Sign in with YubiKey</a>'
  who.querySelector('#logout')?.addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' })
    await refreshAuth()
    toast('Signed out')
    location.hash = '#/'
  })
  return status
}

const tapError = (e) => {
  if (e?.name === 'NotAllowedError') return 'The key was not tapped in time, or the request was cancelled. Please try again.'
  if (e?.name === 'InvalidStateError') return 'This YubiKey is already registered.'
  return e?.message || 'Something went wrong with the key'
}

async function login () {
  const options = await api('/api/auth/login/options', { method: 'POST' })
  const response = await startAuthentication({ optionsJSON: options })
  await api('/api/auth/login/verify', { method: 'POST', body: response })
  await refreshAuth()
}

async function register (name) {
  const options = await api('/api/auth/register/options', { method: 'POST', body: { name } })
  const response = await startRegistration({ optionsJSON: options })
  await api('/api/auth/register/verify', { method: 'POST', body: response })
  await refreshAuth()
}

// ---------- modal ----------
function modal (html) {
  const dlg = document.createElement('dialog')
  dlg.className = 'modal'
  dlg.innerHTML = html
  document.body.appendChild(dlg)
  dlg.addEventListener('close', () => dlg.remove())
  dlg.showModal()
  return dlg
}

const KEY_HINT = '<p class="key-hint"><svg class="ic" aria-hidden="true"><use href="#i-key"/></svg> Plug your YubiKey into the USB-C port. When it blinks, touch the gold disc.</p>'

// Ask for a sign-in only when it's needed (edit / save / new visit).
auth.ensure = async (reason = 'continue') => {
  await refreshAuth() // never trust a stale "signed in" (local call, instant)
  if (auth.user) return true
  if (!status.registered) {
    toast('Register your YubiKey first', 'error')
    location.hash = '#/login'
    return false
  }
  return new Promise((resolve) => {
    const dlg = modal(`
      <h2>Sign in to ${esc(reason)}</h2>
      ${KEY_HINT}
      <p class="err notice red" hidden></p>
      <div class="actions"><button class="btn primary" data-go>Use my YubiKey</button><button class="btn" data-cancel>Cancel</button></div>`)
    let ok = false
    dlg.querySelector('[data-cancel]').onclick = () => dlg.close()
    dlg.addEventListener('close', () => resolve(ok))
    dlg.querySelector('[data-go]').onclick = async (e) => {
      e.target.disabled = true
      try {
        await login()
        ok = true
        toast(`Signed in as ${auth.user.name}`)
        dlg.close()
      } catch (err) {
        const p = dlg.querySelector('.err'); p.hidden = false; p.textContent = tapError(err)
        e.target.disabled = false
      }
    }
  })
}

// Sign-off: always a fresh tap, even if already signed in.
auth.signOff = async (childId, done) => {
  if (!(await auth.ensure('sign off this plan'))) return
  const { plan } = await api(`/api/plans/${encodeURIComponent(childId)}`)
  const flags = flaggedFields(plan)
  const name = [plan.first_name?.value, plan.surname?.value].filter(Boolean).join(' ') || childId
  const dlg = modal(`
    <h2>Sign off ${esc(name)}'s care plan</h2>
    ${flags.length ? `<div class="notice amber"><strong>${flags.length} field${flags.length === 1 ? ' is' : 's are'} still amber:</strong> ${flags.map((f) => esc(f.label)).join(', ')}. You can still sign off if you have checked them.</div>` : ''}
    <p>This records <strong>${esc(auth.user.name)}</strong> and today's date on the plan. It saves a new version; old versions are kept.</p>
    ${KEY_HINT}
    <p class="err notice red" hidden></p>
    <div class="actions"><button class="btn primary" data-go>Tap YubiKey to sign off</button><button class="btn" data-cancel>Cancel</button></div>`)
  dlg.querySelector('[data-cancel]').onclick = () => dlg.close()
  dlg.querySelector('[data-go]').onclick = async (e) => {
    e.target.disabled = true
    try {
      const id = encodeURIComponent(childId)
      const options = await api(`/api/plans/${id}/signoff/options`, { method: 'POST' })
      const response = options.noAuth ? {} : await startAuthentication({ optionsJSON: options })
      const r = await api(`/api/plans/${id}/signoff`, { method: 'POST', body: response })
      dlg.close()
      toast(`Signed off by ${r.approved_by}`)
      done?.()
    } catch (err) {
      const p = dlg.querySelector('.err'); p.hidden = false; p.textContent = tapError(err)
      e.target.disabled = false
    }
  }
}

// ---------- #/login ----------
export async function renderLogin (main) {
  await refreshAuth()
  const supported = browserSupportsWebAuthn()
  main.innerHTML = `
    <h1>${status.user ? 'Your YubiKey' : status.registered ? 'Sign in' : 'Set up your YubiKey'}</h1>
    ${!supported ? '<div class="notice red">This browser cannot use security keys. Please use Chrome or Edge.</div>' : ''}
    ${location.hostname !== 'localhost' ? '<div class="notice red">Open this app at <strong>http://localhost:3000</strong> for the YubiKey to work.</div>' : ''}
    <section class="panel" style="max-width:640px">
      ${status.user
        ? `<p>You are signed in as <strong>${esc(status.user.name)}</strong>. Only you can edit and sign off plans on this PC.</p>
           <h2>Add a spare key</h2>
           <p class="muted">Register a second YubiKey in case one is lost.</p>
           <div class="actions"><button class="btn" id="add">Register another key</button></div>`
        : status.registered
          ? `${KEY_HINT}<div class="actions"><button class="btn primary" id="login">Sign in with YubiKey</button></div>`
          : `<p>No key is registered on this PC yet. Register yours once; after that, only your key can edit and sign off care plans.</p>
             <div class="form-row"><label for="name">Your name (shown on signed-off plans)</label>
               <input id="name" class="input" type="text" autocomplete="name" placeholder="e.g. Sarah Khan"></div>
             ${KEY_HINT}
             <div class="actions"><button class="btn primary" id="reg">Register my YubiKey</button></div>`}
      <p class="err notice red" hidden></p>
    </section>`

  const err = (e) => { const p = main.querySelector('.err'); p.hidden = false; p.textContent = tapError(e) }
  main.querySelector('#login')?.addEventListener('click', async (e) => {
    e.target.disabled = true
    try { await login(); toast(`Signed in as ${auth.user.name}`); location.hash = '#/' } catch (x) { err(x); e.target.disabled = false }
  })
  main.querySelector('#reg')?.addEventListener('click', async (e) => {
    const name = main.querySelector('#name').value.trim()
    if (!name) { main.querySelector('#name').focus(); return toast('Please enter your name', 'error') }
    e.target.disabled = true
    try { await register(name); toast('YubiKey registered. You are signed in.'); location.hash = '#/' } catch (x) { err(x); e.target.disabled = false }
  })
  main.querySelector('#add')?.addEventListener('click', async (e) => {
    e.target.disabled = true
    try { await register(status.user.name); toast('Spare key registered'); e.target.disabled = false } catch (x) { err(x); e.target.disabled = false }
  })
}
