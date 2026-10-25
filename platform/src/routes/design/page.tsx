import type { Child, Html } from '#jsx/jsx-runtime'

import { PhosphorIcon } from '../../components/icons.tsx'
import { stylesheet } from '../../components/stylesheet.ts'
import { Alert, ALERT_STYLES, AlertDescription, AlertTitle } from '../../components/ui/alert.tsx'
import { Badge, BADGE_STYLES } from '../../components/ui/badge.tsx'
import { Button } from '../../components/ui/button.tsx'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  CARD_STYLES,
} from '../../components/ui/card.tsx'
import { Checkbox, CHECKBOX_STYLES } from '../../components/ui/checkbox.tsx'
import {
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTrigger,
  DIALOG_STYLES,
} from '../../components/ui/dialog.tsx'
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  DROPDOWN_MENU_STYLES,
} from '../../components/ui/dropdown-menu.tsx'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FIELD_STYLES,
  Label,
} from '../../components/ui/field.tsx'
import { Input, INPUT_STYLES } from '../../components/ui/input.tsx'
import { Kbd, KbdGroup, KBD_STYLES } from '../../components/ui/kbd.tsx'
import { NativeSelect, NATIVE_SELECT_STYLES } from '../../components/ui/native-select.tsx'
import { Separator, SEPARATOR_STYLES } from '../../components/ui/separator.tsx'
import { Switch, SWITCH_STYLES } from '../../components/ui/switch.tsx'
import { Textarea, TEXTAREA_STYLES } from '../../components/ui/textarea.tsx'
import css from './page.css' with { type: 'text' }

// Every page has Button's (see document.tsx).
export const DESIGN_PAGE_STYLES =
  BADGE_STYLES +
  INPUT_STYLES +
  TEXTAREA_STYLES +
  NATIVE_SELECT_STYLES +
  FIELD_STYLES +
  CHECKBOX_STYLES +
  SWITCH_STYLES +
  CARD_STYLES +
  DROPDOWN_MENU_STYLES +
  DIALOG_STYLES +
  ALERT_STYLES +
  KBD_STYLES +
  SEPARATOR_STYLES +
  stylesheet(css)

type Scheme = 'light' | 'dark'

// /design: every component in components/ui, side by side in the light and dark themes.
export function DesignPage(): Html {
  return (
    <div class="design">
      <h1 class="page-title">Design</h1>
      <p class="design-intro">
        The components in <code>src/components/ui</code>, after shadcn/ui’s base-nova style, in both
        themes. Only served outside production.
      </p>
      <div class="design-panels">
        <Showcase scheme="light" />
        <Showcase scheme="dark" />
      </div>
    </div>
  )
}

// Every component in one theme. Ids and signals start with the theme's name, so the two copies
// don't share them.
function Showcase(props: { scheme: Scheme }): Html {
  let s = props.scheme
  return (
    <section
      class="design-panel"
      data-scheme={s}
      aria-labelledby={`${s}-heading`}
      data-signals={`{${s}: {statusBar: true, activityBar: false, position: 'bottom'}}`}
    >
      <h2 id={`${s}-heading`} class="design-panel-title">
        {s === 'light' ? 'Light' : 'Dark'}
      </h2>
      <Buttons scheme={s} />
      <Badges />
      <Inputs scheme={s} />
      <Choices scheme={s} />
      <Cards scheme={s} />
      <Menus scheme={s} />
      <Dialogs scheme={s} />
      <Alerts />
      <Keys />
    </section>
  )
}

function Section(props: { title: string; children: Child }): Html {
  return (
    <div class="design-section">
      <h3>{props.title}</h3>
      {props.children}
    </div>
  )
}

function Buttons(props: { scheme: Scheme }): Html {
  return (
    <Section title="Button">
      <div class="design-row">
        <Button>Default</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="link">Link</Button>
      </div>
      <div class="design-row">
        <Button variant="outline" size="xs">
          Extra small
        </Button>
        <Button variant="outline" size="sm">
          Small
        </Button>
        <Button variant="outline">Default</Button>
        <Button variant="outline" size="lg">
          Large
        </Button>
      </div>
      <div class="design-row">
        <Button variant="outline" size="icon-xs" aria-label="New post (extra small)">
          <PlusIcon />
        </Button>
        <Button variant="outline" size="icon-sm" aria-label="New post (small)">
          <PlusIcon />
        </Button>
        <Button variant="outline" size="icon" aria-label="New post">
          <PlusIcon />
        </Button>
        <Button variant="outline" size="icon-lg" aria-label="New post (large)">
          <PlusIcon />
        </Button>
        <Button>
          <PlusIcon data-icon="inline-start" />
          New post
        </Button>
        <Button variant="secondary">
          Continue
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </div>
      <div class="design-row">
        <Button disabled>Disabled</Button>
        <Button variant="outline" aria-invalid="true">
          Invalid
        </Button>
        <Button href={`#${props.scheme}-heading`} variant="outline">
          A link
        </Button>
        <Button href={`#${props.scheme}-heading`} variant="outline" disabled>
          Disabled link
        </Button>
        <Button variant="ghost">
          <TrashIcon data-icon="inline-start" />
          Remove
        </Button>
      </div>
    </Section>
  )
}

function Badges(): Html {
  return (
    <Section title="Badge">
      <div class="design-row">
        <Badge>Default</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Badge variant="destructive">Destructive</Badge>
        <Badge variant="outline">Outline</Badge>
        <Badge variant="ghost">Ghost</Badge>
        <Badge variant="link" href="#">
          Link
        </Badge>
        <Badge variant="secondary">
          <CheckCircleIcon data-icon="inline-start" />
          Connected
        </Badge>
      </div>
    </Section>
  )
}

function Inputs(props: { scheme: Scheme }): Html {
  let id = (name: string) => `${props.scheme}-${name}`
  return (
    <Section title="Input, Textarea, and Native Select">
      <FieldGroup>
        <Field>
          <FieldLabel for={id('email')}>Email</FieldLabel>
          <Input
            id={id('email')}
            type="email"
            placeholder="you@example.com"
            aria-describedby={id('email-description')}
          />
          <FieldDescription id={id('email-description')}>
            Where replies to your posts go.
          </FieldDescription>
        </Field>
        <Field invalid>
          <FieldLabel for={id('url')}>Site URL</FieldLabel>
          <Input
            id={id('url')}
            value="example"
            aria-invalid="true"
            aria-describedby={id('url-error')}
          />
          <FieldError id={id('url-error')}>Enter a URL, like https://example.com.</FieldError>
        </Field>
        <Field disabled>
          <FieldLabel for={id('disabled')}>Disabled</FieldLabel>
          <Input id={id('disabled')} value="Can’t change this" disabled />
        </Field>
        <Field>
          <FieldLabel for={id('file')}>Photo</FieldLabel>
          <Input id={id('file')} type="file" accept="image/*" />
        </Field>
        <Field>
          <FieldLabel for={id('bio')}>Introduction</FieldLabel>
          <Textarea id={id('bio')} placeholder="A sentence or two about you" />
        </Field>
        <Field>
          <FieldLabel for={id('timezone')}>Time zone</FieldLabel>
          <NativeSelect id={id('timezone')}>
            <option value="utc">UTC</option>
            <option value="ist" selected>
              India (IST)
            </option>
            <option value="pt">Pacific Time</option>
          </NativeSelect>
        </Field>
      </FieldGroup>
    </Section>
  )
}

function Choices(props: { scheme: Scheme }): Html {
  let id = (name: string) => `${props.scheme}-${name}`
  return (
    <Section title="Checkbox, Switch, and Label">
      <FieldGroup>
        <Field orientation="horizontal">
          <Checkbox id={id('terms')} checked />
          <FieldLabel for={id('terms')}>Accept the terms</FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <Checkbox id={id('newsletter')} aria-describedby={id('newsletter-description')} />
          <FieldContent>
            <FieldLabel for={id('newsletter')}>Email me new posts</FieldLabel>
            <FieldDescription id={id('newsletter-description')}>
              One email a week at most.
            </FieldDescription>
          </FieldContent>
        </Field>
        <Field orientation="horizontal">
          <Checkbox id={id('locked')} disabled />
          <FieldLabel for={id('locked')}>Disabled</FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <Switch id={id('comments')} checked />
          <FieldLabel for={id('comments')}>Comments</FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <Switch id={id('compact')} size="sm" />
          <FieldLabel for={id('compact')}>Compact (small)</FieldLabel>
        </Field>
        <FieldSet>
          <FieldLegend variant="label">Show on posts</FieldLegend>
          <FieldDescription>What each post shows under its caption.</FieldDescription>
          <FieldGroup>
            <Field orientation="horizontal">
              <Checkbox id={id('show-date')} checked />
              <FieldLabel for={id('show-date')}>Date</FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <Checkbox id={id('show-share')} />
              <FieldLabel for={id('show-share')}>Share button</FieldLabel>
            </Field>
          </FieldGroup>
        </FieldSet>
        <div class="design-row">
          <Label>A Label on its own</Label>
        </div>
      </FieldGroup>
    </Section>
  )
}

function Cards(props: { scheme: Scheme }): Html {
  let id = (name: string) => `${props.scheme}-${name}`
  return (
    <Section title="Card">
      <Card>
        <CardHeader>
          <CardTitle as="h4">Log in to your site</CardTitle>
          <CardDescription>Enter the admin password to manage your posts.</CardDescription>
          <CardAction>
            <Button variant="link" href="#">
              Forgot it?
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <Field>
            <FieldLabel for={id('password')}>Admin password</FieldLabel>
            <Input id={id('password')} type="password" />
          </Field>
        </CardContent>
        <CardFooter class="design-card-footer">
          <Button variant="outline">Cancel</Button>
          <Button>Log in</Button>
        </CardFooter>
      </Card>
      <Card size="sm">
        <CardHeader>
          <CardTitle as="h4">A small card</CardTitle>
          <CardDescription>With 0.75rem of spacing instead of 1rem.</CardDescription>
        </CardHeader>
        <CardContent>
          <p>Its content, in the card’s 0.875rem text.</p>
        </CardContent>
      </Card>
    </Section>
  )
}

function Menus(props: { scheme: Scheme }): Html {
  let s = props.scheme
  return (
    <Section title="Dropdown Menu">
      <div class="design-row">
        <DropdownMenuTrigger menu={`${s}-menu`} variant="outline">
          Open menu
        </DropdownMenuTrigger>
        <DropdownMenuContent id={`${s}-menu`} class="design-menu">
          <DropdownMenuGroup label="My account">
            <DropdownMenuItem>
              <UserIcon />
              Profile
              <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <GearIcon />
              Settings
              <DropdownMenuShortcut>⌘,</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              <CopyIcon />
              Copy link (disabled)
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup label="Appearance">
            <DropdownMenuCheckboxItem signal={`${s}.statusBar`} checked>
              Status bar
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem signal={`${s}.activityBar`} checked={false}>
              Activity bar
            </DropdownMenuCheckboxItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup label="Panel position">
            <DropdownMenuRadioItem signal={`${s}.position`} value="top" checked={false}>
              Top
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem signal={`${s}.position`} value="bottom" checked>
              Bottom
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem signal={`${s}.position`} value="right" checked={false}>
              Right
            </DropdownMenuRadioItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem href="https://github.com/aakashns/logspace" inset>
            GitHub
          </DropdownMenuItem>
          <DropdownMenuItem href={`#${s}-heading`} inset disabled>
            Changelog (disabled)
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive">
            <TrashIcon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
        <DropdownMenuTrigger
          menu={`${s}-actions`}
          variant="ghost"
          size="icon"
          aria-label="More actions"
        >
          <DotsThreeIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent id={`${s}-actions`}>
          <DropdownMenuItem>
            <PencilIcon />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem>
            <CopyIcon />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive">
            <TrashIcon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </div>
      {/* The menu's signals, as Datastar keeps them. */}
      <p class="design-note">
        Status bar <code data-text={`$${s}.statusBar ? 'on' : 'off'`}>on</code>, activity bar{' '}
        <code data-text={`$${s}.activityBar ? 'on' : 'off'`}>off</code>, panel at the{' '}
        <code data-text={`$${s}.position`}>bottom</code>.
      </p>
    </Section>
  )
}

function Dialogs(props: { scheme: Scheme }): Html {
  let id = (name: string) => `${props.scheme}-${name}`
  return (
    <Section title="Dialog">
      <div class="design-row">
        <DialogTrigger dialog={id('dialog')} variant="outline">
          Edit profile
        </DialogTrigger>
      </div>
      <DialogContent
        id={id('dialog')}
        title="Edit profile"
        description="Make changes to your profile here. Save when you’re done."
      >
        <form method="dialog" class="design-form">
          <Field>
            <FieldLabel for={id('name')}>Name</FieldLabel>
            <Input id={id('name')} value="Aakash" />
          </Field>
          <Field>
            <FieldLabel for={id('username')}>Username</FieldLabel>
            <Input id={id('username')} value="@aakashns" />
          </Field>
          <DialogFooter>
            <DialogClose dialog={id('dialog')} variant="outline">
              Cancel
            </DialogClose>
            <Button type="submit">Save changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Section>
  )
}

function Alerts(): Html {
  return (
    <Section title="Alert">
      <Alert role="status">
        <InfoIcon />
        <AlertTitle>Saved</AlertTitle>
        <AlertDescription>Your site’s settings are saved and live.</AlertDescription>
      </Alert>
      <Alert variant="destructive" role="note">
        <WarningCircleIcon />
        <AlertTitle>The post wasn’t saved</AlertTitle>
        <AlertDescription>
          <p>Check what’s highlighted below, then try again.</p>
        </AlertDescription>
      </Alert>
    </Section>
  )
}

function Keys(): Html {
  return (
    <Section title="Kbd and Separator">
      <div class="design-row">
        <KbdGroup>
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
        <Kbd>Esc</Kbd>
        <Kbd>⇧</Kbd>
      </div>
      <div>
        <p>LogSpace</p>
        <p class="design-note">A place for your posts.</p>
      </div>
      <Separator />
      <div class="design-row design-separated">
        <span>Posts</span>
        <Separator orientation="vertical" />
        <span>Branding</span>
        <Separator orientation="vertical" />
        <span>Integrations</span>
      </div>
    </Section>
  )
}

// Phosphor icons for the examples. `data-icon` trims a button's padding on the icon's side.
type IconProps = { 'data-icon'?: 'inline-start' | 'inline-end' }

const PlusIcon = (props: IconProps) => (
  <PhosphorIcon
    {...props}
    d="M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z"
  />
)
const ArrowRightIcon = (props: IconProps) => (
  <PhosphorIcon
    {...props}
    d="M221.66,133.66l-72,72a8,8,0,0,1-11.32-11.32L196.69,136H40a8,8,0,0,1,0-16H196.69L138.34,61.66a8,8,0,0,1,11.32-11.32l72,72A8,8,0,0,1,221.66,133.66Z"
  />
)
const TrashIcon = (props: IconProps) => (
  <PhosphorIcon
    {...props}
    d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z"
  />
)
const CheckCircleIcon = (props: IconProps) => (
  <PhosphorIcon
    {...props}
    d="M173.66,98.34a8,8,0,0,1,0,11.32l-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35A8,8,0,0,1,173.66,98.34ZM232,128A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z"
  />
)
const UserIcon = (props: IconProps) => (
  <PhosphorIcon
    {...props}
    d="M230.92,212c-15.23-26.33-38.7-45.21-66.09-54.16a72,72,0,1,0-73.66,0C63.78,166.78,40.31,185.66,25.08,212a8,8,0,1,0,13.85,8c18.84-32.56,52.14-52,89.07-52s70.23,19.44,89.07,52a8,8,0,1,0,13.85-8ZM72,96a56,56,0,1,1,56,56A56.06,56.06,0,0,1,72,96Z"
  />
)
const GearIcon = (props: IconProps) => (
  <PhosphorIcon
    {...props}
    d="M128,80a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Zm88-29.84q.06-2.16,0-4.32l14.92-18.64a8,8,0,0,0,1.48-7.06,107.21,107.21,0,0,0-10.88-26.25,8,8,0,0,0-6-3.93l-23.72-2.64q-1.48-1.56-3-3L186,40.54a8,8,0,0,0-3.94-6,107.71,107.71,0,0,0-26.25-10.87,8,8,0,0,0-7.06,1.49L130.16,40Q128,40,125.84,40L107.2,25.11a8,8,0,0,0-7.06-1.48A107.6,107.6,0,0,0,73.89,34.51a8,8,0,0,0-3.93,6L67.32,64.27q-1.56,1.49-3,3L40.54,70a8,8,0,0,0-6,3.94,107.71,107.71,0,0,0-10.87,26.25,8,8,0,0,0,1.49,7.06L40,125.84Q40,128,40,130.16L25.11,148.8a8,8,0,0,0-1.48,7.06,107.21,107.21,0,0,0,10.88,26.25,8,8,0,0,0,6,3.93l23.72,2.64q1.49,1.56,3,3L70,215.46a8,8,0,0,0,3.94,6,107.71,107.71,0,0,0,26.25,10.87,8,8,0,0,0,7.06-1.49L125.84,216q2.16.06,4.32,0l18.64,14.92a8,8,0,0,0,7.06,1.48,107.21,107.21,0,0,0,26.25-10.88,8,8,0,0,0,3.93-6l2.64-23.72q1.56-1.48,3-3L215.46,186a8,8,0,0,0,6-3.94,107.71,107.71,0,0,0,10.87-26.25,8,8,0,0,0-1.49-7.06Zm-16.1-6.5a73.93,73.93,0,0,1,0,8.68,8,8,0,0,0,1.74,5.48l14.19,17.73a91.57,91.57,0,0,1-6.23,15L187,173.11a8,8,0,0,0-5.1,2.64,74.11,74.11,0,0,1-6.14,6.14,8,8,0,0,0-2.64,5.1l-2.51,22.58a91.32,91.32,0,0,1-15,6.23l-17.74-14.19a8,8,0,0,0-5-1.75h-.48a73.93,73.93,0,0,1-8.68,0,8,8,0,0,0-5.48,1.74L100.45,215.8a91.57,91.57,0,0,1-15-6.23L82.89,187a8,8,0,0,0-2.64-5.1,74.11,74.11,0,0,1-6.14-6.14,8,8,0,0,0-5.1-2.64L46.43,170.6a91.32,91.32,0,0,1-6.23-15l14.19-17.74a8,8,0,0,0,1.74-5.48,73.93,73.93,0,0,1,0-8.68,8,8,0,0,0-1.74-5.48L40.2,100.45a91.57,91.57,0,0,1,6.23-15L69,82.89a8,8,0,0,0,5.1-2.64,74.11,74.11,0,0,1,6.14-6.14A8,8,0,0,0,82.89,69L85.4,46.43a91.32,91.32,0,0,1,15-6.23l17.74,14.19a8,8,0,0,0,5.48,1.74,73.93,73.93,0,0,1,8.68,0,8,8,0,0,0,5.48-1.74L155.55,40.2a91.57,91.57,0,0,1,15,6.23L173.11,69a8,8,0,0,0,2.64,5.1,74.11,74.11,0,0,1,6.14,6.14,8,8,0,0,0,5.1,2.64l22.58,2.51a91.32,91.32,0,0,1,6.23,15l-14.19,17.74A8,8,0,0,0,199.87,123.66Z"
  />
)
const CopyIcon = (props: IconProps) => (
  <PhosphorIcon
    {...props}
    d="M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z"
  />
)
const PencilIcon = (props: IconProps) => (
  <PhosphorIcon
    {...props}
    d="M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.68,147.31,64l24-24L216,84.68Z"
  />
)
const DotsThreeIcon = (props: IconProps) => (
  <PhosphorIcon
    {...props}
    d="M140,128a12,12,0,1,1-12-12A12,12,0,0,1,140,128Zm56-12a12,12,0,1,0,12,12A12,12,0,0,0,196,116ZM60,116a12,12,0,1,0,12,12A12,12,0,0,0,60,116Z"
  />
)
const InfoIcon = (props: IconProps) => (
  <PhosphorIcon
    {...props}
    d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm16-40a8,8,0,0,1-8,8,16,16,0,0,1-16-16V128a8,8,0,0,1,0-16,16,16,0,0,1,16,16v40A8,8,0,0,1,144,176ZM112,84a12,12,0,1,1,12,12A12,12,0,0,1,112,84Z"
  />
)
const WarningCircleIcon = (props: IconProps) => (
  <PhosphorIcon
    {...props}
    d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm-8-80V80a8,8,0,0,1,16,0v56a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,172Z"
  />
)
