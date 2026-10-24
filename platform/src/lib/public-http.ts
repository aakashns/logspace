// Link previews may contact only public HTTP(S) origins on standard ports. Resolve every hop,
// reject mixed public/private answers, then dial the checked address (no second DNS lookup).
// Host and TLS serverName retain the origin, including certificate verification. Environment
// proxies are disabled because they would resolve the destination independently.
import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { Context, Effect, Layer } from 'effect'
import { HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse } from 'effect/http'

import { AppConfig } from '../config.ts'

// The OS boundary is injectable so tests drive the real policy and fetching workflow without
// dialing private services (or any external network).
export class PublicNetwork extends Context.Service<
  PublicNetwork,
  {
    readonly resolve: (hostname: string) => Promise<readonly string[]>
    readonly fetch: (url: URL, options: BunFetchRequestInit) => Promise<Response>
  }
>()('logspace/PublicNetwork') {
  static readonly layer = Layer.effect(
    PublicNetwork,
    Effect.map(AppConfig, ({ mode }) => {
      // getaddrinfo cannot be cancelled. Keep its own cap even after a caller times out.
      let resolving = 0
      let resolve = async (hostname: string) => {
        if (resolving >= 4) throw new Error('Preview DNS capacity exhausted')
        resolving++
        try {
          return (await lookup(hostname, { all: true })).map(({ address }) => address)
        } finally {
          resolving--
        }
      }
      let disabled = () => Promise.reject(new Error('Network disabled in tests'))
      return PublicNetwork.of({
        resolve: mode === 'test' ? disabled : resolve,
        fetch: mode === 'test' ? disabled : (url, options) => fetch(url, options),
      })
    }),
  )
}

const blockedV4 = new BlockList()
for (let [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blockedV4.addSubnet(address, prefix, 'ipv4')
const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')
const blockedV6 = new BlockList()
for (let [address, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
] as const)
  blockedV6.addSubnet(address, prefix, 'ipv6')

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) return !blockedV4.check(address, 'ipv4')
  // This also refuses mapped IPv4, NAT64, local, multicast, and scoped IPv6 addresses.
  return (
    isIP(address) === 6 &&
    !address.includes('%') &&
    globalV6.check(address, 'ipv6') &&
    !blockedV6.check(address, 'ipv6')
  )
}

export const PublicHttpLive = Layer.effect(
  HttpClient.HttpClient,
  Effect.gen(function* () {
    let network = yield* PublicNetwork
    return HttpClient.make((request, initial, signal) =>
      Effect.tryPromise({
        try: async () => {
          let url = initial
          for (let hop = 0; hop <= 5; hop++) {
            if (
              !['http:', 'https:'].includes(url.protocol) ||
              url.username ||
              url.password ||
              url.port ||
              (initial.protocol === 'https:' && url.protocol !== 'https:')
            ) {
              throw new Error('Preview destination refused')
            }
            let hostname = url.hostname.replace(/^\[|\]$/g, '')
            let addresses = isIP(hostname) ? [hostname] : await network.resolve(hostname)
            signal.throwIfAborted()
            let address = addresses[0]
            if (!address || !addresses.every(isPublicAddress))
              throw new Error('Non-public preview destination')
            let pinned = new URL(url)
            pinned.hostname = isIP(address) === 6 ? `[${address}]` : address
            let response = await network.fetch(pinned, {
              method: 'GET',
              headers: { ...request.headers, host: url.host },
              signal,
              redirect: 'manual',
              proxy: false,
              ...(url.protocol === 'https:' && { tls: { serverName: hostname } }),
            })
            if ([301, 302, 303, 307, 308].includes(response.status)) {
              await response.body?.cancel()
              let location = response.headers.get('location')
              if (!location) throw new Error('Redirect without Location')
              let next = new URL(location, url)
              if (url.protocol === 'https:' && next.protocol !== 'https:') {
                throw new Error('Preview HTTPS downgrade refused')
              }
              url = next
              continue
            }
            // Discard the pinned transport URL: relative metadata is based on the final origin.
            return HttpClientResponse.fromWeb(
              HttpClientRequest.setUrl(request, url.href),
              new Response(response.body, { status: response.status, headers: response.headers }),
            )
          }
          throw new Error('Too many preview redirects')
        },
        catch: (cause) =>
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, cause }),
          }),
      }),
    )
  }),
)
