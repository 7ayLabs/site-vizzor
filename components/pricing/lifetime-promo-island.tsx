'use client';

/**
 * LifetimePromoIsland — client wrapper that wires the auto-trigger
 * hook to the modal + the floating re-trigger pill. Mounted from
 * the server-rendered /pricing page as a single client boundary so
 * the rest of the page stays SSR.
 */

import {
  LifetimePromoModal,
  LifetimeRetriggerPill,
} from './lifetime-promo-modal';
import { usePromoModalTrigger } from './use-promo-modal-trigger';

export function LifetimePromoIsland() {
  const { open, openManually, dismiss } = usePromoModalTrigger();
  return (
    <>
      <LifetimePromoModal open={open} onDismiss={dismiss} />
      <LifetimeRetriggerPill visible={!open} onOpen={openManually} />
    </>
  );
}
