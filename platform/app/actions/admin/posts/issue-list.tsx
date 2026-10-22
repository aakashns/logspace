import type { Handle } from 'remix/component'

import { alertStyle } from '../styles.ts'
import type { FormIssue } from './form-values.ts'

// Why a submitted post wasn't saved, one issue per line.
export function IssueList(handle: Handle<{ issues: FormIssue[] }>) {
  return () => (
    <div role="alert" mix={alertStyle}>
      <p>The post wasn’t saved:</p>
      <ul>
        {handle.props.issues.map((issue) => (
          <li>
            {issue.field ? `${fieldLabel(issue.field)}: ` : ''}
            {issue.message}
          </li>
        ))}
      </ul>
    </div>
  )
}

// How an issue's field reads, e.g. "Photo 2 alt text" for "photos.1.alt".
function fieldLabel(field: string) {
  let parts = field.split('.')
  let name = (key: string | undefined) =>
    key === undefined ? '' : (FIELD_NAMES[key] ?? key.replaceAll('_', ' '))
  if (parts[0] === 'photos') {
    return parts.length === 1 ? 'Photos' : `Photo ${Number(parts[1]) + 1} ${name(parts[2])}`
  }
  if (parts[0] === 'video') return `Video ${name(parts[1])}`
  if (parts[0] === 'article') {
    return parts[1] === 'cover' ? `Cover photo ${name(parts[2])}` : `Article ${name(parts[1])}`
  }
  return name(parts[0]).replace(/^./, (c) => c.toUpperCase())
}

const FIELD_NAMES: Record<string, string> = { alt: 'alt text', id: 'id' }
