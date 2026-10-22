import type { Handle, RemixNode } from 'remix/component'
import { css } from 'remix/component'

// A small label below `children` (usually an icon button), shown on mouse hover and keyboard
// focus. CSS only, so it needs no JavaScript. It's right-aligned with `children` so it stays on
// screen at the right edge of the navbar. Screen readers skip it: give the button an aria-label
// with the same text.
export function Tooltip(handle: Handle<{ label: RemixNode; children?: RemixNode }>) {
  return () => (
    <span mix={tooltipStyle}>
      {handle.props.children}
      <span data-tooltip aria-hidden="true">
        {handle.props.label}
      </span>
    </span>
  )
}

const shown = { opacity: 1, transform: 'none', transitionDelay: '300ms' }

const tooltipStyle = css({
  position: 'relative',
  display: 'inline-flex',
  '& > [data-tooltip]': {
    position: 'absolute',
    top: 'calc(100% + 0.375rem)',
    right: 0,
    zIndex: 20,
    padding: '0.25rem 0.5rem',
    borderRadius: '0.375rem',
    backgroundColor: 'var(--foreground)',
    color: 'var(--background)',
    fontSize: '0.75rem',
    lineHeight: 1.4,
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
    opacity: 0,
    transform: 'translateY(-0.125rem)',
    transition: 'opacity 100ms, transform 100ms',
  },
  // Only real hover: on touch screens a tap leaves :hover stuck on.
  '@media (hover: hover)': { '&:hover > [data-tooltip]': shown },
  '&:has(:focus-visible) > [data-tooltip]': shown,
  '@media (prefers-reduced-motion: reduce)': { '& > [data-tooltip]': { transform: 'none' } },
})
