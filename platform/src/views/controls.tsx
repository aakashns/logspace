// The buttons in the navbar and on posts. The only script on any page is Datastar, and these are
// what it runs: each expression below is a constant string, so nothing a user typed can end up
// in one. Values they need (like the link to share) are passed in data-* attributes and read
// with `el.dataset`. Until Datastar loads, after the page does, they do nothing.
import type { Child, Html } from '#jsx/jsx-runtime'

import { THEME_COOKIE_NAME } from '../domain/constants.ts'
import { routes } from '../routes.ts'
import {
  CheckIcon,
  CloseIcon,
  ComposeIcon,
  LogoutIcon,
  MapPinIcon,
  MoonIcon,
  RssIcon,
  ShareIcon,
  SunIcon,
} from './icons.tsx'

// A small label below `children` (usually an icon button), shown on mouse hover and keyboard
// focus, with CSS alone. Screen readers skip it: give the button an aria-label with the same text.
export function Tooltip(props: { label: Child; children: Child }): Html {
  return (
    <span class="tooltip">
      {props.children}
      <span data-tooltip aria-hidden="true">
        {props.label}
      </span>
    </span>
  )
}

// The current theme lives on <html>: a `light` or `dark` class once the user has picked one
// (rendered by the server from the theme cookie), otherwise the system preference. The icons and
// tooltip switch with CSS, so the button needs no state of its own.
const TOGGLE_THEME =
  'const root = document.documentElement; ' +
  "const dark = root.classList.contains('dark') || " +
  "(!root.classList.contains('light') && matchMedia('(prefers-color-scheme: dark)').matches); " +
  "root.classList.remove('light', 'dark'); " +
  "root.classList.add(dark ? 'light' : 'dark'); " +
  `document.cookie = '${THEME_COOKIE_NAME}=' + (dark ? 'light' : 'dark') + '; Path=/; Max-Age=31536000; SameSite=Lax'`

export function ThemeToggle(): Html {
  return (
    <Tooltip
      label={
        <>
          <span class="in-light-theme">Switch to dark theme</span>
          <span class="in-dark-theme">Switch to light theme</span>
        </>
      }
    >
      <button
        type="button"
        aria-label="Toggle dark mode"
        class="nav-button"
        data-on:click={TOGGLE_THEME}
      >
        <MoonIcon class="in-light-theme" />
        <SunIcon class="in-dark-theme" />
      </button>
    </Tooltip>
  )
}

// The navbar's link to the RSS feed.
export function RssLink(): Html {
  return (
    <Tooltip label="RSS feed">
      <a href={routes.rss()} aria-label="RSS feed" class="nav-button">
        <RssIcon />
      </a>
    </Tooltip>
  )
}

// The navbar's link to the composer, on every page of a browser that's logged in as admin.
export function ComposeLink(): Html {
  return (
    <Tooltip label="New Post">
      <a href={routes.admin.newPost()} aria-label="New Post" class="nav-button">
        <ComposeIcon />
      </a>
    </Tooltip>
  )
}

// Ends the admin session.
export function LogoutButton(): Html {
  return (
    <form method="post" action={routes.admin.logout()}>
      <Tooltip label="Log out">
        <button type="submit" aria-label="Log out" class="nav-button">
          <LogoutIcon />
        </button>
      </Tooltip>
    </form>
  )
}

// Opens the OS share sheet for the button's link. Where the Web Share API isn't available (e.g.
// Firefox on desktop), it copies the link instead and shows a check mark for two seconds. The
// `_shared` signal (declared on <body>, see document.tsx) holds the link copied last, so the
// button whose link it is shows the check mark.
const SHARE =
  'navigator.share ' +
  '? navigator.share({ url: el.dataset.url }).catch(() => null) ' +
  ': navigator.clipboard.writeText(el.dataset.url).then(() => (' +
  '$_shared = el.dataset.url, ' +
  'clearTimeout(el.resetTimer), ' +
  "el.resetTimer = setTimeout(() => ($_shared = ''), 2000)))"
const IS_SHARED = '$_shared === el.dataset.url'
const SHARE_LABEL = `${IS_SHARED} ? 'Link copied' : 'Share'`

export function ShareButton(props: { url: string }): Html {
  return (
    <button
      type="button"
      aria-label="Share"
      title="Share"
      class="share-button"
      data-url={props.url}
      data-on:click={SHARE}
      data-class:copied={IS_SHARED}
      data-attr:aria-label={SHARE_LABEL}
      data-attr:title={SHARE_LABEL}
    >
      <ShareIcon class="share-icon" />
      <CheckIcon class="check-icon" />
    </button>
  )
}

// ---- The composer (views/admin/compose.tsx)
//
// Its form posts to the server with Datastar as you write, and the server sends back HTML for
// parts of the page (see composerPatch in http/admin.tsx): media is uploaded as it's chosen,
// which re-renders the media and the toolbar, and the preview below is re-rendered as you type.
// The form's own action publishes. Without Datastar it's a plain form, whose files are uploaded
// when it's posted. Each tab also follows the draft as other tabs change it (ComposerUpdates).
// Two local signals, declared on the form, say what's in flight: `_uploading` (set by
// data-indicator on whatever is uploading) and `_posting`. While either is, the preview waits,
// since a preview posts the whole form, chosen files and all.
const URL_OF = (kind: 'media' | 'preview') => `el.closest('form').dataset.${kind}`
const UPDATE_MEDIA = `@post(${URL_OF('media')}, {contentType: 'form'})`
const PREVIEW = `$_uploading || $_posting || @post(${URL_OF('preview')}, {contentType: 'form'})`
// While typing, the preview follows at most every 100 ms, and once more after the last keystroke.
// A newer preview cancels one still on its way. A modifier's dot can't be in a JSX attribute's
// name, so this one is spread in.
const PREVIEW_ON_INPUT = { 'data-on:input__throttle.100ms.trailing': PREVIEW }
// Media re-rendered after an upload, a removal, or a rejected post: the preview catches up with
// what was typed meanwhile, and the Post button comes back.
const REFRESH = `$_posting = false; @post(${URL_OF('preview')}, {contentType: 'form'})`
const PUBLISH =
  "!$_uploading && !$_posting && ($_posting = true) && @post(el.getAttribute('action'), {contentType: 'form'})"
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
      data-signals="{_uploading: false, _posting: false, _city: false}"
      data-on:submit__prevent={PUBLISH}
    >
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
  '$_city ? requestAnimationFrame(() => input.focus()) : ' +
  `((input.value = ''), ${PREVIEW})`
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
      data-on:click={UPDATE_MEDIA}
      data-indicator:_uploading
    >
      {text ? label : <CloseIcon />}
    </button>
  )
}

// Runs once, when the server's HTML puts it on the page.
export function PreviewRefresh(): Html {
  return <span hidden data-init={REFRESH} />
}

// The composer again, from the server, whenever another tab changes the draft (see
// composerUpdates in http/admin.tsx). Datastar closes the stream while the tab is hidden and opens
// it again when it's shown, which sends the draft as it is then. The server ends it when it stops,
// so it's opened again (`always`) for when the server's back, unless it redirects to the login.
export function ComposerUpdates(props: { url: string }): Html {
  return <span hidden data-url={props.url} data-init="@get(el.dataset.url, {retry: 'always'})" />
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
    <button type="submit" class="button post-button" data-attr:disabled="$_uploading || $_posting">
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
  return <span hidden data-href={props.href} data-init="location.assign(el.dataset.href)" />
}
