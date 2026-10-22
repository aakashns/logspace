import type { Handle } from 'remix/component'
import { css } from 'remix/component'

import { getSiteConfig } from '../data/config.ts'
import { Feed, type FeedItem } from '../ui/feed.tsx'

// The introduction set at /admin/config, then the feed. Either part of the introduction can be
// left out.
export function HomePage(handle: Handle<{ items: FeedItem[] }>) {
  return () => {
    let { heroHeading, heroSubheading } = getSiteConfig()
    return (
      <>
        {heroHeading || heroSubheading ? (
          <section mix={introStyle}>
            {heroHeading ? <h1>{heroHeading}</h1> : null}
            {heroSubheading ? <p>{heroSubheading}</p> : null}
          </section>
        ) : null}
        <Feed items={handle.props.items} />
      </>
    )
  }
}

const introStyle = css({
  paddingBlock: '2.5rem',
  '& h1': { fontSize: '2rem', lineHeight: 1.2 },
  '& h1 + p': { marginTop: '1.25rem' },
  '& p': { lineHeight: 1.7 },
})
