/**
 * Canonical "Open App" link resolver.
 *
 *   Production →  https://app.vizzor.ai  (new tab)
 *   Dev / test →  /app/predict           (same tab, locale-aware via next-intl Link)
 *
 * An explicit `NEXT_PUBLIC_APP_URL` env var overrides both — if set,
 * it wins and `external` is inferred from whether it starts with
 * `http(s)://`. Useful for previewing the external-tab behavior in
 * dev (`NEXT_PUBLIC_APP_URL=https://app.vizzor.ai pnpm dev`) or for
 * pointing staging at a separate app deploy.
 *
 * Why a helper rather than hardcoding: three call sites today (navbar,
 * mobile drawer, hero CTA) and probably more later (CTA block,
 * onboarding modals, footer). Centralizing the resolution avoids the
 * "search-and-replace one URL" footgun.
 */

const PROD_APP_URL = 'https://app.vizzor.ai';
const INTERNAL_APP_PATH = '/app/predict';

export interface AppLinkTarget {
  /** Final href to render. */
  href: string;
  /** True when the link goes off-site — caller must add
   *  `target="_blank" rel="noopener noreferrer"` and (optionally) an
   *  aria-label suffix announcing the new-tab behavior. */
  external: boolean;
}

export function getAppLinkTarget(): AppLinkTarget {
  const override = process.env.NEXT_PUBLIC_APP_URL;
  if (override && override.length > 0) {
    return {
      href: override,
      external: /^https?:\/\//.test(override),
    };
  }
  if (process.env.NODE_ENV === 'production') {
    return { href: PROD_APP_URL, external: true };
  }
  return { href: INTERNAL_APP_PATH, external: false };
}

/** Convenience constant — the canonical INTERNAL path. Used by the
 *  Link variant of consumers so they don't import the helper just to
 *  read a fixed string. */
export const APP_INTERNAL_PATH = INTERNAL_APP_PATH;
