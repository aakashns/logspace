import { css } from 'remix/component'

// Styles shared by the pages under /admin.

export const pageStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '1.25rem',
  paddingBlock: '2rem',
})

export const titleStyle = css({
  fontSize: '2rem',
  lineHeight: 1.2,
})

export const inputStyle = css({
  width: '100%',
  padding: '0.5rem 0.75rem',
  border: '1px solid var(--input)',
  borderRadius: '0.5rem',
  backgroundColor: 'var(--background)',
  color: 'var(--foreground)',
  font: 'inherit',
  '&:focus-visible': { outline: '2px solid var(--ring)', outlineOffset: '1px' },
  '&[aria-invalid="true"]': { borderColor: 'var(--destructive)' },
})

export const buttonStyle = css({
  display: 'inline-block',
  padding: '0.5rem 1rem',
  border: 'none',
  borderRadius: '0.5rem',
  backgroundColor: 'var(--primary)',
  color: 'var(--primary-foreground)',
  font: 'inherit',
  fontWeight: 500,
  cursor: 'pointer',
  '&:hover': { backgroundColor: 'color-mix(in oklch, var(--primary) 90%, transparent)' },
  '&:focus-visible': { outline: '2px solid var(--ring)', outlineOffset: '2px' },
})

export const destructiveButtonStyle = css({
  display: 'inline-block',
  padding: '0.5rem 1rem',
  border: '1px solid var(--destructive)',
  borderRadius: '0.5rem',
  backgroundColor: 'transparent',
  color: 'var(--destructive)',
  font: 'inherit',
  fontWeight: 500,
  cursor: 'pointer',
  '&:hover': { backgroundColor: 'color-mix(in oklch, var(--destructive) 10%, transparent)' },
  '&:focus-visible': { outline: '2px solid var(--ring)', outlineOffset: '2px' },
})

export const secondaryButtonStyle = css({
  display: 'inline-block',
  padding: '0.5rem 1rem',
  border: '1px solid var(--border)',
  borderRadius: '0.5rem',
  color: 'var(--foreground)',
  font: 'inherit',
  fontWeight: 500,
  '&:hover': { backgroundColor: 'var(--accent)' },
  '&:focus-visible': { outline: '2px solid var(--ring)', outlineOffset: '2px' },
})

export const errorStyle = css({
  color: 'var(--destructive)',
  fontSize: '0.875rem',
})

export const mutedStyle = css({
  color: 'var(--muted-foreground)',
  fontSize: '0.875rem',
  '& a:hover': { textDecoration: 'underline' },
})

// A row of buttons, like Save and Cancel.
export const actionsStyle = css({
  display: 'flex',
  gap: '0.75rem',
})

// A list of why a form wasn't saved.
export const alertStyle = css({
  padding: '0.75rem 1rem',
  border: '1px solid var(--destructive)',
  borderRadius: '0.75rem',
  color: 'var(--destructive)',
  overflowWrap: 'anywhere',
  '& ul': { marginTop: '0.375rem', paddingLeft: '1.25rem' },
})

// A note that something was saved.
export const noticeStyle = css({
  padding: '0.75rem 1rem',
  border: '1px solid var(--border)',
  borderRadius: '0.75rem',
  backgroundColor: 'var(--muted)',
})
