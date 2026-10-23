// Files Bun imports as text, which the binary embeds (see scripts/build.ts).
declare module '*.sql' {
  const text: string
  export default text
}
declare module '*.css' {
  const text: string
  export default text
}
declare module '*.woff2' {
  const path: string
  export default path
}
// Datastar, served as a file (see http/assets.ts) rather than imported as a module.
declare module '*/datastar.js' {
  const path: string
  export default path
}
// sharp's native files, embedded in the binary (see scripts/build.ts).
declare module 'logspace:sharp-files' {
  const files: { embedded: string; layout: string }[]
  export default files
}
// The load generator scripts/bench.ts uses, which has no types of its own.
declare module 'autocannon'
