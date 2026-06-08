/**
 * Mobile wallet bridge — universal-link handoff for iOS / Android.
 *
 * Why this exists:
 *   On a desktop browser, the Solana wallet adapter discovers Phantom /
 *   Solflare via the Wallet Standard registry that the browser extension
 *   publishes into `window.navigator.wallets`. There is no equivalent on
 *   mobile Safari / Chrome / Brave / Firefox — those browsers run no
 *   wallet extension, so the registry stays empty and any select() call
 *   times out with `wallet_not_installed`.
 *
 *   The mobile path that actually works is the wallet app's *in-app
 *   browser*, which IS Wallet-Standard-aware because the wallet runs the
 *   page inside its own webview and injects its provider. Universal /
 *   app links exist precisely so a normal mobile browser can hand the
 *   current URL to that in-app browser:
 *
 *     Phantom :  https://phantom.app/ul/browse/<encoded-url>?ref=<host>
 *     Solflare:  https://solflare.com/ul/v1/browse/<encoded-url>?ref=<host>
 *
 *   When `window.location.href = <universal link>` runs on iOS/Android,
 *   the OS opens the matching wallet app (or its install page if not
 *   installed) and the wallet's webview navigates to the same vizzor.ai
 *   page. At that point the wallet provider is in `window.navigator.wallets`
 *   and the existing WalletConnectFlow proceeds without changes.
 *
 * Inside the wallet's in-app browser:
 *   The UA usually contains the wallet name ("Phantom", "Solflare", ...).
 *   We deliberately do NOT treat that as a "mobile redirect target" —
 *   the wallet provider is already present, so the regular discovery
 *   path wins and there's nothing to hand off.
 */

const MOBILE_UA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
const WALLET_BROWSER_UA = /Phantom|Solflare|Backpack|Glow|TrustWallet/i;

/**
 * True when running in a regular mobile browser (iOS Safari/Chrome/Brave,
 * Android Chrome/Firefox/Samsung, etc.) AND not inside a wallet app's
 * in-app browser. The latter already has the wallet provider injected,
 * so we never want to redirect away from it.
 */
export function isMobileWeb(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  return MOBILE_UA.test(ua) && !WALLET_BROWSER_UA.test(ua);
}

export type UniversalLinkProviderId = 'phantom' | 'solflare';

/**
 * Returns the universal-link URL that asks the OS to open the current
 * page inside the named wallet's in-app browser. Used as the FALLBACK
 * in the mobile handoff — if the app's custom-scheme deeplink fails
 * because the app isn't installed, this navigates to phantom.app or
 * solflare.com which exposes an install / open-in-app prompt.
 *
 * Both wallets accept the URL-encoded target and an optional `ref`
 * parameter that lets analytics in their browser attribute the visit
 * back to the originating site.
 */
export function universalLinkFor(providerId: UniversalLinkProviderId): string | null {
  if (typeof window === 'undefined') return null;
  const target = encodeURIComponent(window.location.href);
  const ref = encodeURIComponent(window.location.host);
  switch (providerId) {
    case 'phantom':
      return `https://phantom.app/ul/browse/${target}?ref=${ref}`;
    case 'solflare':
      return `https://solflare.com/ul/v1/browse/${target}?ref=${ref}`;
  }
}

/**
 * Returns the wallet's *custom-scheme* deeplink — the app-only URL the
 * OS dispatches straight to the installed wallet with no website
 * round-trip. This is the PRIMARY mobile handoff target; the universal
 * link is only a fallback for the not-installed case.
 *
 * Why prefer this over the universal link:
 *   iOS universal-link interception relies on the wallet app's
 *   associated-domains entitlement being live for `phantom.app/ul/*`.
 *   After a fresh install, after iOS clears its smart-app-banner
 *   cache, or when the user has manually long-pressed a similar URL
 *   and chosen "Open in Safari", the universal link silently degrades
 *   to a normal HTTPS navigation — landing the user on phantom.app's
 *   website instead of inside the wallet. The custom URL scheme is
 *   not subject to any of that; the OS either has a registered
 *   handler (open the app) or it doesn't (we time out and fall back).
 */
export function appDeepLinkFor(providerId: UniversalLinkProviderId): string | null {
  if (typeof window === 'undefined') return null;
  const target = encodeURIComponent(window.location.href);
  const ref = encodeURIComponent(window.location.host);
  switch (providerId) {
    case 'phantom':
      return `phantom://browse/${target}?ref=${ref}`;
    case 'solflare':
      return `solflare://browse/${target}?ref=${ref}`;
  }
}
