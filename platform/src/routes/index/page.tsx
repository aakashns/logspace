import type { Html } from '#jsx/jsx-runtime'

import { getBannerSrcset, getSiteImageHref } from '../../data/site/site-images.ts'
import type { SiteConfig } from '../../data/site/site.ts'
import { Feed, type FeedItem } from './feed.tsx'

// The home page's banner, which spans the screen on phones and the column with its padding on
// wider screens (see .banner in page.css).
export const BANNER_IMAGE_SIZES = '(min-width: 38rem) 38rem, 100vw'

// The banner and introduction set at /admin/config, then the feed. Any of the banner and the
// introduction's two parts can be left out.
export function HomePage(props: { site: SiteConfig; items: readonly FeedItem[] }): Html {
  let { bannerImage, bannerImageAlt, heroHeading, heroSubheading, siteUrl } = props.site
  let srcset = bannerImage && getBannerSrcset(bannerImage)
  return (
    <>
      {bannerImage ? (
        <img
          src={getSiteImageHref(bannerImage)}
          srcset={srcset || undefined}
          sizes={srcset ? BANNER_IMAGE_SIZES : undefined}
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
