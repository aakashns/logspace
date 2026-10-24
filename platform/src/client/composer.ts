// <logspace-composer>, the composer's behavior in the browser (see views/admin/compose.tsx), as a
// Rocket component (https://data-star.dev/reference/rocket). Its markup is the server's: Rocket
// scopes the `$$signals` and `@actions()` in it to this element, so they're declared here, and
// the markup binds to them with Datastar attributes (see views/admin/composer-controls.tsx).
//
// The composer posts its form as you write, and the server sends back HTML for parts of the page
// (see composerPatch in http/admin/composer.tsx): media is uploaded as it's chosen, which
// re-renders the media and the toolbar, and the preview is re-rendered as you type. The form's own
// action publishes. While media is uploading or the post is posting, the preview waits, since a
// preview posts the whole form, chosen files and all. Each tab also follows the draft as other
// tabs change it, with a stream of the whole composer from the server.
//
// Rocket applies Datastar to the whole component again after every patch, so the markup has no
// data-init or data-indicator, which would run again or reset: what happens once, as the server's
// HTML arrives, is in onPatched below, and what's in flight is counted here.
import { actions, rocket, type ActionContext } from 'datastar'

// The `composer` line of each of the server's patches: which post it's for, and the draft's
// version it shows (see ComposerUpdate in http/admin/composer.tsx).
interface ComposerUpdate {
  id?: string
  kind: 'stream' | Kind
  version?: { epoch: string; revision: number }
  by?: string
  fields?: Record<string, string>
  previousId?: string
  previousState?: 'active' | 'published' | 'retired'
}

type Kind = 'preview' | 'media' | 'publish'

// Mutations need an explicit retry: a lost response may already have committed the write.
// Datastar 1.0.4 also needs retryMaxCount: 0 to stop transport-error retries.
const FORM_REQUEST = { contentType: 'form', retry: 'never', retryMaxCount: 0 }

// Datastar's events (https://data-star.dev/reference/actions#fetch), from the bundle's types.
type FetchEvent = CustomEvent<{ type: string; el: Element; argsRaw: Record<string, string> }>
const isFetchEvent = (event: Event): event is FetchEvent =>
  event instanceof CustomEvent && event.type === 'datastar-fetch'

// The browser's UTC offset, like "+05:30", which the post is dated with.
function browserOffset() {
  let minutes = -new Date().getTimezoneOffset()
  let abs = Math.abs(minutes)
  let pad = (n: number) => String(n).padStart(2, '0')
  return `${minutes < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

rocket('logspace-composer', {
  mode: 'light',
  props: ({ string }) => ({ updatesUrl: string, mediaUrl: string, previewUrl: string }),
  setup({ $$, host, props, action, actions: hostActions, cleanup }) {
    // What the markup shows: requests in flight, and which of them failed. `uploads` counts media
    // requests, which can overlap.
    $$.uploads = 0
    $$.uploading = () => $$.uploads > 0
    $$.posting = false
    // Keeps Post disabled while the browser goes to the post.
    $$.published = false
    $$.previewError = false
    $$.mediaError = false
    $$.publishError = false
    // Whether the city's input is shown.
    $$.city = false

    // What only this code needs. `draft` is the id of the draft this tab last knew was saved,
    // and `requests` the post each element's last request was for, and what it was.
    let draft = ''
    let needsPreview = false
    let mediaRetry: HTMLElement | undefined
    let requests = new WeakMap<Element, { kind: Kind; id: string }>()
    // The newest version of the draft this tab has shown, and the server runs (epochs) it's seen.
    let epoch = ''
    let revision = -1
    let epochs = new Set<string>()
    let reconnecting = false
    let resetComposer = false
    let keepFields = false
    let imageRetries = new WeakMap<HTMLImageElement, string>()

    let form = () => host.querySelector('form')
    let field = (name: string) => {
      let element = form()?.elements.namedItem(name)
      return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? element
        : undefined
    }
    let postId = () => field('post_id')?.value ?? ''
    let savedDraft = () => {
      let id = field('post_id')
      return id && 'saved' in id.dataset ? id.value : ''
    }

    // Posts the form with Datastar from `el`, which its events name (see onFetch).
    let send = (el: HTMLElement, url: string, kind: Kind, evt?: Event) => {
      requests.set(el, { kind, id: postId() })
      let context: ActionContext = {
        el,
        error: (name) => new Error(name),
        cleanups: new Map(),
        ...(evt && { evt }),
      }
      return Promise.resolve(actions.post?.(context, url, FORM_REQUEST)).catch(() => {})
    }

    let preview = (el: HTMLElement) => {
      needsPreview = true
      if ($$.uploading || $$.posting) return
      needsPreview = false
      void send(el, props.previewUrl, 'preview')
    }

    let updateMedia = (el: HTMLElement) => {
      mediaRetry = el
      $$.uploads += 1
      void send(el, props.mediaUrl, 'media').finally(() => ($$.uploads -= 1))
    }

    let publish = (el: HTMLFormElement, evt: Event | undefined) => {
      if ($$.uploading || $$.posting || $$.published) return
      let id = postId()
      $$.posting = true
      needsPreview = false
      void send(el, el.getAttribute('action') ?? '', 'publish', evt).finally(() => {
        $$.posting = false
        // What was typed while posting, unless the composer moved on to another post.
        let caption = field('caption')
        if (needsPreview && !$$.published && postId() === id && caption) preview(caption)
      })
    }

    action('preview', ({ el }) => el instanceof HTMLElement && preview(el))
    action('updateMedia', ({ el }) => el instanceof HTMLElement && updateMedia(el))
    action('publish', ({ el, evt }) => el instanceof HTMLFormElement && publish(el, evt))
    action('retryMedia', () => mediaRetry?.isConnected && updateMedia(mediaRetry))
    // Hiding the city clears it, and the preview follows.
    action('toggleCity', ({ el }) => {
      let input = field('city')
      if (!input || !(el instanceof HTMLElement)) return
      $$.city = !$$.city
      if ($$.city) requestAnimationFrame(() => input.focus())
      else {
        input.value = ''
        preview(el)
      }
    })

    // Only a reconnect retries broken images, once per element and source: ordinary updates
    // mustn't keep requesting a missing article image. Sources are removed first for WebKit, then
    // their attributes restored as they were, so the next morph doesn't reload them because a
    // relative src became an absolute URL. A preview that failed is sent again.
    let recover = () => {
      if (reconnecting) {
        for (let img of host.querySelectorAll('img')) {
          let source = img.src + img.srcset
          if (!img.complete || img.naturalWidth || imageRetries.get(img) === source) continue
          imageRetries.set(img, source)
          let src = img.getAttribute('src')
          let srcset = img.getAttribute('srcset')
          img.removeAttribute('srcset')
          img.removeAttribute('src')
          if (srcset !== null) img.setAttribute('srcset', srcset)
          if (src !== null) img.setAttribute('src', src)
        }
      }
      reconnecting = false
      let caption = field('caption')
      if ($$.previewError && !$$.posting && !$$.uploading && caption) preview(caption)
    }

    // Before Datastar applies a patch: a stream snapshot can have been rendered before a save
    // whose response has already arrived, and every response belongs to one post, so none of its
    // patches (redirects included) may be applied to another. Our own lost save may also be newer
    // than the last acknowledgment but older than local typing: then the defaults advance before
    // the snapshot is morphed in, and the typed values stay for the retry.
    let beforePatch = (event: Event) => {
      if (!isFetchEvent(event) || event.detail.type !== 'datastar-patch-elements') return
      let raw = event.detail.argsRaw.composer
      if (!raw) return
      let update: ComposerUpdate = JSON.parse(raw)
      let id = postId()
      let stream = update.kind === 'stream'
      let { version } = update
      let stale =
        version &&
        ((epochs.has(version.epoch) && epoch !== version.epoch) ||
          (epoch === version.epoch &&
            (stream ? version.revision <= revision : version.revision < revision)))
      if ((!stream && (update.id || requests.get(event.detail.el)?.id) !== id) || stale) {
        event.stopImmediatePropagation()
        if (stream) recover()
        return
      }
      if (version) {
        epochs.add(version.epoch)
        epoch = version.epoch
        revision = version.revision
      }
      if (!stream) {
        $$.previewError = false
        if (update.kind !== 'preview') $$.mediaError = false
        if (update.kind === 'publish') $$.publishError = false
        return
      }
      resetComposer =
        (draft !== '' && draft !== update.id) ||
        (update.previousId === id &&
          (update.previousState === 'published' || update.previousState === 'retired'))
      keepFields =
        !resetComposer &&
        $$.previewError &&
        update.id === id &&
        update.by === (field('tab')?.value ?? '')
      if (keepFields) {
        for (let [name, value] of Object.entries(update.fields ?? {})) {
          let input = field(name)
          if (!input) continue
          let local = input.value
          input.defaultValue = value
          input.value = local
        }
      }
    }

    // After Datastar applies a patch, or as a request starts, fails, or reconnects.
    let onFetch = (event: Event) => {
      if (!isFetchEvent(event)) return
      let { type, el, argsRaw } = event.detail
      let request = requests.get(el)
      if (request?.id === postId() && (type === 'error' || type === 'retries-failed')) {
        if (request.kind === 'preview') $$.previewError = true
        else if (request.kind === 'media') $$.mediaError = true
        else $$.publishError = true
      }
      if (el === host && type === 'retrying') reconnecting = true
      if (type !== 'datastar-patch-elements' || !argsRaw.composer) return
      // Rocket scopes what a morph brings in, but not what replaces an element.
      if (argsRaw.mode === 'replace') host.dispatchEvent(new CustomEvent('datastar-scope-children'))
      let target = argsRaw.selector ? document.querySelector(argsRaw.selector) : null
      if (el !== host) {
        // As data-init would, once the rest of the response's patches are in.
        if (target) queueMicrotask(() => onPatched(target))
        return
      }
      if (resetComposer) {
        form()?.reset()
        $$.previewError = $$.mediaError = $$.publishError = false
        needsPreview = false
        resetComposer = false
      }
      // Unless it kept what's typed here, the city shows as the server's composer does.
      if (!keepFields) $$.city = (field('city')?.value ?? '') !== ''
      draft = savedDraft()
      recover()
    }

    // What the server's HTML asks for (see ComposerIssues and DraftNote in compose.tsx).
    let onPatched = (target: Element) => {
      let redirect = target.querySelector<HTMLElement>('[data-redirect]')
      if (redirect) {
        $$.published = true
        location.assign(redirect.dataset.redirect ?? '')
      }
      // What was chosen was too big to send.
      if (target.querySelector('[data-clear-files]')) {
        for (let input of host.querySelectorAll<HTMLInputElement>('input[type=file]')) {
          input.value = ''
        }
      }
      // The media changed, so the preview catches up with what was typed meanwhile.
      let refresh = target.querySelector<HTMLElement>('[data-refresh]')
      if (refresh) {
        needsPreview = false
        void send(refresh, props.previewUrl, 'preview')
      }
      // A morph keeps what's typed in a field unless the server's value differs from the field's
      // default. Once the server has saved the draft, its values become the defaults: another
      // tab's change (or a discard) still replaces a field, but what's typed here and not saved
      // yet, as during an outage, stays.
      let saved = target.querySelector<HTMLElement>('[data-saved-values]')
      if (saved && saved.dataset.postId === postId()) {
        draft = postId()
        let values: Record<string, string> = JSON.parse(saved.dataset.savedValues ?? '{}')
        for (let [name, value] of Object.entries(values)) {
          let input = field(name)
          if (input instanceof HTMLTextAreaElement) input.defaultValue = value
          else input?.setAttribute('value', value)
        }
      }
    }

    // Datastar's own listener applies patches, so this one is a capture listener, which runs
    // first, and onFetch runs after it.
    document.addEventListener('datastar-fetch', beforePatch, { capture: true })
    document.addEventListener('datastar-fetch', onFetch)
    cleanup(() => {
      document.removeEventListener('datastar-fetch', beforePatch, { capture: true })
      document.removeEventListener('datastar-fetch', onFetch)
    })

    draft = savedDraft()
    $$.city = (field('city')?.value ?? '') !== ''
    let offset = field('offset')
    if (offset) offset.value = browserOffset()

    // The stream of the composer as the draft changes. A reconnect always sends the draft as it
    // is, with the post this tab shows, so it learns whether that post was published meanwhile.
    void Promise.resolve(
      hostActions.get?.(props.updatesUrl, {
        payload: {
          get _postId() {
            return postId()
          },
        },
        retry: 'always',
        retryMaxCount: Infinity,
        requestCancellation: 'cleanup',
      }),
    ).catch(() => {})
  },
})
