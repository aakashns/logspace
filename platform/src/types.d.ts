// Files Bun imports as text, which the binary embeds (see scripts/build.ts).
declare module '*.sql' {
  const text: string
  export default text
}
declare module '*.css' {
  const text: string
  export default text
}
declare module '*.png' {
  const path: string
  export default path
}
declare module '*.woff2' {
  const path: string
  export default path
}
// Datastar, served as a file (see http/assets.ts) rather than imported as a module. The browser's
// modules import it as `datastar`, typed by client/datastar.d.ts (see tsconfig.json).
declare module '*/datastar-rocket.js' {
  const path: string
  export default path
}
