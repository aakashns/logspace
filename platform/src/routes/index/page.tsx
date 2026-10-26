import type { Html } from '#jsx/jsx-runtime'
import { Tooltip } from '../../components/controls.tsx'
import { BellIcon, BellRingingIcon, BellSlashIcon, ShareIcon } from '../../components/icons.tsx'
import { POST_STYLES } from '../../components/post.tsx'
import { stylesheet } from '../../components/stylesheet.ts'
import { Button } from '../../components/ui/button.tsx'
import {
  DialogClose,
  DialogContent,
  DIALOG_STYLES,
  DialogFooter,
} from '../../components/ui/dialog.tsx'
import { getBannerSrcset, getSiteImageHref } from '../../data/site/site-images.ts'
import type { SiteConfig } from '../../data/site/site.ts'
import { urls } from '../../lib/urls.ts'
import { Feed, type FeedItem } from './feed.tsx'
import css from './page.css' with { type: 'text' }

export const HOME_PAGE_STYLES = POST_STYLES + DIALOG_STYLES + stylesheet(css)

// The home page's banner, which spans the screen on phones and the column with its padding on
// wider screens (see .banner in page.css).
export const BANNER_IMAGE_SIZES = '(min-width: 38rem) 38rem, 100vw'

// The banner and introduction set at /admin/branding, with a Subscribe button while subscribing
// is open, and the bell for push notifications while they're on, then the feed. Any of the
// banner and the introduction's parts can be left out.
export function HomePage(props: {
  site: SiteConfig
  items: readonly FeedItem[]
  subscribe: boolean
  // The key browsers subscribe to push notifications with, while they're on.
  pushPublicKey: string | undefined
}): Html {
  let { bannerImage, bannerImageAlt, heroHeading, heroSubheading, siteTitle, siteUrl } = props.site
  let { subscribe, pushPublicKey } = props
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
      {heroHeading || heroSubheading || subscribe || pushPublicKey ? (
        <section class="intro">
          {heroHeading ? <h1>{heroHeading}</h1> : null}
          {heroSubheading ? <p>{heroSubheading}</p> : null}
          {subscribe || pushPublicKey ? (
            <div class="intro-actions">
              {subscribe ? <Button href={urls.subscribe()}>Subscribe</Button> : null}
              {pushPublicKey ? <PushBell publicKey={pushPublicKey} /> : null}
            </div>
          ) : null}
        </section>
      ) : null}
      {pushPublicKey ? <PushDialogs siteTitle={siteTitle} /> : null}
      <Feed items={props.items} siteUrl={siteUrl} />
    </>
  )
}

// The bell that turns push notifications on and off, which its script
// (../../../public/push-notifications.js) runs, passing `data-state` up to here as it learns what
// this browser can do: until it does, the bell keeps its place, unseen, and it's gone where push
// notifications can't work. Without JavaScript, it's never seen.
function PushBell(props: { publicKey: string }): Html {
  return (
    <span id="push-notifications" class="push-bell" data-state="loading">
      <Tooltip label="Notify me of new posts">
        <Button
          variant="outline"
          size="icon"
          aria-label="Notify me of new posts"
          aria-pressed="false"
          data-public-key={props.publicKey}
          data-worker={urls.pushWorker()}
          data-subscribe-url={urls.pushNotifications()}
          data-unsubscribe-url={urls.removePushNotifications()}
        >
          <BellIcon class="bell-off" />
          <BellRingingIcon class="bell-on" />
          <BellSlashIcon class="bell-blocked" />
        </Button>
      </Tooltip>
    </span>
  )
}

// What the bell opens when it can't just turn notifications on: on iPhone and iPad, how to add
// the site to the Home Screen, where they work; how to allow notifications the browser blocks;
// and what went wrong, which the script fills in.
function PushDialogs(props: { siteTitle: string }): Html {
  let site = <span data-ignore>{props.siteTitle}</span>
  return (
    <>
      <DialogContent
        id="push-install"
        title="Add this site to your Home Screen"
        description={
          <>
            On iPhone and iPad, notifications work once {site} is on your Home Screen. It takes a
            moment:
          </>
        }
      >
        <ol class="push-steps">
          <li>
            Tap the Share button <ShareIcon class="inline-icon" /> in Safari. If you don’t see it,
            tap ⋯ first.
          </li>
          <li>
            Tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
          </li>
          <li>
            Open {site} from your Home Screen, and tap the bell <BellIcon class="inline-icon" />{' '}
            there.
          </li>
        </ol>
        <p class="push-note">Opened this page from another app? Open it in Safari first.</p>
        <DialogFooter>
          <DialogClose dialog="push-install" autofocus>
            Got it
          </DialogClose>
        </DialogFooter>
      </DialogContent>
      <DialogContent
        id="push-blocked"
        title="Notifications are blocked"
        description={
          <>
            Your browser is blocking notifications from {site}. Allow them in its settings for this
            site, then tap the bell again.
          </>
        }
      >
        <p class="push-note">
          On iPhone and iPad, they’re in Settings, under Notifications, then {site}.
        </p>
        <DialogFooter>
          <DialogClose dialog="push-blocked" autofocus>
            OK
          </DialogClose>
        </DialogFooter>
      </DialogContent>
      <DialogContent
        id="push-error"
        title="Couldn’t turn on notifications"
        description="Something went wrong. Try again in a while."
      >
        <DialogFooter>
          <DialogClose dialog="push-error" autofocus>
            OK
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </>
  )
}
