// Cloudflare's Turnstile widget, which adds its answer (a token) to the form it's in as
// cf-turnstile-response. Its script only runs on a page whose response lets it (see pageResponse in
// ../lib/http/pages.ts).
import type { Html } from '#jsx/jsx-runtime'

import { stylesheet } from './stylesheet.ts'
import css from './turnstile.css' with { type: 'text' }

export const TURNSTILE_STYLES = stylesheet(css)

// It fills the width it's given ("flexible", at least 300 pixels), rather than a fixed 300.
export function TurnstileWidget(props: { siteKey: string }): Html {
  return (
    <>
      <div class="cf-turnstile" data-sitekey={props.siteKey} data-size="flexible" data-ignore></div>
      <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
    </>
  )
}
