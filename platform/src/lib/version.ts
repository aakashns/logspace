import packageJson from '../../package.json' with { type: 'json' }

export const VERSION = packageJson.version

// Stable releases only; never roll a newer installation back.
export function compareVersions(a: string, b: string): number {
  let x = a.split('.').map(Number)
  let y = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    let difference = (x[i] ?? 0) - (y[i] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}
