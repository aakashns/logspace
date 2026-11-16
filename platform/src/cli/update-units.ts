// Fixed systemd entry points installed by deploy. The app only writes presence markers.
export const updateService = (binary: string) => `[Unit]
Description=Update LogSpace and redeploy
After=network-online.target logspace.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=${binary} service-update
TimeoutStartSec=15min
UMask=0022
`
export const updatePath = `[Unit]
Description=Watch for LogSpace update requests
After=logspace.service

[Path]
PathExists=/var/lib/logspace/update-request
Unit=logspace-update.service

[Install]
WantedBy=multi-user.target
`
export const updateTimer = `[Unit]
Description=Check for LogSpace updates daily when enabled

[Timer]
OnCalendar=daily
RandomizedDelaySec=1h
Persistent=true
Unit=logspace-update.service

[Install]
WantedBy=timers.target
`
