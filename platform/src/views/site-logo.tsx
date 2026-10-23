import type { Html } from '#jsx/jsx-runtime'

import type { SiteConfig } from '../domain/site.ts'
import { getSiteImageHref } from '../queries/site-files.ts'

// The site's logo, uploaded at /admin/config, or its title without one. The logo is a mask
// filled with the text color, so it follows the theme like text does; it's sized by its height.
export function SiteLogo(props: { site: SiteConfig; height: string }): Html {
  let { logo, siteTitle } = props.site
  if (!logo) {
    return (
      <span class="site-title" style={`font-size: ${props.height}`}>
        {siteTitle}
      </span>
    )
  }
  let url = JSON.stringify(getSiteImageHref(logo))
  return (
    <span
      role="img"
      aria-label={siteTitle}
      class="site-logo"
      style={`height: ${props.height}; aspect-ratio: ${logo.width} / ${logo.height}; mask-image: url(${url})`}
    />
  )
}
