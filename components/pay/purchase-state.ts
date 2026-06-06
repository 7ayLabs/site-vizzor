/**
 * Purchase-flow state machine — explicit, type-safe transitions.
 *
 * The pre-v0.2.0 checkout shell carried two parallel pieces of
 * implicit state — a `StatusValue` string and an optional `reason`
 * string — that the renderer joined ad-hoc. The state space was easy
 * to read but easy to drift: nothing prevented a `confirmed` state
 * with an `engine_marked_failed` reason, or an `awaiting_wallet`
 * state with no live session. v0.2.0 makes the state a discriminated
 * union so every state carries only the data it legitimately needs,
 * and the renderer can never read a field that does not exist on the
 * current state.
 *
 * The transition function is `next()`. Every state mutation goes
 * through it; the checkout shell never assigns a state directly. This
 * gives us:
 *
 *   1. One audit point for invalid transitions (return current state).
 *   2. A pure reducer signature that's trivial to test in isolation.
 *   3. Compile-time guarantees on the renderer side (`switch (s.kind)`
 *      narrowing covers every branch via `assertNever`).
 *
 * State diagram (also reproduced in `docs/rfc/v0.2.0/purchase-ux.md`):
 *
 *   idle
 *    ├──► connecting          (user clicks "Start payment")
 *    │     ├──► wrong-network (selector chain off, flag flipped mid-flow)
 *    │     ├──► signing       (session created, prompting wallet)
 *    │     └──► error         (session create failed)
 *    │
 *    signing
 *    ├──► paying              (wallet signed → broadcasted)
 *    └──► error               (wallet rejected, mint missing, etc.)
 *
 *    paying
 *    ├──► confirming          (watcher saw the tx, finalizing)
 *    └──► error               (engine marked failed / RPC outage)
 *
 *    confirming
 *    ├──► done                (grant code minted)
 *    └──► error               (engine marked failed late)
 *
 *    any pending → expired    (session TTL elapsed; explicit branch)
 *    any state   → error      (carries reason)
 *    error / expired / wrong-network → idle (retry)
 *
 * Every transition returns a fully-typed next state — `done` carries
 * the session + grant code, `error` carries the PaymentReason, `idle`
 * has nothing, and so on.
 */

import type { PaymentSession } from '@/lib/payment/session';
import { normalizeReason, type PaymentReason } from '@/lib/payment/errors';

/* ────────────── state union ────────────── */

interface BaseState {
  kind: PurchaseStateKind;
}

interface IdleState extends BaseState {
  kind: 'idle';
}

interface ConnectingState extends BaseState {
  kind: 'connecting';
}

interface WrongNetworkState extends BaseState {
  kind: 'wrong-network';
  /** The chain we expected (selector value). */
  expected: PaymentSession['chain'];
}

interface SigningState extends BaseState {
  kind: 'signing';
  session: PaymentSession;
}

interface PayingState extends BaseState {
  kind: 'paying';
  session: PaymentSession;
  /** Tx signature returned by the wallet (Solana base58, or TON hash). */
  txSig?: string;
}

interface ConfirmingState extends BaseState {
  kind: 'confirming';
  session: PaymentSession;
}

interface DoneState extends BaseState {
  kind: 'done';
  session: PaymentSession;
  grantCode: string;
}

interface ExpiredState extends BaseState {
  kind: 'expired';
  /** The session that expired, if we ever had one. */
  session: PaymentSession | null;
}

interface ErrorState extends BaseState {
  kind: 'error';
  reason: PaymentReason;
  /** The session at the time of failure, if any. Used to render context. */
  session: PaymentSession | null;
}

export type PurchaseState =
  | IdleState
  | ConnectingState
  | WrongNetworkState
  | SigningState
  | PayingState
  | ConfirmingState
  | DoneState
  | ExpiredState
  | ErrorState;

export type PurchaseStateKind = PurchaseState['kind'];

/* ────────────── events ────────────── */

interface StartEvent {
  type: 'start';
}
interface SessionCreatedEvent {
  type: 'session-created';
  session: PaymentSession;
}
interface SessionCreateFailedEvent {
  type: 'session-create-failed';
  reason: string;
}
interface WrongNetworkEvent {
  type: 'wrong-network';
  expected: PaymentSession['chain'];
}
interface TxSignedEvent {
  type: 'tx-signed';
  txSig: string;
}
interface WalletErrorEvent {
  type: 'wallet-error';
  reason: string;
}
interface PollUpdateEvent {
  type: 'poll-update';
  session: PaymentSession;
}
interface PollExpiredEvent {
  type: 'poll-expired';
}
interface PollErrorEvent {
  type: 'poll-error';
  reason: string;
}
interface ResetEvent {
  type: 'reset';
}

export type PurchaseEvent =
  | StartEvent
  | SessionCreatedEvent
  | SessionCreateFailedEvent
  | WrongNetworkEvent
  | TxSignedEvent
  | WalletErrorEvent
  | PollUpdateEvent
  | PollExpiredEvent
  | PollErrorEvent
  | ResetEvent;

/* ────────────── helpers ────────────── */

export function initial(): PurchaseState {
  return { kind: 'idle' };
}

function errorWith(
  reason: string,
  session: PaymentSession | null,
): ErrorState {
  return { kind: 'error', reason: normalizeReason(reason), session };
}

function carrySession(s: PurchaseState): PaymentSession | null {
  switch (s.kind) {
    case 'signing':
    case 'paying':
    case 'confirming':
    case 'done':
      return s.session;
    case 'expired':
    case 'error':
      return s.session;
    default:
      return null;
  }
}

/* ────────────── reducer ────────────── */

export function next(state: PurchaseState, event: PurchaseEvent): PurchaseState {
  // Reset is universally accepted — drops back to idle from anywhere.
  if (event.type === 'reset') return { kind: 'idle' };

  switch (state.kind) {
    case 'idle': {
      if (event.type === 'start') return { kind: 'connecting' };
      return state;
    }

    case 'connecting': {
      if (event.type === 'session-created') {
        return { kind: 'signing', session: event.session };
      }
      if (event.type === 'session-create-failed') {
        return errorWith(event.reason, null);
      }
      if (event.type === 'wrong-network') {
        return { kind: 'wrong-network', expected: event.expected };
      }
      return state;
    }

    case 'wrong-network': {
      // Only `reset` and a fresh `start` move us out. `start` is the
      // user re-clicking the CTA after switching chains.
      if (event.type === 'start') return { kind: 'connecting' };
      return state;
    }

    case 'signing': {
      if (event.type === 'tx-signed') {
        return { kind: 'paying', session: state.session, txSig: event.txSig };
      }
      if (event.type === 'wallet-error') {
        return errorWith(event.reason, state.session);
      }
      if (event.type === 'poll-expired') {
        return { kind: 'expired', session: state.session };
      }
      return state;
    }

    case 'paying': {
      if (event.type === 'poll-update') {
        const session = event.session;
        if (session.status === 'confirmed' && session.grantCode) {
          return { kind: 'done', session, grantCode: session.grantCode };
        }
        if (session.status === 'confirmed') {
          return { kind: 'confirming', session };
        }
        if (session.status === 'expired') {
          return { kind: 'expired', session };
        }
        if (session.status === 'failed') {
          return errorWith('engine_marked_failed', session);
        }
        // status === 'pending' — stay in `paying` until we see confirmed.
        return { kind: 'paying', session, txSig: state.txSig };
      }
      if (event.type === 'poll-expired') {
        return { kind: 'expired', session: state.session };
      }
      if (event.type === 'poll-error') {
        return errorWith(event.reason, state.session);
      }
      if (event.type === 'wallet-error') {
        return errorWith(event.reason, state.session);
      }
      return state;
    }

    case 'confirming': {
      if (event.type === 'poll-update') {
        const session = event.session;
        if (session.status === 'confirmed' && session.grantCode) {
          return { kind: 'done', session, grantCode: session.grantCode };
        }
        if (session.status === 'failed') {
          return errorWith('engine_marked_failed', session);
        }
        // Stay in confirming while we wait for the grant code mint.
        return { kind: 'confirming', session };
      }
      if (event.type === 'poll-expired') {
        // Confirmed-but-no-grant past the poll wall clock is an error,
        // not a benign expiry — the payment landed but the grant pipe
        // is stuck. Surface as transient so retry path is offered.
        return errorWith('session_failed', state.session);
      }
      if (event.type === 'poll-error') {
        return errorWith(event.reason, state.session);
      }
      return state;
    }

    case 'done': {
      // Terminal. Only `reset` (handled above) moves us out.
      return state;
    }

    case 'expired':
    case 'error': {
      // Recovery paths run through `reset` (handled above). Anything
      // else is a no-op.
      return state;
    }

    default:
      return assertNever(state);
  }
}

/* ────────────── selectors for the renderer ────────────── */

/** The session attached to the current state, if any. */
export function sessionOf(state: PurchaseState): PaymentSession | null {
  return carrySession(state);
}

/** True if the current state is mid-flight (any non-terminal busy state). */
export function isBusy(state: PurchaseState): boolean {
  switch (state.kind) {
    case 'connecting':
    case 'signing':
    case 'paying':
    case 'confirming':
      return true;
    default:
      return false;
  }
}

/** True if `Retry` should be shown next to the status banner. */
export function isRecoverable(state: PurchaseState): boolean {
  return state.kind === 'error' || state.kind === 'expired';
}

/** True if the pay button itself should be hidden (state owns the CTA). */
export function ctaHidden(state: PurchaseState): boolean {
  return (
    state.kind === 'error' ||
    state.kind === 'expired' ||
    state.kind === 'done' ||
    state.kind === 'wrong-network'
  );
}

function assertNever(value: never): never {
  throw new Error(`unhandled purchase state: ${JSON.stringify(value)}`);
}
