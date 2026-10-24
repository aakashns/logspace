// The app's icons, drawn on a 24 × 24 grid in the text color.
import type { Html } from '#jsx/jsx-runtime'

type IconProps = { class?: string | undefined }

const stroke = { fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5' }

// A dot with two arcs spreading from it.
export function RssIcon(): Html {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 4.5A14.5 14.5 0 0 1 19.5 19M5 10.5A8.5 8.5 0 0 1 13.5 19"
        {...stroke}
        stroke-linecap="round"
      />
      <circle cx="6" cy="18" r="1.5" fill="currentColor" />
    </svg>
  )
}

// An arrow rising out of a tray, like the share icon on X.
export function ShareIcon(props: IconProps): Html {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" class={props.class}>
      <path
        d="M12 3.5V15M7.5 8L12 3.5L16.5 8M4.5 14.5V19A1.5 1.5 0 0 0 6 20.5H18A1.5 1.5 0 0 0 19.5 19V14.5"
        {...stroke}
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}

export function CheckIcon(props: IconProps): Html {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" class={props.class}>
      <path
        d="M5 12.5L10 17.5L19 6.5"
        {...stroke}
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}

export function MoonIcon(props: IconProps): Html {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" class={props.class}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" {...stroke} stroke-linejoin="round" />
    </svg>
  )
}

export function SunIcon(props: IconProps): Html {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" class={props.class}>
      <circle cx="12" cy="12" r="4" {...stroke} />
      <path
        d="M12 2.5V4.5M12 19.5V21.5M2.5 12H4.5M19.5 12H21.5M5.3 5.3L6.7 6.7M17.3 17.3L18.7 18.7M5.3 18.7L6.7 17.3M17.3 6.7L18.7 5.3"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
  )
}

// An arrow leaving a door frame.
export function LogoutIcon(): Html {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M9.5 20.5H5.5A1.5 1.5 0 0 1 4 19V5A1.5 1.5 0 0 1 5.5 3.5H9.5M15.5 16.5L20 12L15.5 7.5M20 12H9"
        {...stroke}
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}

// From Phosphor Icons (https://phosphoricons.com, regular weight), © 2023 Phosphor Icons, MIT
// licensed. They're drawn on a 256 × 256 grid, filled, with strokes as wide as the icons above.
function PhosphorIcon(props: IconProps & { d: string }): Html {
  return (
    <svg viewBox="0 0 256 256" aria-hidden="true" class={props.class}>
      <path d={props.d} fill="currentColor" />
    </svg>
  )
}

// Phosphor's plus-square, for writing a new post.
export function ComposeIcon(): Html {
  return (
    <PhosphorIcon d="M208,32H48A16,16,0,0,0,32,48V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V48A16,16,0,0,0,208,32Zm0,176H48V48H208V208Zm-32-80a8,8,0,0,1-8,8H136v32a8,8,0,0,1-16,0V136H88a8,8,0,0,1,0-16h32V88a8,8,0,0,1,16,0v32h32A8,8,0,0,1,176,128Z" />
  )
}

// Phosphor's image.
export function ImageIcon(): Html {
  return (
    <PhosphorIcon d="M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,16V158.75l-26.07-26.06a16,16,0,0,0-22.63,0l-20,20-44-44a16,16,0,0,0-22.62,0L40,149.37V56ZM40,172l52-52,80,80H40Zm176,28H194.63l-36-36,20-20L216,181.38V200ZM144,100a12,12,0,1,1,12,12A12,12,0,0,1,144,100Z" />
  )
}

// Phosphor's video-camera.
export function VideoIcon(): Html {
  return (
    <PhosphorIcon d="M251.77,73a8,8,0,0,0-8.21.39L208,97.05V72a16,16,0,0,0-16-16H32A16,16,0,0,0,16,72V184a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V159l35.56,23.71A8,8,0,0,0,248,184a8,8,0,0,0,8-8V80A8,8,0,0,0,251.77,73ZM192,184H32V72H192V184Zm48-22.95-32-21.33V116.28L240,95Z" />
  )
}

// Phosphor's x, for removing something.
export function CloseIcon(): Html {
  return (
    <PhosphorIcon d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z" />
  )
}
