// What's wrong with a submitted form, from the schema it's checked with.
import { SchemaIssue } from 'effect'

// A problem with one value. `field` is the path to it, like "photos.0.file".
export interface Issue {
  readonly field?: string
  readonly message: string
}

const format = SchemaIssue.makeFormatterStandardSchemaV1()

// Every problem a schema found, each with the path to its value.
export function toIssues(issue: SchemaIssue.Issue): Issue[] {
  return format(issue).issues.map(({ path = [], message }) => {
    let field = path.map((key) => String(typeof key === 'object' ? key.key : key)).join('.')
    return field ? { field, message } : { message }
  })
}
