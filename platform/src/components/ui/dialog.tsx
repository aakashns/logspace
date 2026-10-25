// shadcn/ui's Dialog, in its base-nova style, with no JavaScript: a native <dialog>, which the
// trigger opens as a modal with `command="show-modal"`. The browser keeps focus in it, makes the
// rest of the page inert, closes it on Escape (and with `closedby="any"`, a click outside it),
// and gives focus back to the trigger. A button with `autofocus` inside it takes focus when it
// opens; otherwise the first one that can does.
//
//   <DialogTrigger dialog="rename" variant="outline">Rename</DialogTrigger>
//   <DialogContent id="rename" title="Rename post" description="…">
//     <form>… <DialogFooter>…</DialogFooter></form>
//   </DialogContent>
import type { Child, Html } from '#jsx/jsx-runtime'

import { CloseIcon } from '../icons.tsx'
import { stylesheet } from '../stylesheet.ts'
import { Button, type ButtonProps } from './button.tsx'
import css from './dialog.css' with { type: 'text' }

export const DIALOG_STYLES = stylesheet(css)

// A Button that opens the dialog with this id.
export function DialogTrigger(props: ButtonProps & { dialog: string }): Html {
  let { dialog, ...button } = props
  return (
    <Button
      command="show-modal"
      commandfor={dialog}
      aria-haspopup="dialog"
      aria-controls={dialog}
      {...button}
    />
  )
}

// A Button that closes the dialog with this id, like a footer's Cancel.
export function DialogClose(props: ButtonProps & { dialog: string }): Html {
  let { dialog, ...button } = props
  return <Button command="close" commandfor={dialog} {...button} />
}

// The dialog, named by its title and described by its description, with a close button at its
// top right.
export function DialogContent(
  props: Record<string, unknown> & {
    id: string
    title: Child
    description?: Child
    closeButton?: boolean | undefined
    children?: Child
  },
): Html {
  let { id, title, description, closeButton = true, children, ...attributes } = props
  return (
    <dialog
      id={id}
      closedby="any"
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-description` : undefined}
      data-slot="dialog-content"
      {...attributes}
    >
      <div data-slot="dialog-header">
        <h2 id={`${id}-title`} data-slot="dialog-title">
          {title}
        </h2>
        {description ? (
          <p id={`${id}-description`} data-slot="dialog-description">
            {description}
          </p>
        ) : null}
      </div>
      {children}
      {closeButton ? (
        <DialogClose dialog={id} variant="ghost" size="icon-sm" aria-label="Close">
          <CloseIcon />
        </DialogClose>
      ) : null}
    </dialog>
  )
}

// The dialog's buttons, along its bottom: a column with the first button last on small screens,
// and a row at the end from 40rem wide.
export function DialogFooter(props: Record<string, unknown> & { children?: Child }): Html {
  let { children, ...attributes } = props
  return (
    <div data-slot="dialog-footer" {...attributes}>
      {children}
    </div>
  )
}
