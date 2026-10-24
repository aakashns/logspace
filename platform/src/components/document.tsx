// Every page's <html>: its <head> (title, link preview and search engine tags, icons, the inlined
// stylesheet) and the navbar around its content.
import { raw, type Child, type Html } from '#jsx/jsx-runtime'

import type { PageMeta, PreloadImage } from '../data/posts/presentation.ts'
import { getIconHref, getSiteImageHref } from '../data/site/site-images.ts'
import { isSiteConfigured, type SavedSiteConfig, type SiteConfig } from '../data/site/site.ts'
import { urls } from '../lib/urls.ts'
import { ComposeLink, CONTROLS_STYLES, RssLink, ThemeToggle } from './controls.tsx'
import layoutCss from './layout.css' with { type: 'text' }
import resetCss from './reset.css' with { type: 'text' }
import { SiteLogo } from './site-logo.tsx'
import { stylesheet } from './stylesheet.ts'
import themeCss from './theme.css' with { type: 'text' }

// What every page inlines before its own styles: the reset, the theme, and the navbar's. The
// page gets it from Assets, which embeds the heading font (see ../lib/http/assets.ts).
export const DOCUMENT_STYLES = stylesheet(resetCss, themeCss, layoutCss) + CONTROLS_STYLES

// The app's name, which pages show as the site's title until the site has one.
const APP_NAME = 'LogSpace'

// What every page needs to know about the request it's for (see ../lib/http/pages.ts).
export interface PageContext {
  readonly site: SavedSiteConfig
  // The user's saved theme; undefined follows the system preference.
  readonly theme?: 'light' | 'dark' | undefined
  // Whether the browser says it's logged in as admin (not checked: it only shows the navbar's
  // link to the composer).
  readonly admin?: boolean | undefined
  // The Content-Security-Policy nonce for this response, which Datastar runs its expressions
  // with (see ../lib/http/pages.ts).
  readonly nonce: string
  // DOCUMENT_STYLES, with the heading font embedded.
  readonly stylesheet: string
  // Where Datastar is served, with its hash in the name.
  readonly datastarHref: string
}

export interface DocumentProps {
  readonly page: PageContext
  readonly meta: PageMeta
  // The page's main image, usually what Lighthouse calls the Largest Contentful Paint, which is
  // fetched before anything else (see getPriorityImage).
  readonly preloadImage?: PreloadImage | undefined
  // The page's own styles, inlined after every page's (see stylesheet.ts).
  readonly styles: string
  // Extra navbar buttons, shown at the far right after the theme toggle.
  readonly navActions?: Child | undefined
  readonly children?: Child | undefined
}

export function Document(props: DocumentProps): Html {
  let { page, meta, preloadImage, styles, navActions, children } = props
  // The admin pages are shown before the site is configured, so its required settings can be
  // missing. Then the title is the app's, URLs are relative to the page, and there's no RSS feed.
  let saved = page.site
  let configured = isSiteConfigured(saved)
  let site: SiteConfig = {
    ...saved,
    siteTitle: saved.siteTitle || APP_NAME,
    siteUrl: saved.siteUrl ?? '',
    siteDescription: saved.siteDescription ?? '',
  }
  let url = site.siteUrl + meta.path
  let description = meta.description || site.siteDescription
  let { bannerImage } = site
  let image =
    meta.image ??
    (bannerImage && {
      url: getSiteImageHref(bannerImage),
      alt: site.bannerImageAlt,
      width: bannerImage.width,
      height: bannerImage.height,
    })
  if (image && site.siteUrl) image = { ...image, url: new URL(image.url, site.siteUrl).href }
  let structuredData = getStructuredData(site, meta, url, description, image?.url)

  return raw(
    '<!DOCTYPE html>' +
      (
        <html lang="en" class={page.theme} data-nonce={page.nonce}>
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            {/* First in <head>, so the image is requested with the first bytes of the page
                instead of after the inlined stylesheet. */}
            {preloadImage ? (
              <link
                rel="preload"
                as="image"
                href={preloadImage.href}
                imagesrcset={preloadImage.srcset}
                imagesizes={preloadImage.sizes}
                fetchpriority="high"
              />
            ) : null}
            <link rel="icon" href={getIconHref(site, 'favicon.ico')} sizes="32x32" />
            <link
              rel="icon"
              type="image/png"
              href={getIconHref(site, 'icon-192.png')}
              sizes="192x192"
            />
            <link rel="apple-touch-icon" href={getIconHref(site, 'apple-touch-icon.png')} />
            <link rel="manifest" href={urls.manifest()} />
            {configured ? (
              <link
                rel="alternate"
                type="application/rss+xml"
                title={site.siteTitle}
                href={site.siteUrl + urls.rss()}
              />
            ) : null}
            <style>{raw(page.stylesheet + styles)}</style>
            <title>{meta.title ? `${meta.title} · ${site.siteTitle}` : site.siteTitle}</title>
            <meta name="description" content={description} />
            {meta.noindex ? <meta name="robots" content="noindex" /> : null}
            <link rel="canonical" href={url} />
            <meta property="og:site_name" content={site.siteTitle} />
            <meta property="og:type" content={meta.published ? 'article' : 'website'} />
            <meta property="og:title" content={meta.title ?? site.siteTitle} />
            <meta property="og:description" content={description} />
            <meta property="og:url" content={url} />
            {image ? <meta property="og:image" content={image.url} /> : null}
            {image?.alt ? <meta property="og:image:alt" content={image.alt} /> : null}
            {image?.width ? <meta property="og:image:width" content={image.width} /> : null}
            {image?.height ? <meta property="og:image:height" content={image.height} /> : null}
            {meta.published ? (
              <meta property="article:published_time" content={meta.published} />
            ) : null}
            <meta name="twitter:card" content={image ? 'summary_large_image' : 'summary'} />
            {image ? <meta name="twitter:image" content={image.url} /> : null}
            {image?.alt ? <meta name="twitter:image:alt" content={image.alt} /> : null}
            {/* Data for search engines, which browsers don't run. */}
            <script type="application/ld+json">{raw(toScriptJson(structuredData))}</script>
          </head>
          {/* `_shared` is the link a share button copied last (see ShareButton). */}
          <body data-signals="{_shared: ''}">
            <header class="navbar">
              <div class="navbar-content">
                <a href={urls.home()} class="navbar-title">
                  <SiteLogo site={site} height="1.2rem" />
                </a>
                <div class="nav-actions">
                  {page.admin ? <ComposeLink /> : null}
                  {configured ? <RssLink /> : null}
                  <ThemeToggle />
                  {navActions}
                </div>
              </div>
            </header>
            <main>{children}</main>
            {/* Datastar only runs the buttons (and the admin composer), so it's fetched at a
                low priority, after the page's photos: a module script never blocks the page. */}
            <script
              type="module"
              src={page.datastarHref}
              nonce={page.nonce}
              fetchpriority="low"
            ></script>
          </body>
        </html>
      ).value,
  )
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
    '@type': 'SocialMediaPosting',
    headline: meta.title,
    description,
    url,
    mainEntityOfPage: url,
    datePublished: meta.published,
    image,
    author,
  }
}

// JSON that's safe inside a <script> element.
function toScriptJson(data: object): string {
  return JSON.stringify(data).replaceAll('<', '\\u003c')
}
