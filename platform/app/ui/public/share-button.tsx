import { clientEntry, css, on, type Handle } from 'remix/component'

interface ShareButtonProps {
  url: string
}

// Opens the OS share sheet for `url`. Where the Web Share API isn't available (e.g. Firefox on
// desktop), it copies the link instead and shows a check mark for a moment.
export const ShareButton = clientEntry(
  import.meta.url,
  function ShareButton(handle: Handle<ShareButtonProps>) {
    let copied = false
    let resetTimer: ReturnType<typeof setTimeout> | undefined
    handle.signal.addEventListener('abort', () => clearTimeout(resetTimer))

    return () => (
      <button
        type="button"
        aria-label={copied ? 'Link copied' : 'Share'}
        title={copied ? 'Link copied' : 'Share'}
        mix={[
          buttonStyle,
          on('click', async () => {
            let { url } = handle.props
            if (navigator.share) {
              try {
                await navigator.share({ url })
              } catch {
                // The user closed the share sheet, or the share failed; nothing to do either way.
              }
              return
            }

            await navigator.clipboard.writeText(url)
            copied = true
            handle.update()
            clearTimeout(resetTimer)
            resetTimer = setTimeout(() => {
              copied = false
              handle.update()
            }, 2000)
          }),
        ]}
      >
        {copied ? <CheckIcon /> : <ShareIcon />}
      </button>
    )
  },
)

// An arrow rising out of a tray, like the share icon on X.
function ShareIcon() {
  return () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3.5V15M7.5 8L12 3.5L16.5 8M4.5 14.5V19A1.5 1.5 0 0 0 6 20.5H18A1.5 1.5 0 0 0 19.5 19V14.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}

function CheckIcon() {
  return () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 12.5L10 17.5L19 6.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}

// Same size and right-edge position as the theme toggle, so the two line up. The button is taller
// than the line it sits on, so negative block margins keep it from adding height.
const buttonStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  width: '2.25rem',
  height: '2.25rem',
  marginBlock: '-0.375rem',
  borderRadius: '9999px',
  color: 'var(--muted-foreground)',
  transition: 'background-color 150ms',
  '&:hover': { backgroundColor: 'var(--control-hover)' },
  '&:active': { backgroundColor: 'var(--control-active)' },
  '&:focus-visible': { outline: '2px solid var(--ring)', outlineOffset: '2px' },
  '& svg': { width: '1.25rem', height: '1.25rem' },
})
