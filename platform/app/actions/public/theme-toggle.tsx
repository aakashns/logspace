import { clientEntry, css, on, type Handle } from 'remix/component'

import { navButtonStyle } from '../../ui/public/nav-button.ts'
import { Tooltip } from '../../ui/public/tooltip.tsx'

interface ThemeToggleProps {
  cookieName: string
}

// The current theme lives on <html>: a `light` or `dark` class once the user has picked one
// (rendered by the server from the theme cookie), otherwise the system preference. The icons
// and tooltip switch with CSS, so the button needs no state of its own.
export const ThemeToggle = clientEntry(
  import.meta.url,
  function ThemeToggle(handle: Handle<ThemeToggleProps>) {
    return () => (
      <Tooltip
        label={
          <>
            <span mix={inLightTheme}>Switch to dark theme</span>
            <span mix={inDarkTheme}>Switch to light theme</span>
          </>
        }
      >
        <button
          type="button"
          aria-label="Toggle dark mode"
          mix={[
            navButtonStyle,
            on('click', () => {
              let root = document.documentElement
              let dark =
                root.classList.contains('dark') ||
                (!root.classList.contains('light') && matchMedia(DARK_QUERY).matches)
              let theme = dark ? 'light' : 'dark'
              root.classList.remove('light', 'dark')
              root.classList.add(theme)
              document.cookie = `${handle.props.cookieName}=${theme}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax`
            }),
          ]}
        >
          <MoonIcon />
          <SunIcon />
        </button>
      </Tooltip>
    )
  },
)

const DARK_QUERY = '(prefers-color-scheme: dark)'
const ONE_YEAR = 60 * 60 * 24 * 365

function MoonIcon() {
  return () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" mix={inLightTheme}>
      <path
        d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linejoin="round"
      />
    </svg>
  )
}

function SunIcon() {
  return () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" mix={inDarkTheme}>
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path
        d="M12 2.5V4.5M12 19.5V21.5M2.5 12H4.5M19.5 12H21.5M5.3 5.3L6.7 6.7M17.3 17.3L18.7 18.7M5.3 18.7L6.7 17.3M17.3 6.7L18.7 5.3"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
  )
}

// Shown only in the light or the dark theme, whether picked with the toggle or by the system.
const inLightTheme = css({
  ':root.dark &': { display: 'none' },
  [`@media ${DARK_QUERY}`]: { ':root:not(.light) &': { display: 'none' } },
})

const inDarkTheme = css({
  display: 'none',
  ':root.dark &': { display: 'block' },
  [`@media ${DARK_QUERY}`]: { ':root:not(.light) &': { display: 'block' } },
})
