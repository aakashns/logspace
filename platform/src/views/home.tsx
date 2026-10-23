import type { Html } from '#jsx/jsx-runtime'

import type { SiteConfig } from '../domain/site.ts'
import { Feed, type FeedItem } from './feed.tsx'

// The introduction set at /admin/config, then the feed. Either part of the introduction can be
// left out.
export function HomePage(props: { site: SiteConfig; items: readonly FeedItem[] }): Html {
  let { heroHeading, heroSubheading, siteUrl } = props.site
  return (
    <>
      {heroHeading || heroSubheading ? (
        <section class="intro">
          {heroHeading ? <h1>{heroHeading}</h1> : null}
          {heroSubheading ? <p>{heroSubheading}</p> : null}
        </section>
      ) : null}
      <Feed items={props.items} siteUrl={siteUrl} />
    </>
  )
}
