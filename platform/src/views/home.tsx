import type { Html } from '#jsx/jsx-runtime'

import { BANNER_IMAGE_SIZES } from '../domain/constants.ts'
import type { SiteConfig } from '../domain/site.ts'
import { getBannerSrcset, getSiteImageHref } from '../domain/site-images.ts'
import { Feed, type FeedItem } from './feed.tsx'

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
