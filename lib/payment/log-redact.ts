/**
 * Log redaction helpers.
 *
 * Anything that lands in stdout / stderr can be captured by the
 * container's log driver, the host log shipper, and downstream
 * aggregators. PII that flows through any of those layers is a real
 * controllership obligation — the privacy policy commits to not
 * persisting raw wallet addresses outside of confirmed payment
 * records, so the watcher and any future server-side logger must
 * shorten or drop them before emitting.
 *
 * `shortenAddress()` produces a `Hg7q…7Xf3` rendering: first-4 plus
 * last-4 characters separated by a horizontal ellipsis. Enough to
 * grep-correlate across a debug session without persisting the full
 * value. The shape matches how the UI already renders wallet pills.
 */

export function shortenAddress(addr: string | null | undefined): string {
  if (!addr) return 'unknown';
  if (addr.length < 12) return '***';
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

/**
 * Replace any sensitive token / signature with a fixed placeholder.
 * Use at log-statement boundaries when you're tempted to interpolate
 * a raw auth token or SIWS signature into a debug message.
 */
export function redactToken(_t: string | null | undefined): '[REDACTED]' {
  return '[REDACTED]';
}
