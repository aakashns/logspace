import type { Handle } from 'remix/component'
import { css } from 'remix/component'

import type { SiteConfig } from '../data/config.ts'
import { getSiteImageHref } from '../data/site-images.ts'

// The site's logo, uploaded at /admin/config, or its title without one. The logo is a mask filled
// with the text color, so it follows the theme like text does; it's sized by its height, `height`.
export function SiteLogo(handle: Handle<{ site: SiteConfig; height: string }>) {
  return () => {
    let { site, height } = handle.props
    let { logo, siteTitle } = site
    if (!logo) {
      return (
        <span mix={titleStyle} style={`font-size: ${height}`}>
          {siteTitle}
        </span>
      )
    }
    let url = JSON.stringify(getSiteImageHref(logo))
    return (
      <span
        role="img"
        aria-label={siteTitle}
        mix={logoStyle}
        style={`height: ${height}; aspect-ratio: ${logo.width} / ${logo.height}; mask-image: url(${url})`}
      />
    )
  }
}

const logoStyle = css({
  display: 'block',
  backgroundColor: 'currentColor',
  maskSize: 'contain',
  maskRepeat: 'no-repeat',
  maskPosition: 'left center',
})

const titleStyle = css({
  display: 'block',
  fontFamily: 'var(--font-heading)',
  fontWeight: 600,
  lineHeight: 1,
  whiteSpace: 'nowrap',
})
