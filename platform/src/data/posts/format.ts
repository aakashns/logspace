// How dates, sizes, and text read on pages.

// "16 Oct 2026, 1:12 PM UTC". Pages show UTC, since without JavaScript the server can't know the
// reader's time zone; <time datetime> has the exact moment for anything that can.
export function formatPostDate(iso: string): string {
  let parts = UTC_FORMAT.formatToParts(new Date(iso))
  let part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value
  return `${part('day')} ${part('month')} ${part('year')}, ${part('hour')}:${part('minute')} ${part('dayPeriod')} UTC`
}

// Assembled from parts because en-GB, which has this day-month-year order, spells September
// "Sept" and uses a 24-hour clock. Made once, since making one takes far longer than using it.
const UTC_FORMAT = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
})

// "3 MB", or "12 KB" for anything under a megabyte (at least 1 KB).
export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

// Text cut to `length` characters, with an ellipsis if it was longer.
export function clamp(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text
}
