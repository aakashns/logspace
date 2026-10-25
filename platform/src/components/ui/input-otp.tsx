// shadcn/ui's InputOTP, in its base-nova style, as the input-otp library it wraps does it: one real
// <input>, over a box for each character, which show what's typed in it (with Datastar, through
// the signal named `signal`, like "_code"). So phones can fill it in from an email
// (autocomplete="one-time-code"), a pasted code fills every box, and it's sent with its form.
// Without JavaScript the boxes are hidden, and it's a plain input. Its attributes go on the
// <input>; give it an id for its label, and aria-invalid="true" when its value was refused.
import type { Html } from '#jsx/jsx-runtime'

import { stylesheet } from '../stylesheet.ts'
import css from './input-otp.css' with { type: 'text' }

export const INPUT_OTP_STYLES = stylesheet(css)

export function InputOTP(
  props: Record<string, unknown> & { signal: string; length: number },
): Html {
  let { signal, length, ...attributes } = props
  let slots = Array.from({ length }, (_, index) => index)
  return (
    <div data-slot="input-otp">
      <input
        inputmode="numeric"
        autocomplete="one-time-code"
        pattern={`[0-9]{${length}}`}
        maxlength={length}
        data-bind={signal}
        {...attributes}
      />
      {/* The box the next character goes in is marked, or the last one, once they're all in. */}
      <div data-slot="input-otp-group" aria-hidden="true">
        {slots.map((index) => (
          <div
            data-slot="input-otp-slot"
            data-text={`$${signal}.charAt(${index})`}
            data-class:active={
              index === length - 1
                ? `$${signal}.length >= ${index}`
                : `$${signal}.length == ${index}`
            }
          ></div>
        ))}
      </div>
    </div>
  )
}
