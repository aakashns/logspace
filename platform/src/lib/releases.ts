// Shared by the CLI upgrader and the admin update status. No GitHub API token needed.
import { Effect, Schema } from 'effect'
import { HttpClient, FetchHttpClient } from 'effect/http'

export class ReleaseUnavailable extends Schema.TaggedError<ReleaseUnavailable>()(
  'ReleaseUnavailable',
  { message: Schema.String },
) {}

export const latestRelease = Effect.fn('latestRelease')(function* (
  releases = 'https://github.com/aakashns/logspace/releases',
) {
  let url = `${releases}/latest`
  let response = yield* (yield* HttpClient.HttpClient).get(url).pipe(
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: 'manual' }),
    Effect.timeout('15 seconds'),
    Effect.mapError(
      () => new ReleaseUnavailable({ message: 'Could not check for updates. Try again later.' }),
    ),
  )
  let tag = /\/releases\/tag\/v?(\d+\.\d+\.\d+)$/.exec(response.headers['location'] ?? '')?.[1]
  if (response.status < 300 || response.status >= 400 || !tag) {
    return yield* new ReleaseUnavailable({ message: 'Could not find the latest stable release.' })
  }
  return tag
})
