// The emails the site's fake of Amazon SES took (see handler.tsx), newest first. They're kept in
// memory, so they're gone when the server stops, and only the last 100.
import { Context, Effect, Layer, Ref } from 'effect'

export interface ReceivedEmail {
  readonly id: string
  readonly receivedAt: Date
  // As the request had them: the From header's name and address, and the rest addresses.
  readonly from: string
  readonly to: readonly string[]
  readonly replyTo: readonly string[]
  readonly subject: string
  readonly text: string
}

export class DevInbox extends Context.Service<
  DevInbox,
  {
    readonly add: (email: ReceivedEmail) => Effect.Effect<void>
    readonly emails: Effect.Effect<readonly ReceivedEmail[]>
  }
>()('logspace/DevInbox') {
  static readonly layer = Layer.effect(
    DevInbox,
    Effect.map(Ref.make<readonly ReceivedEmail[]>([]), (ref) =>
      DevInbox.of({
        add: (email) => Ref.update(ref, (emails) => [email, ...emails].slice(0, 100)),
        emails: Ref.get(ref),
      }),
    ),
  )
}
