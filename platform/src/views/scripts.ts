// The browser's modules, in src/client/: TypeScript with its types stripped, which import Datastar
// as `datastar` (see the import map in document.tsx). `bun run build` makes them ahead of time and
// builds them into the binary; otherwise they're made when the server starts.
import * as path from 'node:path'

export interface ClientScripts {
  // The composer's component, <logspace-composer>.
  readonly composer: string
}

// Set by scripts/build.ts in the binary.
declare const LOGSPACE_CLIENT_SCRIPTS: ClientScripts | undefined

const CLIENT = path.resolve(import.meta.dir, '../client')

export async function loadClientScripts(): Promise<ClientScripts> {
  return typeof LOGSPACE_CLIENT_SCRIPTS === 'object'
    ? LOGSPACE_CLIENT_SCRIPTS
    : buildClientScripts()
}

export async function buildClientScripts(): Promise<ClientScripts> {
  let transpiler = new Bun.Transpiler({ loader: 'ts', target: 'browser' })
  let build = async (name: string) =>
    transpiler.transformSync(await Bun.file(path.join(CLIENT, name)).text())
  return { composer: await build('composer.ts') }
}
