import { css } from 'remix/component'

// A round icon button in the navbar, like the theme toggle and the admin logout button.
export const navButtonStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '2.25rem',
  height: '2.25rem',
  borderRadius: '9999px',
  transition: 'background-color 150ms',
  '&:hover': { backgroundColor: 'var(--control-hover)' },
  '&:active': { backgroundColor: 'var(--control-active)' },
  '&:focus-visible': { outline: '2px solid var(--ring)', outlineOffset: '2px' },
  '& svg': { width: '1.25rem', height: '1.25rem' },
})
