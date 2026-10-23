// The app's icons, drawn on a 24 × 24 grid in the text color.
import type { Html } from '#jsx/jsx-runtime'

type IconProps = { class?: string }

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
