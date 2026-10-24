import { afterAll, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { SiteConfigCommands } from '../src/commands/site-config.ts'
import { SiteConfigQueries } from '../src/queries/site-config.ts'
import { MediaStorage, mediaKeys } from '../src/services/media-storage.ts'
import { defined, makeTestApp } from './app.ts'
import { TEST_SITE_CONFIG } from './seed.ts'

const app = makeTestApp()
beforeEach(app.seedDatabase)
afterAll(app.dispose)
// A mutation has reached its actual filesystem step before the competing request starts.
function barrier<A extends readonly unknown[], B>(original: (...args: A) => Effect.Effect<B>) {
  let entered = Promise.withResolvers<void>()
  let release = Promise.withResolvers<void>()
  return {
    entered: entered.promise,
    release: () => release.resolve(),
    run: (...args: A) =>
      Effect.gen(function* () {
        entered.resolve()
        yield* Effect.promise(() => release.promise)
        return yield* original(...args)
      }),
  }
}

const siteText = { ...TEST_SITE_CONFIG, bannerImageAlt: 'A banner' }
const saved = () => app.run(Effect.flatMap(SiteConfigQueries, (q) => q.saved))
const source = Bun.file(`${import.meta.dir}/content/posts/t83tytis1i/cover.jpg`)
const image = async (format: 'png' | 'jpeg', width = 512) => {
  let resized = new Bun.Image(await source.bytes()).resize(width, 512)
  return new Blob([
    new Uint8Array(await (format === 'png' ? resized.png() : resized.jpeg()).bytes()),
  ])
}
const failConfig = () =>
  app.run(
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      sql
        .unsafe(
          "create trigger fail_config before delete on config begin select raise(abort, 'injected'); end",
        )
        .pipe(Effect.orDie),
    ),
  )
const unFailConfig = () =>
  app.run(
    Effect.flatMap(SqlClient.SqlClient, (sql) => sql`drop trigger fail_config`.pipe(Effect.orDie)),
  )

// Compare actual bytes served through the public routes, not just database rows/file existence.
describe('site media failure consistency', () => {
  for (let operation of ['remove', 'replace-format', 'replace-same-format'] as const) {
    it(`preserves the published banner's bytes and config on a failed ${operation}`, async () => {
      let commands = await app.run(SiteConfigCommands)
      await app.run(commands.update(siteText, { bannerImage: await image('png') }, []))
      let before = defined((await saved()).bannerImage, 'banner')
      let bytes = await (await app.fetch('/site/banner.png')).arrayBuffer()
      await failConfig()
      try {
        let uploads =
          operation === 'remove'
            ? {}
            : {
                bannerImage: await image(operation === 'replace-format' ? 'jpeg' : 'png', 800),
              }
        expect(
          (
            await app.run(
              Effect.exit(
                commands.update(siteText, uploads, operation === 'remove' ? ['bannerImage'] : []),
              ),
            )
          )._tag,
        ).toBe('Failure')
        expect((await saved()).bannerImage).toEqual(before)
        let response = await app.fetch('/site/banner.png')
        expect(response.status).toBe(200)
        expect(await response.arrayBuffer()).toEqual(bytes)
      } finally {
        await unFailConfig()
      }
    })
  }

  it('preserves all four old icon files if staging fails halfway through the replacement', async () => {
    let commands = await app.run(SiteConfigCommands)
    let storage = await app.run(MediaStorage)
    await app.run(commands.update(siteText, { icon: await image('png') }, []))
    let before = (await saved()).icon
    let paths = [
      '/favicon.ico',
      '/apple-touch-icon.png',
      '/site/icon-192.png',
      '/site/icon-512.png',
    ]
    let bytes = await Promise.all(paths.map(async (path) => (await app.fetch(path)).arrayBuffer()))
    let put = storage.put
    let count = 0
    let mock = spyOn(storage, 'put').mockImplementation((key, bytes) =>
      ++count === 3 ? Effect.die('injected third-file failure') : put(key, bytes),
    )
    try {
      expect(
        (await app.run(Effect.exit(commands.update(siteText, { icon: await image('jpeg') }, []))))
          ._tag,
      ).toBe('Failure')
      expect(count).toBe(3)
      expect((await saved()).icon).toEqual(before)
      for (let [index, path] of paths.entries()) {
        let response = await app.fetch(path)
        expect(response.status).toBe(200)
        expect(await response.arrayBuffer()).toEqual(defined(bytes[index], 'original bytes'))
      }
    } finally {
      mock.mockRestore()
    }
  })

  it('preserves every icon size when the configuration commit fails after staging all files', async () => {
    let commands = await app.run(SiteConfigCommands)
    await app.run(commands.update(siteText, { icon: await image('png') }, []))
    let before = (await saved()).icon
    let paths = [
      '/favicon.ico',
      '/apple-touch-icon.png',
      '/site/icon-192.png',
      '/site/icon-512.png',
    ]
    let bytes = await Promise.all(paths.map(async (path) => (await app.fetch(path)).arrayBuffer()))
    await failConfig()
    try {
      expect(
        (await app.run(Effect.exit(commands.update(siteText, { icon: await image('jpeg') }, []))))
          ._tag,
      ).toBe('Failure')
      expect((await saved()).icon).toEqual(before)
      for (let [index, path] of paths.entries()) {
        let response = await app.fetch(path)
        expect(response.status).toBe(200)
        expect(await response.arrayBuffer()).toEqual(defined(bytes[index], 'original bytes'))
      }
    } finally {
      await unFailConfig()
    }
  })

  it('serves pre-upgrade unversioned media and removes it only after a successful replacement', async () => {
    let commands = await app.run(SiteConfigCommands)
    let storage = await app.run(MediaStorage)
    let bytes = await image('png')
    await app.run(storage.put(mediaKeys.siteFile('banner.png'), bytes))
    await app.run(
      commands.save({
        ...siteText,
        bannerImage: { file: 'banner.png', width: 512, height: 512, version: 'legacy' },
      }),
    )
    expect((await app.fetch('/site/banner.png')).status).toBe(200)
    await app.run(commands.update(siteText, { bannerImage: await image('jpeg') }, []))
    expect((await saved()).bannerImage?.generation).toBeDefined()
    expect((await app.fetch('/site/banner.jpg')).status).toBe(200)
    expect(await app.run(storage.has(mediaKeys.siteFile('banner.png')))).toBe(false)
  })

  it('does not clean up variants of the newly committed banner while removing the old generation', async () => {
    let commands = await app.run(SiteConfigCommands)
    let storage = await app.run(MediaStorage)
    await app.run(commands.update(siteText, { bannerImage: await image('png') }, []))
    let gate = barrier(storage.remove)
    let mock = spyOn(storage, 'remove').mockImplementationOnce(gate.run)
    try {
      let update = app.run(commands.update(siteText, { bannerImage: await image('png', 800) }, []))
      await gate.entered
      let current = defined((await saved()).bannerImage, 'committed banner')
      let url = `/site/banner.png?w=600&v=${current.version}`
      expect((await app.fetch(url)).status).toBe(200)
      let key = `${mediaKeys.siteVariants('banner.png')}600-${current.version}.webp`
      gate.release()
      await update
      expect(await app.run(storage.has(key))).toBe(true)
    } finally {
      gate.release()
      mock.mockRestore()
    }
  })

  it('serializes replacements through staging, commit, and cleanup', async () => {
    let commands = await app.run(SiteConfigCommands)
    let storage = await app.run(MediaStorage)
    let initialFiles = (await app.run(storage.list('site/generations/'))).length
    await app.run(commands.update(siteText, { bannerImage: await image('png') }, []))
    let gate = barrier(storage.put)
    let mock = spyOn(storage, 'put').mockImplementationOnce(gate.run)
    try {
      let first = app.run(commands.update(siteText, { bannerImage: await image('jpeg') }, []))
      await gate.entered
      let second = app.run(commands.update(siteText, {}, ['bannerImage']))
      gate.release()
      await Promise.all([first, second])
      expect((await saved()).bannerImage).toBeUndefined()
      expect((await app.fetch('/site/banner.png')).status).toBe(404)
      expect((await app.fetch('/site/banner.jpg')).status).toBe(404)
      expect((await app.run(storage.list('site/generations/'))).length).toBe(initialFiles)
    } finally {
      gate.release()
      mock.mockRestore()
    }
  })

  it('commits a complete replacement even if obsolete-file cleanup fails', async () => {
    let commands = await app.run(SiteConfigCommands)
    let storage = await app.run(MediaStorage)
    await app.run(commands.update(siteText, { bannerImage: await image('png') }, []))
    let before = defined((await saved()).bannerImage, 'old banner')
    let mock = spyOn(storage, 'remove').mockImplementation(() =>
      Effect.die('injected cleanup failure'),
    )
    try {
      await app.run(commands.update(siteText, { bannerImage: await image('jpeg') }, []))
      expect((await saved()).bannerImage?.file).toBe('banner.jpg')
      expect((await app.fetch('/site/banner.jpg')).status).toBe(200)
      expect((await app.fetch('/site/banner.png')).status).toBe(404)
      expect(await app.run(storage.has(mediaKeys.siteFile(before.file, before.generation)))).toBe(
        true,
      )
    } finally {
      mock.mockRestore()
    }
  })
})
