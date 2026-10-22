import type { Handle, RemixNode } from 'remix/component'
import { css, unsafeHTML } from 'remix/component'
import { ImportMap } from 'remix/component/server'

import { globalStylesheet, scriptEntry } from '../assets.ts'
import { getSavedSiteConfig, isSiteConfigured, type SiteConfig } from '../data/config.ts'
import { getIconHref, getSiteImageHref } from '../data/site-images.ts'
import { APP_NAME, THEME_COOKIE_NAME } from '../lib/constants.ts'
import type { PageMeta, PreloadImage } from '../lib/page-meta.ts'
import type { Theme } from '../lib/theme.ts'
import { routes } from '../routes.ts'
import { RssLink } from '../ui/rss-link.tsx'
import { SiteLogo } from '../ui/site-logo.tsx'
import { ThemeToggle } from './public/theme-toggle.tsx'

export interface DocumentProps {
  children?: RemixNode
  // Extra navbar buttons, shown at the far right after the theme toggle.
  navActions?: RemixNode
  meta: PageMeta
  // The user's saved theme (see getTheme); undefined follows the system preference.
  theme?: Theme
  // The page's main image, usually what Lighthouse calls the Largest Contentful Paint, which is
  // fetched before anything else (see getPriorityImage).
  preloadImage?: PreloadImage
}

export function Document(handle: Handle<DocumentProps>) {
  return () => {
    let { children, meta, navActions, theme, preloadImage } = handle.props
    let { href, importMap, preloads } = scriptEntry
    // The admin pages are shown before the site is configured, so its required settings can be
    // missing. Then the title is the app's, URLs are relative to the page, and there's no RSS feed.
    let saved = getSavedSiteConfig()
    let configured = isSiteConfigured(saved)
    let site: SiteConfig = {
      ...saved,
      siteTitle: saved.siteTitle || APP_NAME,
      siteUrl: saved.siteUrl ?? '',
      siteDescription: saved.siteDescription ?? '',
    }
    let url = site.siteUrl + meta.path
    let description = meta.description || site.siteDescription
    let { socialImage } = site
    let image =
      meta.image ??
      (socialImage && {
        url: getSiteImageHref(socialImage),
        alt: site.socialImageAlt,
        width: socialImage.width,
        height: socialImage.height,
      })
    if (image && site.siteUrl) image = { ...image, url: new URL(image.url, site.siteUrl).href }

    return (
      <html lang="en" class={theme}>
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          {/* First in <head>, so the image is requested with the first bytes of the page instead of
              after the inlined stylesheet. imagesizes isn't in Remix's types, so it's spread in. */}
          {preloadImage ? (
            <link
              data-rmx-key="preload:image"
              rel="preload"
              as="image"
              href={preloadImage.href}
              imageSrcSet={preloadImage.srcset}
              fetchpriority="high"
              {...({ imagesizes: preloadImage.sizes } as {})}
            />
          ) : null}
          <link
            data-rmx-key="link:icon:ico"
            rel="icon"
            href={getIconHref(site, 'favicon.ico')}
            sizes="32x32"
          />
          <link
            data-rmx-key="link:icon:png"
            rel="icon"
            type="image/png"
            href={getIconHref(site, 'icon-192.png')}
            sizes="192x192"
          />
          <link
            data-rmx-key="link:apple-touch-icon"
            rel="apple-touch-icon"
            href={getIconHref(site, 'apple-touch-icon.png')}
          />
          <link data-rmx-key="link:manifest" rel="manifest" href={routes.manifest.href()} />
          {configured ? (
            <link
              data-rmx-key="link:rss"
              rel="alternate"
              type="application/rss+xml"
              title={site.siteTitle}
              href={site.siteUrl + routes.rss.href()}
            />
          ) : null}
          {/* Client-side navigation diffs <head> by data-rmx-key. Without the key the stylesheet can be
              moved and re-fetched, flashing unstyled content; preserve-dom leaves it untouched. */}
          {globalStylesheet.css !== undefined ? (
            <style
              data-rmx-key="stylesheet:global"
              data-rmx-preserve-dom
              innerHTML={unsafeHTML(globalStylesheet.css)}
            />
          ) : (
            <link
              data-rmx-key="stylesheet:global"
              data-rmx-preserve-dom
              rel="stylesheet"
              href={globalStylesheet.href}
            />
          )}
          <title>{meta.title ? `${meta.title} · ${site.siteTitle}` : site.siteTitle}</title>
          <meta data-rmx-key="meta:description" name="description" content={description} />
          {meta.noindex ? (
            <meta data-rmx-key="meta:robots" name="robots" content="noindex" />
          ) : null}
          <link data-rmx-key="link:canonical" rel="canonical" href={url} />
          <meta data-rmx-key="meta:og:site_name" property="og:site_name" content={site.siteTitle} />
          <meta
            data-rmx-key="meta:og:type"
            property="og:type"
            content={meta.published ? 'article' : 'website'}
          />
          <meta
            data-rmx-key="meta:og:title"
            property="og:title"
            content={meta.title ?? site.siteTitle}
          />
          <meta
            data-rmx-key="meta:og:description"
            property="og:description"
            content={description}
          />
          <meta data-rmx-key="meta:og:url" property="og:url" content={url} />
          {image ? (
            <>
              <meta data-rmx-key="meta:og:image" property="og:image" content={image.url} />
              {image.alt ? (
                <meta
                  data-rmx-key="meta:og:image:alt"
                  property="og:image:alt"
                  content={image.alt}
                />
              ) : null}
              {image.width ? (
                <meta
                  data-rmx-key="meta:og:image:width"
                  property="og:image:width"
                  content={String(image.width)}
                />
              ) : null}
              {image.height ? (
                <meta
                  data-rmx-key="meta:og:image:height"
                  property="og:image:height"
                  content={String(image.height)}
                />
              ) : null}
            </>
          ) : null}
          {meta.published ? (
            <meta
              data-rmx-key="meta:article:published_time"
              property="article:published_time"
              content={meta.published.date}
            />
          ) : null}
          <meta
            data-rmx-key="meta:twitter:card"
            name="twitter:card"
            content={image ? 'summary_large_image' : 'summary'}
          />
          {image ? (
            <meta data-rmx-key="meta:twitter:image" name="twitter:image" content={image.url} />
          ) : null}
          {image?.alt ? (
            <meta
              data-rmx-key="meta:twitter:image:alt"
              name="twitter:image:alt"
              content={image.alt}
            />
          ) : null}
          <script
            data-rmx-key="json-ld"
            type="application/ld+json"
            innerHTML={unsafeHTML(
              toJsonLd(getStructuredData(site, meta, url, description, image?.url)),
            )}
          />
          <ImportMap value={importMap} />
          {/* The scripts only make the navbar and share buttons interactive, so they start once the
              page has loaded, rather than sharing the connection with its photos: the server's
              HTTP/2 doesn't send higher priority responses first. */}
          <script
            data-rmx-key="script:entry"
            innerHTML={unsafeHTML(loadScriptsOnLoad(href, preloads))}
          />
        </head>
        <body>
          <header mix={navbarStyle}>
            <div mix={navbarContentStyle}>
              <a href={routes.home.href()} mix={siteTitleStyle}>
                <SiteLogo site={site} height="1.2rem" />
              </a>
              <div mix={navActionsStyle}>
                {configured ? <RssLink /> : null}
                <ThemeToggle cookieName={THEME_COOKIE_NAME} />
                {navActions}
              </div>
            </div>
          </header>
          <main mix={mainStyle}>{children}</main>
        </body>
      </html>
    )
  }
}

// schema.org data for search engines: the site and its author on the home page, or the post.
function getStructuredData(
  site: SiteConfig,
  meta: PageMeta,
  url: string,
  description: string,
  image?: string,
) {
  let author = { '@type': 'Person', name: site.siteTitle, url: site.siteUrl }
  if (!meta.published) {
    return {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: site.siteTitle,
      url,
      description,
      author,
    }
  }
  return {
    '@context': 'https://schema.org',
    '@type': meta.published.kind,
    headline: meta.title,
    description,
    url,
    mainEntityOfPage: url,
    datePublished: meta.published.date,
    image,
    author,
  }
}

// An inline script that adds the entry script, and modulepreloads for the modules it imports, when
// the window's load event fires. They're low priority, since nothing else is loading by then and
// Lighthouse otherwise lists them as critical requests.
function loadScriptsOnLoad(entry: string, preloads: string[]) {
  let scripts = toJsonLd({ entry, preloads })
  return (
    `addEventListener('load',()=>{let{entry,preloads}=${scripts},add=(e,p)=>document.head.append(Object.assign(document.createElement(e),{fetchPriority:'low',...p}));` +
    `for(let href of preloads)add('link',{rel:'modulepreload',href});add('script',{type:'module',src:entry})},{once:true})`
  )
}

// JSON that's safe inside a <script> element.
function toJsonLd(data: object) {
  return JSON.stringify(data).replaceAll('<', '\\u003c')
}

// The bar spans the full width and stays pinned while scrolling; its contents line up with the
// centered content column. The 56px height includes the bottom border (border-box sizing).
const navbarStyle = css({
  position: 'sticky',
  top: 0,
  zIndex: 10,
  height: '3.5rem',
  borderBottom: '1px solid var(--border)',
  backgroundColor: 'color-mix(in oklch, var(--background) 75%, transparent)',
  backdropFilter: 'blur(12px)',
})

const navbarContentStyle = css({
  maxWidth: 'var(--content-width)',
  height: '100%',
  marginInline: 'auto',
  paddingInline: '1rem',
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
})

const navActionsStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '0.25rem',
})

const mainStyle = css({
  maxWidth: 'var(--content-width)',
  marginInline: 'auto',
  paddingInline: '1rem',
})

const siteTitleStyle = css({ display: 'block', minWidth: 0 })
