import type { Handle } from 'remix/component'
import { css } from 'remix/component'

import { routes } from '../../../routes.ts'
import { actionsStyle, destructiveButtonStyle, secondaryButtonStyle } from '../styles.ts'

// Deleting a post from its edit page: a button that opens a dialog to confirm. The buttons open
// and close the dialog with command/commandfor, so it works without JavaScript.

const DIALOG_ID = 'delete-post'

export function DeletePostButton() {
  return () => (
    <button
      type="button"
      command="show-modal"
      commandfor={DIALOG_ID}
      mix={[destructiveButtonStyle, deleteButtonStyle]}
    >
      Delete
    </button>
  )
}

// Goes outside the post form, since forms can't nest.
export function DeletePostDialog(handle: Handle<{ id: string }>) {
  return () => {
    let { id } = handle.props
    return (
      <dialog id={DIALOG_ID} aria-labelledby={`${DIALOG_ID}-title`} mix={dialogStyle}>
        <form method="post" action={routes.admin.posts.delete.href({ id })}>
          <h2 id={`${DIALOG_ID}-title`} mix={titleStyle}>
            Delete this post?
          </h2>
          <p>
            It’s removed from the site right away, along with its media files, and this can’t be
            undone.
          </p>
          <div mix={actionsStyle}>
            <button type="submit" mix={destructiveButtonStyle}>
              Delete
            </button>
            <button
              type="button"
              command="close"
              commandfor={DIALOG_ID}
              autoFocus
              mix={secondaryButtonStyle}
            >
              Cancel
            </button>
          </div>
        </form>
      </dialog>
    )
  }
}

// Pushed to the far end of the form's buttons, away from Save.
const deleteButtonStyle = css({ marginLeft: 'auto' })

const dialogStyle = css({
  maxWidth: 'min(28rem, calc(100vw - 2rem))',
  margin: 'auto',
  padding: '1.5rem',
  border: '1px solid var(--border)',
  borderRadius: '0.75rem',
  backgroundColor: 'var(--background)',
  color: 'var(--foreground)',
  overflowWrap: 'anywhere',
  '& form': { display: 'flex', flexDirection: 'column', gap: '1rem' },
  '&::backdrop': { backgroundColor: 'rgb(0 0 0 / 0.5)' },
})

const titleStyle = css({ fontSize: '1.25rem', lineHeight: 1.3 })
