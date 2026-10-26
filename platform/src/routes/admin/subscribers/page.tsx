import type { Html } from '#jsx/jsx-runtime'

import { DotsThreeIcon, TrashIcon } from '../../../components/icons.tsx'
import { stylesheet } from '../../../components/stylesheet.ts'
import { Alert, ALERT_STYLES, AlertDescription, AlertTitle } from '../../../components/ui/alert.tsx'
import { Button } from '../../../components/ui/button.tsx'
import {
  DialogClose,
  DialogContent,
  DialogFooter,
  DIALOG_STYLES,
} from '../../../components/ui/dialog.tsx'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DROPDOWN_MENU_STYLES,
} from '../../../components/ui/dropdown-menu.tsx'
import {
  Field,
  FieldContent,
  FieldDescription,
  FIELD_STYLES,
  FieldLabel,
} from '../../../components/ui/field.tsx'
import { Switch, SWITCH_STYLES } from '../../../components/ui/switch.tsx'
import { formatPostDate } from '../../../data/posts/format.ts'
import type { SubscriptionsBlocker, SubscriptionsStatus } from '../../../data/site/subscriptions.ts'
import type { User } from '../../../data/users/user.ts'
import { urls } from '../../../lib/urls.ts'
import { BackLink } from '../layout.tsx'
import css from './page.css' with { type: 'text' }

export const SUBSCRIBERS_PAGE_STYLES =
  FIELD_STYLES +
  SWITCH_STYLES +
  ALERT_STYLES +
  DROPDOWN_MENU_STYLES +
  DIALOG_STYLES +
  stylesheet(css)

const BLOCKERS: Record<SubscriptionsBlocker, string> = {
  EmailNotSetUp: 'Email isn’t set up.',
  EmailSecretUnreadable: 'Email’s saved secret can’t be read. Enter it again.',
  TurnstileNotSetUp: 'Cloudflare Turnstile isn’t set up.',
  TurnstileSecretUnreadable:
    'Cloudflare Turnstile’s saved secret key can’t be read. Enter it again.',
  TurnstileNotEnabled: 'Cloudflare Turnstile isn’t enabled.',
}

// /admin/subscribers: the switch for subscribing, and while it can't be switched on, or is on but
// paused, why; then everyone subscribed, newest first.
export function SubscribersPage(props: {
  status: SubscriptionsStatus
  subscribers: readonly User[]
}): Html {
  let { status, subscribers } = props
  let missing = status._tag === 'Open' ? [] : status.missing
  // It can always be switched off, but on only once nothing's missing.
  let locked = status._tag === 'Off' && missing.length > 0
  return (
    <section class="admin-page">
      <BackLink />
      <h1 class="page-title">Subscribers</h1>
      <form method="post" action={urls.admin.subscribers()} class="subscriptions-form">
        <Field orientation="horizontal" disabled={locked}>
          <FieldContent>
            <FieldLabel for="subscriptions-enabled">Enable subscriptions</FieldLabel>
            <FieldDescription id="subscriptions-enabled-description">
              The home page shows a Subscribe button. Subscribing makes an account, once the address
              is confirmed with a code sent to it.
            </FieldDescription>
          </FieldContent>
          {/* Changing it saves it. Without JavaScript, the Save button below does. */}
          <Switch
            id="subscriptions-enabled"
            name="enabled"
            checked={status._tag !== 'Off'}
            disabled={locked}
            aria-describedby="subscriptions-enabled-description"
            data-on:change="el.form.requestSubmit()"
          />
        </Field>
        <noscript>
          <Button type="submit" variant="outline" disabled={locked}>
            Save
          </Button>
        </noscript>
      </form>
      {missing.length > 0 ? (
        <Alert variant={status._tag === 'Paused' ? 'destructive' : 'default'}>
          <AlertTitle>
            {status._tag === 'Paused'
              ? 'Subscribing is paused, and the home page doesn’t show the Subscribe button.'
              : 'Subscriptions need email set up and Cloudflare Turnstile enabled.'}
          </AlertTitle>
          <AlertDescription>
            <ul>
              {missing.map((blocker) => (
                <li>{BLOCKERS[blocker]}</li>
              ))}
            </ul>
            <p>
              Set them up in <a href={urls.admin.integrations()}>Integrations</a>.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}
      {subscribers.length === 0 ? (
        <p class="muted">No subscribers yet.</p>
      ) : (
        <>
          <table class="subscriber-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Signed up</th>
                <th>
                  <span class="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {subscribers.map((subscriber, i) => (
                <SubscriberRow subscriber={subscriber} index={i} />
              ))}
            </tbody>
          </table>
          {subscribers.map((subscriber, i) => (
            <DeleteSubscriberDialog subscriber={subscriber} index={i} />
          ))}
        </>
      )}
    </section>
  )
}

const menuId = (index: number) => `subscriber-${index}`
const dialogId = (index: number) => `delete-subscriber-${index}`

// A subscriber, with a menu of what can be done with them: for now, deleting them, which opens
// the dialog below, as the menu closes.
function SubscriberRow(props: { subscriber: User; index: number }): Html {
  let { subscriber, index } = props
  return (
    <tr>
      <td data-ignore>{subscriber.name}</td>
      <td data-ignore>{subscriber.email}</td>
      <td>
        <time datetime={subscriber.createdAt}>{formatPostDate(subscriber.createdAt)}</time>
      </td>
      <td>
        <DropdownMenuTrigger
          menu={menuId(index)}
          variant="ghost"
          size="icon-sm"
          aria-label={`Actions for ${subscriber.email}`}
        >
          <DotsThreeIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent id={menuId(index)}>
          <DropdownMenuItem variant="destructive" command="show-modal" commandfor={dialogId(index)}>
            <TrashIcon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </td>
    </tr>
  )
}

// Deleting a subscriber, confirmed. It's outside the table, so its text wraps as a dialog's does.
function DeleteSubscriberDialog(props: { subscriber: User; index: number }): Html {
  let { subscriber, index } = props
  return (
    <DialogContent
      id={dialogId(index)}
      title="Delete this subscriber?"
      description={
        <>
          <span data-ignore>{subscriber.email}</span>’s account is deleted, and they’re no longer
          subscribed. They can subscribe again.
        </>
      }
    >
      <form method="post" action={urls.admin.deleteSubscriber(subscriber.id)}>
        <DialogFooter>
          <DialogClose dialog={dialogId(index)} variant="outline" autofocus>
            Cancel
          </DialogClose>
          <Button type="submit" variant="destructive">
            Delete
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
