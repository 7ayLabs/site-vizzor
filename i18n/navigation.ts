/**
 * Locale-aware navigation primitives.
 *
 * Re-exports `<Link>`, `redirect`, `usePathname`, and `useRouter` that
 * transparently prepend the active locale to internal URLs. Use these
 * everywhere instead of the bare next/link / next/navigation versions when
 * routing inside the app (external `<a>` tags are unaffected).
 */
import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

export const { Link, redirect, usePathname, useRouter } =
  createNavigation(routing);
