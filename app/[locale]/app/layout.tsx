import type { ReactNode } from 'react';
import { Toaster } from 'sonner';
import { AppShellProvider } from '@/components/app/app-shell-provider';
import { AppSidebar } from '@/components/app/app-sidebar';
import { CommandPaletteProvider } from '@/components/app/command-palette-context';
import { CommandPalette } from '@/components/app/command-palette';
import { OnboardingStepper } from '@/components/app/onboarding-stepper';
import { OnboardingControlsProvider } from '@/components/app/onboarding-context';

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
 * palette + onboarding stepper sit beside it so they share the same
 * portal root and z-stack.
 *
 * Context order (outermost → innermost):
 *   AppShellProvider             — wallet adapter + cross-surface SWR
 *   └─ OnboardingControlsProvider — exposes onboarding.open() to peers
 *      └─ CommandPaletteProvider  — global Cmd+K toggle
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppShellProvider>
      <OnboardingControlsProvider>
        <CommandPaletteProvider>
          <div className="flex min-h-dvh bg-[var(--bg)]">
            <AppSidebar />
            <main className="flex-1 min-w-0">{children}</main>
          </div>
          <CommandPalette />
          <OnboardingStepper />
          <Toaster
            position="bottom-right"
            richColors
            closeButton
            toastOptions={{ className: 'sonner-toast' }}
          />
        </CommandPaletteProvider>
      </OnboardingControlsProvider>
    </AppShellProvider>
  );
}
