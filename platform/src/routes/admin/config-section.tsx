import type { Child, Html } from '#jsx/jsx-runtime'
import { CaretDownIcon } from '../../components/icons.tsx'
import { stylesheet } from '../../components/stylesheet.ts'
import { Separator, SEPARATOR_STYLES } from '../../components/ui/separator.tsx'
import css from './config-section.css' with { type: 'text' }

export const CONFIG_SECTION_STYLES = SEPARATOR_STYLES + stylesheet(css)

// A service's name and status, which open to its settings, with a line above to set it apart from
// the one before (the page closes the last with another).
export function ConfigSection(props: {
  id: string
  title: string
  badge: Html
  open: boolean
  preserveOpen?: boolean
  children: Child
}): Html {
  let { id, title, badge, open, preserveOpen, children } = props
  return (
    <>
      <Separator />
      <details open={open} data-preserve-attr={preserveOpen ? 'open' : undefined}>
        <summary class="config-section-summary">
          <h2 id={`${id}-heading`}>{title}</h2>
          {badge}
          <CaretDownIcon class="config-section-caret" />
        </summary>
        <section class="config-section-body" aria-labelledby={`${id}-heading`}>
          {children}
        </section>
      </details>
    </>
  )
}
