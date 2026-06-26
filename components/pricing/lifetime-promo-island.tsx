'use client';

/**
 * LifetimePromoIsland — client wrapper that wires the auto-trigger
 * hook to the modal + the floating re-trigger pill. Mounted from
 * the server-rendered /pricing page as a single client boundary so
 * the rest of the page stays SSR.
 *
 * Behaviour change in v0.4: the retrigger pill now renders whenever
 * the user is on /pricing — not only after they dismissed the modal.
 * Previous "show pill only when modal closed" gating made the pill
 * feel intermittent (first paint auto-opens the modal → no pill →
 * dismiss → pill → reopen → no pill again). Always-visible reads as
 * "the persistent entry point to the lifetime deal" instead of "the
 * consolation prize after dismissal."
 *
 * The pill is suppressed for users who already hold the Elite
 * lifetime tier — no point dangling an upsell they already own.
 * This is the reason LifetimePromoIsland is now mounted INSIDE the
 * ActivePlanIsland tree (see app/[locale]/pricing/page.tsx).
 */

import {
  LifetimePromoModal,
  LifetimeRetriggerPill,
} from './lifetime-promo-modal';
import { useActivePlan } from './active-plan-island';
import { usePromoModalTrigger } from './use-promo-modal-trigger';

export function LifetimePromoIsland() {
  const { open, openManually, dismiss } = usePromoModalTrigger();
  const { subscription } = useActivePlan();
  const alreadyOnLifetime =
    subscription?.tier === 'elite' && subscription.isLifetime;

  return (
    <>
      <LifetimePromoModal open={open} onDismiss={dismiss} />
      <LifetimeRetriggerPill
        visible={!alreadyOnLifetime}
        onOpen={openManually}
      />
    </>
  );
}
