// What a command can refuse to do. These are expected: the page that sent the command shows why.
import { Schema } from 'effect'

const PostIssue = Schema.Struct({
  field: Schema.optionalKey(Schema.String),
  message: Schema.String,
})

// The post wasn't saved, for these reasons (shown above the post form).
export class PostRejected extends Schema.TaggedError<PostRejected>()('PostRejected', {
  issues: Schema.Array(PostIssue),
}) {}

export class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
  id: Schema.String,
}) {}

// The site's settings weren't saved, for these reasons (shown above the config form).
export class SiteConfigRejected extends Schema.TaggedError<SiteConfigRejected>()(
  'SiteConfigRejected',
  {
    issues: Schema.Array(
      Schema.Struct({ field: Schema.optionalKey(Schema.String), message: Schema.String }),
    ),
  },
) {}
