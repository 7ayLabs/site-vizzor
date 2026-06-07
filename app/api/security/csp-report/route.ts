/**
 * CSP violation report sink.
 *
 * Browsers POST a JSON body conforming to either the legacy
 * `csp-report` shape or the modern Reporting API `application/reports+json`
 * shape. We accept both, log a redacted summary, and return 204.
 *
 * The body is **never persisted** — CSP reports contain enough
 * context to fingerprint user agents and visited URLs, and accepting
 * arbitrary JSON from anonymous callers is a low-grade DoS vector.
 * Treat this endpoint as a write-only telemetry pipe: log just enough
 * to spot a misconfigured directive (`violated-directive`,
 * `blocked-uri` host, document URI path) and drop everything else.
 *
 * Rate-limited per-IP to defend against report floods.
 */

import { NextRequest, NextResponse } from 'next/server';
import { enforceRateLimit } from '@/lib/payment/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface LegacyCspReport {
  'csp-report'?: {
    'violated-directive'?: string;
    'blocked-uri'?: string;
    'document-uri'?: string;
    'effective-directive'?: string;
    disposition?: string;
  };
}

interface ReportingApiEntry {
  type?: string;
  url?: string;
  body?: {
    effectiveDirective?: string;
    blockedURL?: string;
    documentURL?: string;
    disposition?: string;
  };
}

function safeHost(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return 'invalid';
  }
}

function safePath(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).pathname;
  } catch {
    return 'invalid';
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const limited = enforceRateLimit(req, 'security.csp-report');
  if (limited) return limited as unknown as NextResponse;

  let directive = '';
  let blockedHost = '';
  let documentPath = '';
  let disposition = '';

  try {
    const body = (await req.json()) as
      | LegacyCspReport
      | ReportingApiEntry[];

    if (Array.isArray(body)) {
      // Reporting API shape: array of report entries.
      const entry = body[0];
      directive = entry?.body?.effectiveDirective ?? '';
      blockedHost = safeHost(entry?.body?.blockedURL);
      documentPath = safePath(entry?.body?.documentURL);
      disposition = entry?.body?.disposition ?? '';
    } else {
      const r = body?.['csp-report'];
      directive =
        r?.['effective-directive'] ?? r?.['violated-directive'] ?? '';
      blockedHost = safeHost(r?.['blocked-uri']);
      documentPath = safePath(r?.['document-uri']);
      disposition = r?.disposition ?? '';
    }
  } catch {
    // Malformed JSON — drop silently, browsers don't retry.
    return new NextResponse(null, { status: 204 });
  }

  // Structured log line — short, no PII, no full URLs.
  // eslint-disable-next-line no-console
  console.warn(
    `[csp-report] directive=${directive || '?'} ` +
      `blocked=${blockedHost || '?'} path=${documentPath || '?'} ` +
      `disposition=${disposition || '?'}`,
  );

  return new NextResponse(null, { status: 204 });
}
