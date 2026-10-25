// shadcn/ui's DropdownMenu, in its base-nova style, as a WAI-ARIA menu button. The browser does
// most of it: the menu is a popover (`popover` and `popovertarget`), so it opens and closes
// without JavaScript, in the top layer, and closes on Escape or a click outside it, giving focus
// back to its trigger. CSS anchor positioning puts it below the trigger, or above when there's
// no room below. Datastar runs what a menu needs beyond that, in the four `data-on` expressions
// on DropdownMenuContent below: arrow keys, Home, and End move between items, Tab closes it, and
// choosing an item closes it. Checkbox and radio items keep their state in a signal.
//
// The trigger and content share an id, which is the content's:
//
//   <DropdownMenuTrigger menu="account" variant="outline">Account</DropdownMenuTrigger>
//   <DropdownMenuContent id="account">
//     <DropdownMenuItem>Profile</DropdownMenuItem>
//   </DropdownMenuContent>
//
// The content must come right after its trigger: the trigger's open style looks for it there.
import type { Child, Html } from '#jsx/jsx-runtime'

import { CheckIcon } from '../icons.tsx'
import { stylesheet } from '../stylesheet.ts'
import { Button, type ButtonProps } from './button.tsx'
import css from './dropdown-menu.css' with { type: 'text' }

export const DROPDOWN_MENU_STYLES = stylesheet(css)

type Props = Record<string, unknown> & { children?: Child }

// An id that's also a CSS name, for the anchor that positions the menu.
function anchorName(id: string): string {
  if (!/^[a-z][\w-]*$/i.test(id)) throw new Error(`Not a menu id: ${id}`)
  return `--${id}`
}

// A signal's name, checked, as it's written into expressions.
function signalName(name: string): string {
  if (!/^[a-z_]\w*(\.[a-z_]\w*)*$/i.test(name)) throw new Error(`Not a signal name: ${name}`)
  return name
}

// A Button that opens the menu.
export function DropdownMenuTrigger(props: ButtonProps & { menu: string }): Html {
  let { menu, ...button } = props
  return (
    <Button
      id={`${menu}-trigger`}
      popovertarget={menu}
      aria-haspopup="menu"
      aria-controls={menu}
      style={`anchor-name: ${anchorName(menu)}`}
      {...button}
    />
  )
}

// What every item is, as a selector: a disabled one (a button, or a link) can't be chosen or
// focused.
const ITEMS = "'[role^=menuitem]:not(:disabled, [aria-disabled=true])'"

// Opened from the keyboard (its trigger has a focus ring), the first item takes focus, as the
// menu button pattern says; opened by a click, the menu does, so arrow keys go to its items.
const FOCUS_ON_OPEN =
  "evt.newState === 'open' && " +
  `(document.activeElement?.matches(':focus-visible') ? el.querySelector(${ITEMS}) : el)?.focus()`

// Arrow keys move to the next or previous item, going round at the ends; Home and End to the
// first and last. Tab closes the menu, and moves on from its trigger.
const MOVE_FOCUS =
  `const items = [...el.querySelectorAll(${ITEMS})], i = items.indexOf(document.activeElement), n = items.length; ` +
  'const next = { ArrowDown: (i + 1) % n, ArrowUp: (i < 1 ? n : i) - 1, Home: 0, End: n - 1 }[evt.key]; ' +
  "if (next !== undefined) { evt.preventDefault(); items[next]?.focus() } else if (evt.key === 'Tab') el.hidePopover()"

// Choosing an item closes the menu; checkbox and radio items keep it open, as in Base UI.
const CLOSE_ON_CHOICE = "evt.target.closest('[role=menuitem]') && el.hidePopover()"

// The item under the pointer takes focus, so it's the one highlighted, whether it was reached by
// pointer or keyboard. Off an item, the menu takes it back.
const FOCUS_ON_HOVER = `(evt.target.closest(${ITEMS}) ?? el).focus()`

export function DropdownMenuContent(props: Props & { id: string }): Html {
  let { id, children, ...attributes } = props
  return (
    <div
      id={id}
      popover
      role="menu"
      tabindex="-1"
      aria-labelledby={`${id}-trigger`}
      data-slot="dropdown-menu-content"
      style={`position-anchor: ${anchorName(id)}`}
      data-on:toggle={FOCUS_ON_OPEN}
      data-on:keydown={MOVE_FOCUS}
      data-on:click={CLOSE_ON_CHOICE}
      data-on:pointermove={FOCUS_ON_HOVER}
      {...attributes}
    >
      {children}
    </div>
  )
}

// Items under a heading, which names the group for screen readers.
export function DropdownMenuGroup(props: Props & { label?: string | undefined }): Html {
  let { label, children, ...attributes } = props
  return (
    <div role="group" aria-label={label} data-slot="dropdown-menu-group" {...attributes}>
      {label ? (
        <div data-slot="dropdown-menu-label" aria-hidden="true">
          {label}
        </div>
      ) : null}
      {children}
    </div>
  )
}

interface ItemProps {
  // Lines its text up with items that have an icon or check mark.
  inset?: boolean | undefined
  disabled?: boolean | undefined
  children?: Child
}

// An action (a <button>, which can submit a form or run a Datastar action), or with an href, a
// link. Items are left out of the tab order: arrow keys move between them. A disabled link has no
// href or tabindex, so it can't be followed or focused, and says it's disabled with aria-disabled.
export function DropdownMenuItem(
  props: Record<string, unknown> &
    ItemProps & { variant?: 'default' | 'destructive' | undefined; href?: string | undefined },
): Html {
  let { variant = 'default', inset, disabled, href, children, ...attributes } = props
  let item = {
    role: 'menuitem',
    'data-slot': 'dropdown-menu-item',
    'data-variant': variant,
    'data-inset': inset,
  }
  if (href !== undefined) {
    let link = disabled ? { 'aria-disabled': 'true' } : { href, tabindex: '-1' }
    return (
      <a {...item} {...link} {...attributes}>
        {children}
      </a>
    )
  }
  return (
    <button type="button" tabindex="-1" disabled={disabled} {...item} {...attributes}>
      {children}
    </button>
  )
}

function Indicator(): Html {
  return (
    <span data-slot="dropdown-menu-item-indicator">
      <CheckIcon />
    </span>
  )
}

// An item that's on or off: a boolean signal, which the page declares with `data-signals`.
export function DropdownMenuCheckboxItem(
  props: ItemProps & { signal: string; checked: boolean },
): Html {
  let { signal, checked, inset, disabled, children } = props
  let name = signalName(signal)
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      tabindex="-1"
      aria-checked={checked ? 'true' : 'false'}
      disabled={disabled}
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      data-attr:aria-checked={`$${name} ? 'true' : 'false'`}
      data-on:click={`$${name} = !$${name}`}
    >
      <Indicator />
      {children}
    </button>
  )
}

// One of several items that set a signal to their value. Put them in a DropdownMenuGroup.
export function DropdownMenuRadioItem(
  props: ItemProps & { signal: string; value: string; checked: boolean },
): Html {
  let { signal, value, checked, inset, disabled, children } = props
  let name = signalName(signal)
  return (
    <button
      type="button"
      role="menuitemradio"
      tabindex="-1"
      aria-checked={checked ? 'true' : 'false'}
      disabled={disabled}
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      data-value={value}
      data-attr:aria-checked={`$${name} === el.dataset.value ? 'true' : 'false'`}
      data-on:click={`$${name} = el.dataset.value`}
    >
      <Indicator />
      {children}
    </button>
  )
}

export function DropdownMenuSeparator(): Html {
  return <div role="separator" data-slot="dropdown-menu-separator"></div>
}

// A keyboard shortcut shown at an item's end. It's only a hint: the page handles the keys.
export function DropdownMenuShortcut(props: { children?: Child }): Html {
  return <span data-slot="dropdown-menu-shortcut">{props.children}</span>
}
