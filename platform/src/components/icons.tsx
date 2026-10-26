// The app's icons, drawn on a 24 × 24 grid in the text color.
import type { Html } from '#jsx/jsx-runtime'

// `data-icon` says which side of a button's text the icon is on, which trims that side's padding
// (see ui/button.css).
type IconProps = {
  class?: string | undefined
  'data-icon'?: 'inline-start' | 'inline-end' | undefined
}

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
export function PhosphorIcon(props: IconProps & { d: string }): Html {
  return (
    <svg
      viewBox="0 0 256 256"
      aria-hidden="true"
      class={props.class}
      data-icon={props['data-icon']}
    >
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

// Phosphor's caret-down, for a select's arrow.
export function CaretDownIcon(props: IconProps): Html {
  return (
    <PhosphorIcon
      {...props}
      d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z"
    />
  )
}

// Phosphor's x, for removing something.
export function CloseIcon(): Html {
  return (
    <PhosphorIcon d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z" />
  )
}

// Phosphor's trash, for deleting something.
export function TrashIcon(props: IconProps): Html {
  return (
    <PhosphorIcon
      {...props}
      d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z"
    />
  )
}

// Phosphor's dots-three, for a menu of more actions.
export function DotsThreeIcon(): Html {
  return (
    <PhosphorIcon d="M140,128a12,12,0,1,1-12-12A12,12,0,0,1,140,128Zm56-12a12,12,0,1,0,12,12A12,12,0,0,0,196,116ZM60,116a12,12,0,1,0,12,12A12,12,0,0,0,60,116Z" />
  )
}

// Phosphor's bell, for turning on notifications.
export function BellIcon(props: IconProps): Html {
  return (
    <PhosphorIcon
      {...props}
      d="M221.8,175.94C216.25,166.38,208,139.33,208,104a80,80,0,1,0-160,0c0,35.34-8.26,62.38-13.81,71.94A16,16,0,0,0,48,200H88.81a40,40,0,0,0,78.38,0H208a16,16,0,0,0,13.8-24.06ZM128,216a24,24,0,0,1-22.62-16h45.24A24,24,0,0,1,128,216ZM48,184c7.7-13.24,16-43.92,16-80a64,64,0,1,1,128,0c0,36.05,8.28,66.73,16,80Z"
    />
  )
}

// Phosphor's bell-ringing, filled, for notifications that are on.
export function BellRingingIcon(props: IconProps): Html {
  return (
    <PhosphorIcon
      {...props}
      d="M224,71.1a8,8,0,0,1-10.78-3.42,94.13,94.13,0,0,0-33.46-36.91,8,8,0,1,1,8.54-13.54,111.46,111.46,0,0,1,39.12,43.09A8,8,0,0,1,224,71.1ZM35.71,72a8,8,0,0,0,7.1-4.32A94.13,94.13,0,0,1,76.27,30.77a8,8,0,1,0-8.54-13.54A111.46,111.46,0,0,0,28.61,60.32,8,8,0,0,0,35.71,72Zm186.1,103.94A16,16,0,0,1,208,200H167.2a40,40,0,0,1-78.4,0H48a16,16,0,0,1-13.79-24.06C43.22,160.39,48,138.28,48,112a80,80,0,0,1,160,0C208,138.27,212.78,160.38,221.81,175.94ZM150.62,200H105.38a24,24,0,0,0,45.24,0Z"
    />
  )
}

// Phosphor's bell-slash, for notifications the browser blocks.
export function BellSlashIcon(props: IconProps): Html {
  return (
    <PhosphorIcon
      {...props}
      d="M53.92,34.62A8,8,0,1,0,42.08,45.38L58.82,63.8A79.59,79.59,0,0,0,48,104c0,35.34-8.26,62.38-13.81,71.94A16,16,0,0,0,48,200H88.8a40,40,0,0,0,78.4,0h15.44l19.44,21.38a8,8,0,1,0,11.84-10.76ZM128,216a24,24,0,0,1-22.62-16h45.24A24,24,0,0,1,128,216ZM48,184c7.7-13.24,16-43.92,16-80a63.65,63.65,0,0,1,6.26-27.62L168.09,184Zm166-4.73a8.13,8.13,0,0,1-2.93.55,8,8,0,0,1-7.44-5.08C196.35,156.19,192,129.75,192,104A64,64,0,0,0,96.43,48.31a8,8,0,0,1-7.9-13.91A80,80,0,0,1,208,104c0,35.35,8.05,58.59,10.52,64.88A8,8,0,0,1,214,179.25Z"
    />
  )
}
