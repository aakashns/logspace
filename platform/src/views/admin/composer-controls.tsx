// The composer's controls (see compose.tsx), run by Datastar like the ones in ../controls.tsx: its
// expressions are constant strings, and values they need are passed in data-* attributes.
//
// The composer's form posts to the server with Datastar as you write, and the server sends back
// HTML for parts of the page (see composerPatch in http/admin/composer.tsx): media is uploaded as
// it's chosen, which re-renders the media and the toolbar, and the preview below is re-rendered as
// you type. The form's own action publishes. Without Datastar it's a plain form, whose files are
// uploaded when it's posted. Each tab also follows the draft as other tabs change it
// (ComposerUpdates). Two local signals, declared on the form, say what's in flight: `_uploading`
// (set by data-indicator on whatever is uploading) and `_posting`. While either is, the preview
// waits, since a preview posts the whole form, chosen files and all. `_published` keeps Post
// disabled while the browser goes to the post, and `_draft` is the id of the draft this tab last
// knew was saved.
import type { Child, Html } from '#jsx/jsx-runtime'

import { routes } from '../../routes.ts'
import { Tooltip } from '../controls.tsx'
import { CloseIcon, MapPinIcon } from '../icons.tsx'

const URL_OF = (kind: 'media' | 'preview') => `el.closest('form').dataset.${kind}`
// Mutations need an explicit retry: a lost response may already have committed the write.
// Datastar 1.0.4 also needs retryMaxCount: 0 to stop transport-error retries.
const FORM_REQUEST = "{contentType: 'form', retry: 'never', retryMaxCount: 0}"
const UPDATE_MEDIA = `$_mediaRetry = el; @post(${URL_OF('media')}, ${FORM_REQUEST}).catch(() => {})`
const PREVIEW = `$_needsPreview = true; if (!$_uploading && !$_posting) { $_needsPreview = false; @post(${URL_OF('preview')}, ${FORM_REQUEST}).catch(() => {}); }`
// While typing, the preview follows at most every 100 ms, and once more after the last keystroke.
// A newer preview cancels one still on its way. A modifier's dot can't be in a JSX attribute's
// name, so this one is spread in.
const PREVIEW_ON_INPUT = { 'data-on:input__throttle.100ms.trailing': PREVIEW }
// Media re-rendered after an upload, a removal, or a rejected post: the preview catches up with
// what was typed meanwhile. Publishing resets its own busy state even without returned markup.
const REFRESH = `$_needsPreview = false; @post(${URL_OF('preview')}, ${FORM_REQUEST}).catch(() => {})`
const PUBLISH =
  "if (!$_uploading && !$_posting && !$_published) { const id = el.elements.namedItem('post_id').value; " +
  '$_posting = true; $_needsPreview = false; ' +
  `@post(el.getAttribute('action'), ${FORM_REQUEST}).catch(() => {}).finally(() => { ` +
  "$_posting = false; if ($_needsPreview && !$_published && el.elements.namedItem('post_id').value === id) " +
  "el.elements.namedItem('caption').dispatchEvent(new Event('input')); }); }"
// A successful preview only acknowledges text. It must not hide an upload or publish failure.
// Remember the submitted id independently of DOM attributes (which a morph can remove), including
// for body-size errors that cannot read the form. Ignore delayed failures for another post.
const REQUEST_FEEDBACK =
  "const source = evt.detail.el; if (evt.detail.type === 'started' && source.closest('form') === el) " +
  "$_requestIds.set(source, el.elements.namedItem('post_id').value); " +
  "if ($_requestIds.get(source) === el.elements.namedItem('post_id').value && " +
  "['error', 'retries-failed'].includes(evt.detail.type)) { " +
  "if (source.dataset.request === 'media') $_mediaError = true; " +
  "else if (source.dataset.request === 'publish') $_publishError = true; " +
  "else if (source.dataset.request === 'preview') $_previewError = true; }"
// Cmd or Ctrl + Enter posts, as on X.
const POST_SHORTCUT =
  "(evt.metaKey || evt.ctrlKey) && evt.key === 'Enter' && (evt.preventDefault(), el.form.requestSubmit())"
// The browser's UTC offset, like "+05:30", which the post is dated with.
const BROWSER_OFFSET =
  'const minutes = -new Date().getTimezoneOffset(); ' +
  'const abs = Math.abs(minutes); ' +
  "el.value = (minutes < 0 ? '-' : '+') + String(Math.floor(abs / 60)).padStart(2, '0') + ':' + String(abs % 60).padStart(2, '0')"

export function ComposerForm(props: { id: string; children: Child }): Html {
  return (
    <form
      id={props.id}
      method="post"
      action={routes.admin.newPost()}
      enctype="multipart/form-data"
      class="composer"
      data-media={routes.admin.newPostMedia()}
      data-preview={routes.admin.newPostPreview()}
      data-request="publish"
      data-signals="{_uploading: false, _posting: false, _published: false, _draft: '', _city: false, _previewError: false, _mediaError: false, _publishError: false, _mediaRetry: false, _needsPreview: false, _epoch: '', _revision: -1, _epochs: [], _reconnecting: false, _resetComposer: false, _imageRetries: new WeakMap(), _requestIds: new WeakMap()}"
      data-init="const id = el.elements.namedItem('post_id'); $_draft = 'saved' in id.dataset ? id.value : ''"
      data-on:datastar-fetch={REQUEST_FEEDBACK}
      data-on:pageshow__window="evt.persisted && ($_published = false)"
      data-on:submit__prevent={PUBLISH}
    >
      <div
        role="alert"
        class="alert"
        hidden
        data-attr:hidden="!($_previewError || $_mediaError || $_publishError)"
      >
        Couldn’t complete the request. Your input is still here; check your connection and try
        again.{' '}
        <button
          type="button"
          class="link-button"
          hidden
          data-attr:hidden="!$_mediaError"
          data-on:click="$_mediaRetry.isConnected && $_mediaRetry.dispatchEvent(new Event($_mediaRetry.type === 'file' ? 'change' : 'click'))"
        >
          Retry media change
        </button>
      </div>
      {props.children}
    </form>
  )
}

// Grows with what's typed (see .composer-text), like X's.
export function CaptionInput(props: { value: string }): Html {
  return (
    // A textarea drops a newline right after its start tag, so one goes there, and a value that
    // starts with a newline keeps it.
    <textarea
      name="caption"
      rows={3}
      aria-label="Caption"
      placeholder="What’s happening?"
      autofocus
      class="composer-text"
      data-request="preview"
      {...PREVIEW_ON_INPUT}
      data-on:keydown={POST_SHORTCUT}
    >
      {`\n${props.value}`}
    </textarea>
  )
}

// Where it was written: a map pin that shows the city's input beside it, which is shown when
// there's a city. Hiding it clears the city, and the preview follows. Without Datastar, the input
// is always shown. Datastar sets `_city` again when the attribute changes, as when another tab's
// change adds or clears the city.
const TOGGLE_CITY =
  '$_city = !$_city; const input = el.parentElement.nextElementSibling; ' +
  "input.setAttribute('data-signals:_city', String($_city)); " +
  'if ($_city) requestAnimationFrame(() => input.focus()); else { ' +
  `input.value = ''; ${PREVIEW} }`
const CITY_LABEL = "$_city ? 'Remove location' : 'Add location'"

export function CityInput(props: { value: string }): Html {
  let label = props.value ? 'Remove location' : 'Add location'
  return (
    <>
      <Tooltip label={<span data-text={CITY_LABEL}>{label}</span>}>
        <button
          type="button"
          aria-label={label}
          class="tool-button"
          data-request="preview"
          data-on:click={TOGGLE_CITY}
          data-attr:aria-label={CITY_LABEL}
        >
          <MapPinIcon />
        </button>
      </Tooltip>
      <input
        name="city"
        value={props.value}
        aria-label="City"
        placeholder="City"
        class="input city-input"
        data-signals:_city={props.value === '' ? 'false' : 'true'}
        data-show="$_city"
        data-request="preview"
        {...PREVIEW_ON_INPUT}
      />
    </>
  )
}

// Starts at the newest post's offset, for a browser without Datastar, and keeps the browser's
// when another tab's change is morphed in.
export function OffsetInput(props: { value: string }): Html {
  return (
    <input
      type="hidden"
      name="offset"
      value={props.value}
      data-init={BROWSER_OFFSET}
      data-preserve-attr="value"
    />
  )
}

// The article's title or summary, which the preview follows.
export function ArticleTextInput(props: {
  name: 'article_title' | 'article_summary'
  value: string
  label: string
  class: string
}): Html {
  return (
    <input
      name={props.name}
      value={props.value}
      aria-label={props.label}
      placeholder={props.label}
      class={props.class}
      data-request="preview"
      {...PREVIEW_ON_INPUT}
    />
  )
}

// An icon button (or with `text`, its label as a link) that chooses files, which are uploaded
// right away.
export function MediaPicker(props: {
  label: string
  name: string
  accept: string
  multiple?: boolean | undefined
  disabled?: boolean | undefined
  text?: boolean | undefined
  children?: Child | undefined
}): Html {
  let { label, name, accept, multiple, disabled, text, children } = props
  let button = (
    <label class={text ? 'link-button' : 'tool-button'} data-disabled={disabled}>
      {text ? label : children}
      <input
        type="file"
        name={name}
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        aria-label={label}
        class="visually-hidden"
        data-request="media"
        data-on:change={UPDATE_MEDIA}
        data-indicator:_uploading
      />
    </label>
  )
  return text ? button : <Tooltip label={label}>{button}</Tooltip>
}

// Takes one file (or the article) out of the post: a round × over its tile, or with `text`, the
// label as a link. It needs Datastar; without it, media can only be added.
export function RemoveMediaButton(props: {
  file?: string | undefined
  label: string
  text?: boolean | undefined
}): Html {
  let { file, label, text } = props
  return (
    <button
      type="button"
      name={file === undefined ? 'remove_article' : 'remove'}
      value={file ?? 'article'}
      aria-label={text ? undefined : label}
      title={text ? undefined : label}
      class={text ? 'link-button' : 'remove-button'}
      data-request="media"
      data-on:click={UPDATE_MEDIA}
      data-indicator:_uploading
    >
      {text ? label : <CloseIcon />}
    </button>
  )
}

// Runs once, when the server's HTML puts it on the page.
export function PreviewRefresh(): Html {
  return <span hidden data-request="preview" data-init={REFRESH} />
}

// A morph keeps what's typed in a field unless the server's value differs from the field's
// default (its value attribute, or a textarea's text). Once the server has saved the draft, its
// values become the defaults: another tab's change (or a discard) still replaces a field, but
// what's typed here and not saved yet, as during an outage, stays.
const SAVE_DEFAULTS =
  "const form = el.closest('form'); if (form.elements.namedItem('post_id').value === el.dataset.postId) { " +
  '$_draft = el.dataset.postId; ' +
  'for (const [name, value] of Object.entries(JSON.parse(el.dataset.values))) { ' +
  'const field = form.elements.namedItem(name); ' +
  'if (field instanceof HTMLTextAreaElement) field.defaultValue = value; ' +
  "else if (field instanceof HTMLInputElement) field.setAttribute('value', value); } }"

export function SavedDefaults(props: { id: string; values: Record<string, string> }): Html {
  return (
    <span
      hidden
      data-post-id={props.id}
      data-values={JSON.stringify(props.values)}
      data-init={SAVE_DEFAULTS}
    />
  )
}

// Only a reconnect retries broken images, once per element/source. Ordinary remote edits
// must not repeatedly request permanently missing article images. Uploads and publishing need
// an explicit retry: their response may have been lost after committing the mutation.
// Remove sources first for WebKit, then restore their raw attributes so the next morph doesn't
// reload them merely because a relative src became an absolute URL.
const RECOVER =
  "const form = document.querySelector('#composer-page form'); " +
  "if ($_reconnecting) document.querySelectorAll('#composer-page img').forEach((img) => { " +
  'const source = img.src + img.srcset; if (img.complete && !img.naturalWidth && $_imageRetries.get(img) !== source) { ' +
  "$_imageRetries.set(img, source); const src = img.getAttribute('src'), srcset = img.getAttribute('srcset'); " +
  "img.removeAttribute('srcset'); img.removeAttribute('src'); " +
  "if (srcset !== null) img.setAttribute('srcset', srcset); if (src !== null) img.setAttribute('src', src); } }); " +
  '$_reconnecting = false; ' +
  "if ($_previewError && !$_posting && !$_uploading) form.elements.namedItem('caption').dispatchEvent(new Event('input')); "

// Run before Datastar's patch watcher. A stream snapshot can have been rendered before a save
// whose response has already arrived. Every response also belongs to a particular post; none
// of its patches (including media and redirects) may be applied to a different composer.
const BEFORE_UPDATE =
  "if (evt.detail.type === 'datastar-patch-elements' && evt.detail.argsRaw.composer) { " +
  'const update = JSON.parse(evt.detail.argsRaw.composer); ' +
  "const form = document.querySelector('#composer-page form'); const id = form.elements.namedItem('post_id').value; " +
  "const stream = update.kind === 'stream'; const version = update.version; " +
  'const stale = version && (($_epochs.includes(version.epoch) && $_epoch !== version.epoch) || ' +
  '($_epoch === version.epoch && (stream ? version.revision <= $_revision : version.revision < $_revision))); ' +
  'if ((!stream && (update.id || $_requestIds.get(evt.detail.el)) !== id) || stale) { ' +
  'evt.stopImmediatePropagation(); if (stream) { ' +
  RECOVER +
  ' } ' +
  '} else { ' +
  'if (version) { if (!$_epochs.includes(version.epoch)) $_epochs.push(version.epoch); $_epoch = version.epoch; $_revision = version.revision; } ' +
  "if (stream) { $_resetComposer = ($_draft && $_draft !== update.id) || (update.previousId === id && ['published', 'retired'].includes(update.previousState)); } " +
  "else { if (update.kind === 'preview') $_previewError = false; " +
  "if (update.kind === 'media') { $_mediaError = false; $_previewError = false; } " +
  "if (update.kind === 'publish') { $_publishError = false; $_mediaError = false; $_previewError = false; } } } }"

const AFTER_UPDATE =
  "if (evt.detail.el === el) { if (evt.detail.type === 'retrying') $_reconnecting = true; " +
  "if (evt.detail.type === 'datastar-patch-elements') { " +
  "const form = document.querySelector('#composer-page form'); const id = form.elements.namedItem('post_id'); " +
  'if ($_resetComposer) { form.reset(); $_previewError = false; $_mediaError = false; $_publishError = false; $_needsPreview = false; $_resetComposer = false; } ' +
  "$_draft = 'saved' in id.dataset ? id.value : ''; " +
  '{ ' +
  RECOVER +
  ' } } }'

export function ComposerUpdates(props: { url: string }): Html {
  return (
    <span
      hidden
      data-url={props.url}
      data-init="@get(el.dataset.url, {filterSignals: {include: /^_postId$/, exclude: /^$/}, retry: 'always', retryMaxCount: Infinity}).catch(() => {})"
      data-on:datastar-fetch__capture={BEFORE_UPDATE}
      data-on:datastar-fetch={AFTER_UPDATE}
    />
  )
}

// Shown while media is uploading.
export function UploadingNote(): Html {
  return (
    <span role="status" hidden class="uploading muted" data-attr:hidden="!$_uploading">
      <span class="spinner" aria-hidden="true" />
      Uploading…
    </span>
  )
}

export function PostButton(): Html {
  return (
    <button
      type="submit"
      class="button post-button"
      data-attr:disabled="$_uploading || $_posting || $_published"
    >
      Post
    </button>
  )
}

// Empties the composer's file inputs, when what was chosen can't be sent.
export function ClearFiles(): Html {
  return (
    <span
      hidden
      data-init="el.closest('form').querySelectorAll('input[type=file]').forEach((input) => (input.value = ''))"
    />
  )
}

// Where the browser goes once the post is published.
export function Redirect(props: { href: string }): Html {
  return (
    <span
      hidden
      data-href={props.href}
      data-init="$_published = true; location.assign(el.dataset.href)"
    />
  )
}
