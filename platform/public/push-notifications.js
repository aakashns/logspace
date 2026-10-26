// The home page's bell (see src/routes/index/page.tsx), which turns push notifications of new posts
// on and off. It's one of the few scripts that aren't Datastar, as subscribing takes the browser's
// own APIs, a step at a time: asking to show notifications, registering the service worker
// (push-worker.js), subscribing with the push service, then telling the site. Values come from the
// bell's data-* attributes.
//
// What the bell does depends on the browser:
// - Where push works, it turns notifications on and off, or if they're blocked, says how to allow
//   them. Loading the page checks this browser's subscription is still the site's.
// - On iPhone and iPad, push works only for sites added to the Home Screen, so until it's opened
//   from there, it shows how to add it.
// - Anywhere else, there's no bell.

const root = document.getElementById('push-notifications')
const bell = root?.querySelector('button')
const tooltip = root?.querySelector('[data-tooltip]')

// What the tooltip says in each state, which `data-state` on the root also shows (see page.css).
const LABELS = {
  off: 'Notify me of new posts',
  on: 'Turn off notifications',
  busy: 'One moment…',
  blocked: 'Notifications are blocked',
  install: 'Notify me of new posts',
}

// A refusal from the site, with its message, or that it couldn't be reached (status 0).
class SiteError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

// The bell's state, as `data-state` shows it: loading, off, on, busy, blocked, or install.
let state = 'loading'

if (root && bell && tooltip) start()

function start() {
  let supported =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  let appleMobile =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    // iPads say they're Macs, which have no touch screen.
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  let standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches
  if (supported) {
    bell.addEventListener('click', toggle)
    check()
  } else if (appleMobile && !standalone) {
    show('install')
    bell.addEventListener('click', () => openDialog('push-install'))
  } else {
    root.hidden = true
  }
}

// The bell stays focusable while it's busy (clicks are ignored then), so keyboard users keep their
// place; it says it's busy, and keeps saying whether it's pressed. It's a toggle while it's on or
// off, and otherwise opens a dialog.
function show(next) {
  state = next
  root.dataset.state = next
  bell.setAttribute('aria-busy', String(next === 'busy'))
  if (next === 'on' || next === 'off') {
    bell.setAttribute('aria-pressed', String(next === 'on'))
    bell.removeAttribute('aria-haspopup')
  } else if (next !== 'busy') {
    bell.removeAttribute('aria-pressed')
    bell.setAttribute('aria-haspopup', 'dialog')
  }
  tooltip.textContent = LABELS[next]
}

// Blocked notifications may have been allowed in the browser's settings since the page loaded.
function toggle() {
  if (state === 'on') turnOff()
  else if (state === 'off') turnOn()
  else if (state === 'blocked') {
    if (Notification.permission === 'denied') openDialog('push-blocked')
    else turnOn()
  }
}

// On loading, whether this browser is subscribed, which the site's told again, in case it
// forgot (its push service said the subscription was gone, or it took too many failures). A
// subscription made with a key the site no longer has is replaced, quietly, as permission's
// already given. Nothing's shown if this fails, as nothing was asked for: the bell's just off.
async function check() {
  try {
    let registration = await navigator.serviceWorker.getRegistration('/')
    let subscription = await registration?.pushManager.getSubscription()
    if (Notification.permission === 'denied') {
      if (subscription) await forget(subscription)
      return show('blocked')
    }
    if (!registration || !subscription) return show('off')
    if (!isSiteKey(subscription)) {
      await subscription.unsubscribe()
      if (Notification.permission !== 'granted') return show('off')
      subscription = await subscribe(registration)
    }
    await save(subscription)
    show('on')
  } catch (error) {
    console.error('Couldn’t check this browser’s push notifications', error)
    // The site refused it, so it can't be sent to: it's made again when the bell's clicked.
    if (error instanceof SiteError && error.status >= 400 && error.status < 500) {
      await unsubscribeQuietly()
    }
    show('off')
  }
}

// Asking first, while the click still counts as one (Safari asks only then), then subscribing.
async function turnOn() {
  show('busy')
  try {
    let permission = await Notification.requestPermission()
    if (permission === 'denied') {
      show('blocked')
      return openDialog('push-blocked')
    }
    // The prompt was dismissed.
    if (permission !== 'granted') return show('off')
    await navigator.serviceWorker.register(workerUrl(), { scope: '/', updateViaCache: 'none' })
    let registration = await navigator.serviceWorker.ready
    let subscription = await registration.pushManager.getSubscription()
    if (subscription && !isSiteKey(subscription)) {
      await subscription.unsubscribe()
      subscription = null
    }
    await save(subscription ?? (await subscribe(registration)))
    show('on')
  } catch (error) {
    console.error('Couldn’t turn on push notifications', error)
    await unsubscribeQuietly()
    show('off')
    fail('Couldn’t turn on notifications', error)
  }
}

// The site's told first, so if it can't be, notifications stay on, as it'd still send them.
async function turnOff() {
  show('busy')
  try {
    let registration = await navigator.serviceWorker.getRegistration('/')
    let subscription = await registration?.pushManager.getSubscription()
    if (subscription) await forget(subscription)
    show('off')
  } catch (error) {
    console.error('Couldn’t turn off push notifications', error)
    show('on')
    fail('Couldn’t turn off notifications', error)
  }
}

// Subscribing waits on the browser's push service, which may never answer (a browser that can't
// reach it, like Chromium without Google's keys), so it's given up on after a while.
const SUBSCRIBE_TIMEOUT_MS = 20_000

function subscribe(registration) {
  let subscribing = registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: fromBase64Url(bell.dataset.publicKey),
  })
  let timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('its push service didn’t answer')), SUBSCRIBE_TIMEOUT_MS)
  })
  return Promise.race([subscribing, timeout])
}

function save(subscription) {
  return post(bell.dataset.subscribeUrl, subscription.toJSON())
}

async function forget(subscription) {
  await post(bell.dataset.unsubscribeUrl, { endpoint: subscription.endpoint })
  await subscription.unsubscribe()
}

// After a failure, so the next try starts afresh.
async function unsubscribeQuietly() {
  try {
    let registration = await navigator.serviceWorker.getRegistration('/')
    let subscription = await registration?.pushManager.getSubscription()
    await subscription?.unsubscribe()
  } catch (error) {
    console.error('Couldn’t unsubscribe from push notifications', error)
  }
}

// The site answers a refusal with JSON, `{ message }`, saying why.
async function post(url, body) {
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new SiteError(0, 'Couldn’t reach the site. Check your connection, then try again.')
  }
  if (response.ok) return
  let answer = await response.json().catch(() => ({}))
  throw new SiteError(
    response.status,
    typeof answer.message === 'string'
      ? answer.message
      : `Something went wrong on the site (${response.status}). Try again in a while.`,
  )
}

// The service worker's URL, which, as pages require Trusted Types, is made by a policy that makes
// only this one. A policy can be made once, so it's kept.
let workerPolicy
function workerUrl() {
  let url = bell.dataset.worker
  if (!window.trustedTypes) return url
  workerPolicy ??= window.trustedTypes.createPolicy('push-notifications', {
    createScriptURL: (given) => {
      if (given !== url) throw new TypeError(`Not the service worker: ${given}`)
      return given
    },
  })
  return workerPolicy.createScriptURL(url)
}

// Whether the subscription is for the site's key, which changes if the site's secret does.
function isSiteKey(subscription) {
  let key = subscription.options.applicationServerKey
  if (!key) return false
  let given = new Uint8Array(key)
  let expected = fromBase64Url(bell.dataset.publicKey)
  return given.length === expected.length && given.every((byte, i) => byte === expected[i])
}

function fromBase64Url(text) {
  let binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function openDialog(id) {
  document.getElementById(id)?.showModal()
}

// Shows what went wrong in the error dialog: the site's reason, or the browser's.
function fail(title, error) {
  let message =
    error instanceof SiteError
      ? error.message
      : `Your browser couldn’t set up notifications${error?.message ? ` (${error.message})` : ''}. ` +
        'Private windows can’t get them in some browsers, so try a normal one. Some browsers, ' +
        'like Brave, need push messaging turned on in their settings first.'
  document.getElementById('push-error-title').textContent = title
  document.getElementById('push-error-description').textContent = message
  openDialog('push-error')
}
