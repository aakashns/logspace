import { installedConfigProblem, installedPathProblem, service } from './deploy.ts'
import { describe, expect, it } from 'bun:test'

describe('installed service policy', () => {
  it('runs unprivileged with only state/cache writable, and keeps JIT and networking usable', () => {
    let unit = service('/usr/local/bin/logspace')
    for (let directive of [
      'DynamicUser=yes',
      'Environment=HOST=127.0.0.1',
      'EnvironmentFile=/etc/logspace.env',
      'StateDirectory=logspace',
      'CacheDirectory=logspace',
      'StateDirectoryMode=0700',
      'CacheDirectoryMode=0700',
      'NoNewPrivileges=yes',
      'ProtectSystem=strict',
      'ProtectHome=yes',
      'PrivateTmp=yes',
      'PrivateDevices=yes',
      'CapabilityBoundingSet=',
      'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6',
      'UMask=0077',
    ])
      expect(unit.split('\n')).toContain(directive)
    expect(unit).not.toContain('\nMemoryDenyWriteExecute=yes')
    expect(unit).not.toContain('\nPrivateNetwork=yes')
  })
  it('accepts compatible existing settings and refuses unsafe overrides before altering the unit', () => {
    expect(
      installedConfigProblem('/usr/local/bin/logspace', new Map([['PORT', '44105']])),
    ).toBeUndefined()
    for (let [name, value] of [
      ['DATABASE_PATH', '/custom/app.sqlite'],
      ['MEDIA_DIR', '/home/photos'],
      ['CACHE_DIR', '/tmp/cache'],
      ['HOST', '::'],
      ['MEDIA_STORAGE', 'memory'],
      ['TRUST_PROXY', '0'],
    ]) {
      if (name && value)
        expect(
          installedConfigProblem('/usr/local/bin/logspace', new Map([[name, value]])),
        ).toContain(name)
    }
    expect(installedConfigProblem('/root/logspace', new Map())).toContain('/usr/local/bin')
    expect(installedConfigProblem('/opt/logspace%bad', new Map())).toContain('/usr/local/bin')
  })
  it('accepts systemd-owned directory links and refuses external storage links', () => {
    expect(
      installedPathProblem('/var/lib/logspace/media', '/var/lib/private/logspace/media'),
    ).toBeUndefined()
    expect(
      installedPathProblem('/var/cache/logspace', '/var/cache/private/logspace'),
    ).toBeUndefined()
    expect(installedPathProblem('/var/lib/logspace/app.sqlite', '/mnt/data/app.sqlite')).toContain(
      'custom unit',
    )
    expect(installedPathProblem('/var/lib/logspace/media', '/home/photos')).toContain('custom unit')
  })
})
