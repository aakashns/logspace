// How dates, sizes, and text read on pages.

// "16 Oct 2026, 6:42 PM" in the time zone of the timestamp's own UTC offset, i.e. the local time
// where it was posted, whatever time zone the server runs in.
export function formatPostDate(iso: string): string {
  let offset = iso.match(/[+-]\d{2}:\d{2}$/)?.[0] ?? 'UTC'
  let format = formats.get(offset)
  if (!format) {
    // Assembled from parts because en-GB, which has this day-month-year order, spells September
    // "Sept" and uses a 24-hour clock.
    format = new Intl.DateTimeFormat('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: offset,
    })
    formats.set(offset, format)
  }
  let parts = format.formatToParts(new Date(iso))
  let part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value
  return `${part('day')} ${part('month')} ${part('year')}, ${part('hour')}:${part('minute')} ${part('dayPeriod')}`
}

// Making an Intl.DateTimeFormat takes far longer than using one, and posts share a few offsets.
const formats = new Map<string, Intl.DateTimeFormat>()

// "3 MB", or "12 KB" for anything under a megabyte (at least 1 KB).
export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

// Text cut to `length` characters, with an ellipsis if it was longer.
export function clamp(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text
}
