import type { Html } from '#jsx/jsx-runtime'

import type { SiteConfig } from '../domain/site.ts'
import { getSiteImageHref } from '../queries/site-files.ts'
import { Feed, type FeedItem } from './feed.tsx'

// The banner and introduction set at /admin/config, then the feed. Any of the banner and the
// introduction's two parts can be left out.
export function HomePage(props: { site: SiteConfig; items: readonly FeedItem[] }): Html {
  let { bannerImage, bannerImageAlt, heroHeading, heroSubheading, siteUrl } = props.site
  return (
    <>
      {bannerImage ? (
        <img
          src={getSiteImageHref(bannerImage)}
          alt={bannerImageAlt}
          width={bannerImage.width}
          height={bannerImage.height}
          fetchpriority="high"
          class="banner"
        />
      ) : null}
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
