import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { Toaster } from 'sonner';
import { AppShellProvider } from '@/components/app/app-shell-provider';
import { AppShellRail } from '@/components/app/app-shell-rail';
import { CommandPaletteProvider } from '@/components/app/command-palette-context';
import { CommandPalette } from '@/components/app/command-palette';
import { MobileAppNav } from '@/components/app/mobile-app-nav';
import { TourProvider } from '@/components/onboarding/tour-provider';
import { TourAutoStarter } from '@/components/onboarding/tour-auto-starter';
import { SpotlightTour } from '@/components/onboarding/spotlight-tour';

/**
 * Hosts that mount the product as the entire site (no marketing chrome).
 * On these hosts the outer surface rail is suppressed: the predict-shell
 * is the only meaningful surface for the v0.4 cut, and stacking the app
 * sidebar on top of predict-shell's own conversation rail produces the
 * double-rail layout the user flagged on `app.vizzor.ai`. Keep this list
 * aligned with `APP_HOSTS` in `middleware.ts`.
 */
const APP_ONLY_HOSTS = new Set<string>([
  'app.vizzor.ai',
  // Staging twin — same product-only chrome behavior as prod so QA
  // demos read identically. Aligned with `DEFAULT_APP_HOSTS` in
  // `middleware.ts` (host-rewrite must match the shell suppression).
  'testapp.vizzor.ai',
]);

/**
 * App shell layout — wraps every `/app/*` surface (Chat, Whales, Flow,
 * Billing, Settings, ...) with the persistent sidebar + shared wallet
 * adapter + cross-surface SWR context.
 *
 * No marketing chrome here — Header/Footer/Ticker live in the sibling
 * `(marketing)` route group. Surface switches inside `/app/*` keep the
 * wallet adapter mounted so SIWS session, conversation state, and
 * Phantom's connection survive without remounting.
 *
 * Toaster is mounted once at this layer for cross-surface notifications
 * (wallet disconnect, subscription confirmed, engine offline). Command
 * palette + guided tour sit beside it so they share the same portal
 * root and z-stack.
 *
 * v0.5.16 — the 4-step OnboardingStepper (connect → siws → trial-intro
 * → done) was retired here. The SpotlightTour that fires post-SIWS
 * already teaches the surface, and doubling up modals on top of the
 * wallet-adapter flow was noise. The stepper's old mount + its
 * controls-provider are gone from the tree.
 *
 * Context order (outermost → innermost):
 *   AppShellProvider           — wallet adapter + cross-surface SWR
 *   └─ TourProvider            — v0.5.4 first-time-login tour state
 *      └─ CommandPaletteProvider — global Cmd+K toggle
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  // Read the Host header server-side so the suppression decision happens
  // before the client hydrates. Doing this on the client would create a
  // hydration mismatch (server URL is the rewritten `/app/predict`, browser
  // URL is still `/`, so `usePathname()` disagrees about whether the
  // suppression regex matches — the symptom Zaid saw on app.vizzor.ai).
  const reqHeaders = await headers();
  const host = (reqHeaders.get('host') ?? '').split(':')[0]?.toLowerCase() ?? '';
  const isAppOnlyHost = APP_ONLY_HOSTS.has(host);

  return (
    <AppShellProvider>
      <TourProvider>
        <CommandPaletteProvider>
          <div className="flex flex-col min-h-dvh bg-[var(--bg)]">
            {/* Mobile hamburger + slide-in drawer for surfaces below
                the `lg` breakpoint. Must sit BEFORE the flex row so
                its `sticky top-0` actually anchors to the viewport
                top (otherwise it renders after a min-h-dvh sibling
                and appears at the bottom of the viewport). Self-
                suppresses on /app/predict. */}
            <MobileAppNav />
            <div className="flex flex-1 min-h-0">
              <AppShellRail isAppOnlyHost={isAppOnlyHost} />
              <main className="flex-1 min-w-0">{children}</main>
            </div>
          </div>
          <CommandPalette />
          {/* v0.5.4 — first-time-login guided tour. Auto-starter
              is a null-rendering effect that watches the SIWS
              session transition; SpotlightTour is the overlay
              (portal to document.body, only rendered when open). */}
          <TourAutoStarter />
          <SpotlightTour />
          <Toaster
            position="bottom-right"
            richColors
            closeButton
            toastOptions={{ className: 'sonner-toast' }}
          />
        </CommandPaletteProvider>
      </TourProvider>
    </AppShellProvider>
  );
}
