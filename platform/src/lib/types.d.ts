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
// Datastar, and the push notifications' scripts, served as files (see http/assets.ts) rather
// than imported as modules.
declare module '*/datastar.js' {
  const path: string
  export default path
}
declare module '*/push-notifications.js' {
  const path: string
  export default path
}
declare module '*/push-worker.js' {
  const path: string
  export default path
}
