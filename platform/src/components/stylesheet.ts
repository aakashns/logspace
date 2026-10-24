// CSS as pages inline it. Each component and page imports the CSS file beside it as text, so the
// binary embeds it and `bun --watch` reloads on an edit, and passes it through `stylesheet` once,
// when it's imported. Every page inlines the document's styles (see document.tsx) and its own.

// The files joined, with comments and whitespace out. Not a CSS parser: it's only for these
// stylesheets, which have no strings or URLs with spaces in them, and it keeps the space before a
// colon, which in a selector like `.feed :is(img)` means a descendant. Bun's CSS minifier isn't
// used, as it rewrites light-dark() (which every browser this site supports has) into a much
// bigger fallback.
export function stylesheet(...files: string[]): string {
  return files
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};,>])\s*/g, '$1')
    .replace(/:\s+/g, ':')
    .replace(/;}/g, '}')
    .replace(/([^\d.\w-])0\.(\d)/g, '$1.$2')
    .trim()
}
