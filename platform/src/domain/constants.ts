// Numbers and names the app is built around.

// Cookie holding the user's chosen theme ('light' or 'dark'); absent means follow the system.
// A cookie rather than localStorage so the server renders the right theme on every request.
export const THEME_COOKIE_NAME = 'theme'

// How many of the newest posts the RSS feed has.
export const FEED_LENGTH = 50

// The app's name, which pages show as the site's title until the site has one.
export const APP_NAME = 'LogSpace'

// Behind the home screen icons, and the web app manifest's colors, when the icon has no opaque
// pixels to take a color from (see ../services/site-images.ts).
export const FALLBACK_ICON_BACKGROUND = '#ffffff'

// Limits on one submission of an /admin form. Uploaded files are held in memory until they're
// saved, so these also bound how much memory an upload takes. The total stays under Bun's limit
// on a request's body (128 MB), so a form over it gets the 413 page that says why.
export const MAX_UPLOAD_FILE_SIZE = 100 * 1024 * 1024
export const MAX_UPLOAD_TOTAL_SIZE = 120 * 1024 * 1024
// File inputs count even when no file is chosen, and a photos post has one per photo.
export const MAX_UPLOAD_FILES = 100

// The `sizes` of a photo shown across the content column (36rem wide inside its padding, see
// --content-width in theme.css), and of one in the feed's two-column photo grid, for choosing
// between a photo's resized copies (see images.ts).
export const FULL_WIDTH_IMAGE_SIZES = '(min-width: 38rem) 36rem, calc(100vw - 2rem)'
export const HALF_WIDTH_IMAGE_SIZES = '(min-width: 38rem) 18rem, calc(50vw - 1rem)'
