// The buttons in the navbar and on posts. Datastar runs these (and the composer, in
// ../routes/admin/compose/page.tsx): each expression below is a constant string, so nothing a user
// typed can end up in one. Values they need (like the link to share)
// are passed in data-* attributes and read with `el.dataset`. Until Datastar loads, after the
// page does, they do nothing.
import type { Child, Html } from '#jsx/jsx-runtime'

import { urls } from '../lib/urls.ts'
import css from './controls.css' with { type: 'text' }
import {
  CheckIcon,
  ComposeIcon,
  LogoutIcon,
  MoonIcon,
  RssIcon,
  ShareIcon,
  SunIcon,
} from './icons.tsx'
import { stylesheet } from './stylesheet.ts'
import { Button } from './ui/button.tsx'

export const CONTROLS_STYLES = stylesheet(css)

// Cookie holding the user's chosen theme ('light' or 'dark'); absent means follow the system.
// A cookie rather than localStorage so the server renders the right theme on every request.
export const THEME_COOKIE_NAME = 'theme'

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
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label="Toggle dark mode"
        data-on:click={TOGGLE_THEME}
      >
        <MoonIcon class="in-light-theme" />
        <SunIcon class="in-dark-theme" />
      </Button>
    </Tooltip>
  )
}

// The navbar's link to the RSS feed.
export function RssLink(): Html {
  return (
    <Tooltip label="RSS feed">
      <Button href={urls.rss()} variant="ghost" size="icon-lg" aria-label="RSS feed">
        <RssIcon />
      </Button>
    </Tooltip>
  )
}

// The navbar's link to the composer, on every page of a browser that's logged in as admin.
export function ComposeLink(): Html {
  return (
    <Tooltip label="New Post">
      <Button href={urls.admin.newPost()} variant="ghost" size="icon-lg" aria-label="New Post">
        <ComposeIcon />
      </Button>
    </Tooltip>
  )
}

// Ends the admin session.
export function LogoutButton(): Html {
  return (
    <form method="post" action={urls.admin.logout()}>
      <Tooltip label="Log out">
        <Button type="submit" variant="ghost" size="icon-lg" aria-label="Log out">
          <LogoutIcon />
        </Button>
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
    <Button
      variant="ghost"
      size="icon-lg"
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
    </Button>
  )
}
