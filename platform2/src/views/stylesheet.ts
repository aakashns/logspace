// The site's stylesheets: styles/site.css with its imports joined, minified, and the heading font
// embedded, inlined into every page so first paint doesn't wait on a request for it, and
// styles/admin.css, which the pages under /admin add. `bun run build` makes them ahead of time and
// builds them into the binary; otherwise they're made when the server starts.
import * as path from 'node:path'

export interface Stylesheets {
  readonly site: string
  readonly admin: string
}

// Set by scripts/build.ts in the binary.
declare const LOGSPACE_STYLESHEETS: Stylesheets | undefined

// Fonts the stylesheet embeds as data URLs, so headings render in them from the first paint (see
// theme.css).
const EMBEDDED_FONTS = ['/fonts/instrument-sans-latin-600.woff2']

const ROOT = path.resolve(import.meta.dir, '../..')

export async function loadStylesheets(): Promise<Stylesheets> {
  return typeof LOGSPACE_STYLESHEETS === 'object' ? LOGSPACE_STYLESHEETS : buildStylesheets()
}

export async function buildStylesheets(): Promise<Stylesheets> {
  let [site, admin] = await Promise.all(
    ['site.css', 'admin.css'].map(async (name) =>
      minify(await joinImports(path.join(import.meta.dir, 'styles', name))),
    ),
  )
  return { site: await embedFonts(site), admin }
}

async function embedFonts(css: string): Promise<string> {
  for (let href of EMBEDDED_FONTS) {
    let font = await Bun.file(path.join(ROOT, 'public', href)).bytes()
    let dataUrl = `url("data:font/woff2;base64,${font.toBase64()}")`
    let embedded = css.replace(/url\("?([^")]+)"?\)/g, (match, url) =>
      url === href ? dataUrl : match,
    )
    if (embedded === css) throw new Error(`The stylesheet doesn't reference ${href}`)
    css = embedded
  }
  return css
}

// The file with each `@import './file.css';` replaced by that file.
async function joinImports(file: string): Promise<string> {
  let css = await Bun.file(file).text()
  let imports = [...css.matchAll(/@import '([^']+)';/g)]
  let joined = await Promise.all(
    imports.map((match) => joinImports(path.join(path.dirname(file), match[1]))),
  )
  return imports.reduce((result, match, i) => result.replace(match[0], () => joined[i]), css)
}

// Comments and whitespace out. Not a CSS parser: it's only for these stylesheets, which have no
// strings or URLs with spaces in them, and it keeps the space before a colon, which in a selector
// like `.prose :is(img)` means a descendant. Bun's CSS minifier isn't used, as it rewrites
// light-dark() (which every browser this site supports has) into a much bigger fallback.
function minify(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};,>])\s*/g, '$1')
    .replace(/:\s+/g, ':')
    .replace(/;}/g, '}')
    .replace(/([^\d.\w-])0\.(\d)/g, '$1.$2')
    .trim()
}
