// The composer's controls (see compose.tsx). They're inside <logspace-composer>, a Rocket component
// (src/client/composer.ts) that does the work: these bind to its signals (`$$uploading`) and call
// its actions (`@preview()`) with Datastar attributes, whose expressions are constant strings.
// Without JavaScript, the composer is a plain form, whose files are uploaded when it's posted.
import type { Child, Html } from '#jsx/jsx-runtime'

import { routes } from '../../routes.ts'
import { Tooltip } from '../controls.tsx'
import { CloseIcon, MapPinIcon } from '../icons.tsx'

// The component, around the composer and outside what the server re-renders, so it stays as
// the draft changes. `updates` is the stream of the composer as other tabs change the draft.
export function ComposerElement(props: { updates: string; children: Child }): Html {
  return (
    <logspace-composer
      updates-url={props.updates}
      media-url={routes.admin.newPostMedia()}
      preview-url={routes.admin.newPostPreview()}
    >
      {props.children}
    </logspace-composer>
  )
}

// While typing, the preview follows at most every 100 ms, and once more after the last keystroke.
// A newer preview cancels one still on its way. A modifier's dot can't be in a JSX attribute's
// name, so this one is spread in.
const PREVIEW_ON_INPUT = { 'data-on:input__throttle.100ms.trailing': '@preview()' }

export function ComposerForm(props: { id: string; children: Child }): Html {
  return (
    <form
      id={props.id}
      method="post"
      action={routes.admin.newPost()}
      enctype="multipart/form-data"
      class="composer"
      data-on:submit="@publish()"
      data-on:pageshow__window="evt.persisted && ($$published = false)"
    >
      <div
        role="alert"
        class="alert"
        hidden
        data-attr:hidden="!($$previewError || $$mediaError || $$publishError)"
      >
        Couldn’t complete the request. Your input is still here; check your connection and try
        again.{' '}
        <button
          type="button"
          class="link-button"
          hidden
          data-attr:hidden="!$$mediaError"
          data-on:click="@retryMedia()"
        >
          Retry media change
        </button>
      </div>
      {props.children}
    </form>
  )
}

// Grows with what's typed (see .composer-text), like X's. Cmd or Ctrl + Enter posts, as on X.
export function CaptionInput(props: { value: string }): Html {
  return (
    // A textarea drops a newline right after its start tag, so one goes there, and a value that
    // starts with a newline keeps it.
    <textarea
      name="caption"
      rows={3}
      aria-label="Caption"
      placeholder="What’s happening?"
      autofocus
      class="composer-text"
      {...PREVIEW_ON_INPUT}
      data-on:keydown="(evt.metaKey || evt.ctrlKey) && evt.key === 'Enter' && (evt.preventDefault(), el.form.requestSubmit())"
    >
      {`\n${props.value}`}
    </textarea>
  )
}

// Where it was written: a map pin that shows the city's input beside it, which is shown when
// there's a city. Hiding it clears the city, and the preview follows. Without JavaScript, the
// input is always shown.
const CITY_LABEL = "$$city ? 'Remove location' : 'Add location'"

export function CityInput(props: { value: string }): Html {
  let label = props.value ? 'Remove location' : 'Add location'
  return (
    <>
      <Tooltip label={<span data-text={CITY_LABEL}>{label}</span>}>
        <button
          type="button"
          aria-label={label}
          class="tool-button"
          data-on:click="@toggleCity()"
          data-attr:aria-label={CITY_LABEL}
        >
          <MapPinIcon />
        </button>
      </Tooltip>
      <input
        name="city"
        value={props.value}
        aria-label="City"
        placeholder="City"
        class="input city-input"
        data-show="$$city"
        {...PREVIEW_ON_INPUT}
      />
    </>
  )
}

// Starts at the newest post's offset, for a browser without JavaScript; the component sets the
// browser's, which a morph keeps when another tab's change comes in.
export function OffsetInput(props: { value: string }): Html {
  return <input type="hidden" name="offset" value={props.value} data-preserve-attr="value" />
}

// The article's title or summary, which the preview follows.
export function ArticleTextInput(props: {
  name: 'article_title' | 'article_summary'
  value: string
  label: string
  class: string
}): Html {
  return (
    <input
      name={props.name}
      value={props.value}
      aria-label={props.label}
      placeholder={props.label}
      class={props.class}
      {...PREVIEW_ON_INPUT}
    />
  )
}

// An icon button (or with `text`, its label as a link) that chooses files, which are uploaded
// right away.
export function MediaPicker(props: {
  label: string
  name: string
  accept: string
  multiple?: boolean | undefined
  disabled?: boolean | undefined
  text?: boolean | undefined
  children?: Child | undefined
}): Html {
  let { label, name, accept, multiple, disabled, text, children } = props
  let button = (
    <label class={text ? 'link-button' : 'tool-button'} data-disabled={disabled}>
      {text ? label : children}
      <input
        type="file"
        name={name}
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        aria-label={label}
        class="visually-hidden"
        data-on:change="@updateMedia()"
      />
    </label>
  )
  return text ? button : <Tooltip label={label}>{button}</Tooltip>
}

// Takes one file (or the article) out of the post: a round × over its tile, or with `text`, the
// label as a link. It needs JavaScript; without it, media can only be added.
export function RemoveMediaButton(props: {
  file?: string | undefined
  label: string
  text?: boolean | undefined
}): Html {
  let { file, label, text } = props
  return (
    <button
      type="button"
      name={file === undefined ? 'remove_article' : 'remove'}
      value={file ?? 'article'}
      aria-label={text ? undefined : label}
      title={text ? undefined : label}
      class={text ? 'link-button' : 'remove-button'}
      data-on:click="@updateMedia()"
    >
      {text ? label : <CloseIcon />}
    </button>
  )
}

// What the server's HTML asks the component to do once, as it arrives (see onPatched in
// src/client/composer.ts): update the preview once the media is re-rendered, empty the file
// inputs when what was chosen can't be sent, or go to the post once it's published.
export function PreviewRefresh(): Html {
  return <span hidden data-refresh />
}

export function ClearFiles(): Html {
  return <span hidden data-clear-files />
}

export function Redirect(props: { href: string }): Html {
  return <span hidden data-redirect={props.href} />
}

// The values the server saved as the draft, which become the fields' defaults (see onPatched).
export function SavedDefaults(props: { id: string; values: Record<string, string> }): Html {
  return <span hidden data-post-id={props.id} data-saved-values={JSON.stringify(props.values)} />
}

// Shown while media is uploading.
export function UploadingNote(): Html {
  return (
    <span role="status" hidden class="uploading muted" data-attr:hidden="!$$uploading">
      <span class="spinner" aria-hidden="true" />
      Uploading…
    </span>
  )
}

export function PostButton(): Html {
  return (
    <button
      type="submit"
      class="button post-button"
      data-attr:disabled="$$uploading || $$posting || $$published"
    >
      Post
    </button>
  )
}
