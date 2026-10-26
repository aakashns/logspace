import type { Html } from '#jsx/jsx-runtime'

import { getSiteImageHref } from '../data/site/site-images.ts'
import type { SiteConfig, SiteImage } from '../data/site/site.ts'

// The site's logo for each theme, uploaded at /admin/branding, or its title without one; sized by its
// height. Each theme shows its own logo, or the other theme's if it has none. They're images in the
// page, not CSS, so the browser fetches them as soon as it reads the HTML, alongside the banner.
export function SiteLogo(props: { site: SiteConfig; height: string }): Html {
  let { siteTitle } = props.site
  let light = props.site.logo ?? props.site.darkLogo
  let dark = props.site.darkLogo ?? props.site.logo
  if (!light || !dark) {
    return (
      <span class="site-title" style={`font-size: ${props.height}`}>
        {siteTitle}
      </span>
    )
  }
  let logo = (image: SiteImage, theme?: string) => (
    <img
      src={getSiteImageHref(image)}
      alt={siteTitle}
      width={image.width}
      height={image.height}
      class={theme ? `site-logo ${theme}` : 'site-logo'}
      style={`height: ${props.height}`}
    />
  )
  if (light === dark) return logo(light)
  return (
    <>
      {logo(light, 'in-light-theme')}
      {logo(dark, 'in-dark-theme')}
    </>
  )
}
