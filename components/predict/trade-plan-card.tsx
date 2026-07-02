'use client';

/**
 * TradePlanCard — the in-thread rendering of an engine-emitted
 * TradePlan.
 *
 * Phase 1 of the auto-trade roadmap: instead of asking Vizzor to
 * execute directly (which would need a custody/session-vault stack
 * that's a $250K + 6-month project), the engine emits a structured
 * plan and the site renders each level as an actionable row. The
 * user gets:
 *
 *   [SET ALERT]     → POSTs to /api/alerts; the alert fires when the
 *                     price crosses the level, at which point Vizzor
 *                     drops an intent card back into the chat.
 *   [OPEN JUPITER]  → mainnet-only deep-link that opens Jupiter's
 *                     terminal with the swap prefilled (1 click to
 *                     execute). Hidden on devnet / when the base
 *                     asset isn't in the mint registry.
 *
 * The visual language mirrors the intent chat card + trade tag so
 * the three surfaces (trade plan, alert row, intent card) all read
 * as one system.
 */

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CoinIcon } from '@/components/ui/coin-icon';
import { cn } from '@/lib/utils';
import type {
  TradePlan,
  TradePlanLevel,
  TradePlanLevelKind,
} from '@/lib/trade/trade-plan';
import {
  isJupiterSymbolSupported,
  jupiterPlanFromLevel,
  jupiterSwapUrl,
} from '@/lib/trade/jupiter-deeplink';

interface TradePlanCardProps {
  plan: TradePlan;
  /**
   * Which Solana cluster this session is transacting on. Drives
   * whether the Jupiter deep-link is enabled (mainnet-beta only) —
   * Jupiter has no devnet deployment.
   */
  network: 'mainnet-beta' | 'devnet' | 'testnet';
  /**
   * v0.5.2 — user-confirmation bridge. When the engine's LLM
   * correctly refuses to auto-send winnings (it can't hold user
   * keys — see docs/rfc/vizzor-engine-v0.5.1.md § roadmap), the
   * user still needs a one-tap path to move the profit. The card
   * exposes an inline amount input + "Sign & send" button that
   * calls this handler; the parent mints an intent and mounts the
   * existing IntentChatCard for the wallet signature. Only rendered
   * when the plan carries a `proceeds_to` address.
   */
  onProceedsSend?: (opts: {
    toAddr: string;
    amount: string;
    symbol: string;
  }) => Promise<void> | void;
}

type LevelActionState =
  | { kind: 'idle' }
  | { kind: 'arming' }
  | { kind: 'armed'; alertId?: string }
  | { kind: 'error'; message: string };

export function TradePlanCard({
  plan,
  network,
  onProceedsSend,
}: TradePlanCardProps) {
  const t = useTranslations('predict.tradePlan');
  const [levelStates, setLevelStates] = useState<
    Record<TradePlanLevelKind, LevelActionState>
  >({
    entry: { kind: 'idle' },
    tp1: { kind: 'idle' },
    tp2: { kind: 'idle' },
    sl: { kind: 'idle' },
  });

  const armAlert = useCallback(
    async (level: TradePlanLevel) => {
      setLevelStates((s) => ({ ...s, [level.kind]: { kind: 'arming' } }));
      const direction = directionForLevel(level.kind, plan.direction);
      try {
        const res = await fetch('/api/alerts', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            symbol: (plan.base_asset ?? plan.symbol).toUpperCase(),
            kind: level.kind,
            direction,
            price: level.price,
          }),
        });
        const data = (await res.json()) as {
          ok: boolean;
          alert?: { id: string };
          reason?: string;
        };
        if (!res.ok || !data.ok) {
          setLevelStates((s) => ({
            ...s,
            [level.kind]: {
              kind: 'error',
              message: data.reason ?? `http_${res.status}`,
            },
          }));
          return;
        }
        setLevelStates((s) => ({
          ...s,
          [level.kind]: { kind: 'armed', alertId: data.alert?.id },
        }));
      } catch (e) {
        setLevelStates((s) => ({
          ...s,
          [level.kind]: {
            kind: 'error',
            message: e instanceof Error ? e.message : 'network',
          },
        }));
      }
    },
    [plan.base_asset, plan.direction, plan.symbol],
  );

  const armAll = useCallback(async () => {
    // Fire in parallel — each row updates its own state.
    await Promise.all(plan.levels.map((l) => armAlert(l)));
  }, [plan.levels, armAlert]);

  const nowLocalHms = new Date(plan.issued_at).toLocaleTimeString(undefined, {
    hour12: false,
  });
  const directionLabel = plan.direction === 'long' ? t('long') : t('short');
  const shortPlanId = plan.plan_id.replace(/^plan_/, '').slice(0, 8);
  const baseSymbol = (plan.base_asset ?? plan.symbol).toUpperCase();
  const jupiterOk = isJupiterSymbolSupported(baseSymbol);

  return (
    <div className="flex flex-col gap-1.5 motion-safe:vz-stream-in max-w-[560px]">
      {/* Header line — same vocabulary as the intent card + assistant
          bubble timestamps: VIZZOR · HH:MM:SS · PLAN #id · SYMBOL LONG */}
      <div className="mono tabular text-[9.5px] uppercase tracking-[0.18em] text-[var(--fg-3)] flex items-center gap-2 flex-wrap">
        <span>VIZZOR · {nowLocalHms} · {t('label').toUpperCase()}</span>
        <span
          className={cn(
            'inline-flex items-center h-[16px] px-1.5 rounded',
            'border border-[var(--border)] text-[var(--fg-3)]',
          )}
        >
          #{shortPlanId}
        </span>
        <span
          className="inline-flex items-center gap-1"
          style={{
            color:
              plan.direction === 'long' ? 'var(--up)' : 'var(--down)',
          }}
        >
          <CoinIcon symbol={baseSymbol} size={10} />
          <span className="font-semibold">{baseSymbol}</span>
          <span aria-hidden>·</span>
          <span>{directionLabel}</span>
        </span>
        {typeof plan.horizon_hours === 'number' && (
          <span className="text-[var(--fg-3)]">
            {plan.horizon_hours}h
          </span>
        )}
      </div>

      <div
        className={cn(
          'rounded-xl',
          'border border-[var(--border)]',
          'bg-[var(--surface)]',
        )}
      >
        {/* Title strip — same as intent card. */}
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-[var(--border)]">
          <span className="text-[12.5px] text-[var(--fg)]">
            {t('title')}
          </span>
          {typeof plan.confidence === 'number' && (
            <span className="mono tabular text-[9.5px] uppercase tracking-[0.18em] text-[var(--fg-3)]">
              {t('confidence')} {Math.round(plan.confidence * 100)}%
            </span>
          )}
        </div>

        {/* Level rows — one per Entry/TP1/TP2/SL. */}
        <div className="divide-y divide-[var(--border)]">
          {plan.levels.map((level) => (
            <LevelRow
              key={level.kind}
              level={level}
              baseSymbol={baseSymbol}
              network={network}
              direction={plan.direction}
              positionSize={plan.size_base ?? null}
              state={levelStates[level.kind]}
              onArm={() => void armAlert(level)}
              jupiterOk={jupiterOk}
            />
          ))}
        </div>

        {/* v0.5.2 — Send-winnings confirmation row. Only mounts when
            the plan carries a `proceeds_to` wallet AND the parent
            wired the `onProceedsSend` handler. The card is the
            "user confirmation" surface the engine correctly declined
            to bypass: user enters amount, hits Sign, IntentChatCard
            handles the wallet prompt. */}
        {plan.proceeds_to && onProceedsSend && (
          <ProceedsSend
            proceedsTo={plan.proceeds_to}
            symbol={(plan.base_asset ?? plan.symbol).toUpperCase()}
            defaultAmount={plan.size_base ?? null}
            onSubmit={(amount) =>
              Promise.resolve(
                onProceedsSend({
                  toAddr: plan.proceeds_to!,
                  amount,
                  symbol: (plan.base_asset ?? plan.symbol).toUpperCase(),
                }),
              )
            }
          />
        )}

        {/* Footer — bulk arm-all + proceeds destination reminder. */}
        <div className="px-3.5 py-2.5 border-t border-[var(--border)] flex items-center justify-between gap-3">
          <div className="min-w-0 text-[10.5px] text-[var(--fg-3)]">
            {plan.proceeds_to ? (
              <span className="mono tabular">
                {t('proceedsTo')} {shorten(plan.proceeds_to)}
              </span>
            ) : (
              <span>{t('footerHint')}</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => void armAll()}
            className={cn(
              'inline-flex items-center justify-center rounded-md h-6 px-2.5',
              'text-[10.5px] font-semibold mono tabular uppercase tracking-[0.16em]',
              'bg-[var(--fg)] text-[var(--bg)]',
              'hover:opacity-90 active:scale-95',
              'transition-[opacity,transform] duration-150',
            )}
          >
            {t('armAll')}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * ProceedsSend — the "user confirmation" row on the trade plan card.
 * The engine's LLM correctly refuses to auto-execute an outbound
 * transfer (no custody), so this component gives the user a
 * one-input, one-button path to the same outcome: fill amount →
 * click Sign → parent mints an intent → IntentChatCard prompts
 * the wallet. Same trust model as the /transfer command syntax,
 * lifted into the trade plan for a natural in-context handoff.
 */
function ProceedsSend({
  proceedsTo,
  symbol,
  defaultAmount,
  onSubmit,
}: {
  proceedsTo: string;
  symbol: string;
  defaultAmount: number | null;
  onSubmit: (amount: string) => Promise<void>;
}) {
  const t = useTranslations('predict.tradePlan');
  const [amount, setAmount] = useState<string>(
    defaultAmount ? String(defaultAmount) : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSubmit =
    amount.trim().length > 0 &&
    Number.isFinite(Number(amount)) &&
    Number(amount) > 0 &&
    !busy;

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(amount.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error');
    } finally {
      setBusy(false);
    }
  }, [amount, canSubmit, onSubmit]);

  return (
    <div className="border-t border-[var(--border)] px-3.5 py-2.5 flex flex-col gap-1.5">
      <div className="mono tabular text-[9.5px] uppercase tracking-[0.18em] text-[var(--fg-3)]">
        {t('sendWinningsTitle')}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <label
          className={cn(
            'inline-flex items-center gap-1.5',
            'h-7 px-2 rounded-md',
            'border border-[var(--border)] bg-[var(--surface)]',
            'text-[11px]',
          )}
        >
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={cn(
              'w-16 bg-transparent outline-none',
              'mono tabular text-[11px] text-[var(--fg)]',
              'placeholder:text-[var(--fg-3)]',
            )}
            aria-label={t('sendWinningsAmount')}
          />
          <span className="mono tabular text-[10px] text-[var(--fg-3)] uppercase">
            {symbol}
          </span>
        </label>
        <span className="mono tabular text-[9.5px] text-[var(--fg-3)] flex-1 min-w-0 truncate">
          → {shorten(proceedsTo)}
        </span>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit}
          className={cn(
            'inline-flex items-center justify-center rounded-md h-7 px-2.5',
            'text-[10.5px] font-semibold mono tabular uppercase tracking-[0.16em]',
            'bg-[var(--fg)] text-[var(--bg)]',
            'hover:opacity-90 active:scale-95',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            'transition-[opacity,transform] duration-150',
          )}
        >
          {busy ? t('preparing') : t('signAndSend')}
        </button>
      </div>
      {error && (
        <div className="text-[10.5px] text-[var(--down)]">{error}</div>
      )}
    </div>
  );
}

function LevelRow({
  level,
  baseSymbol,
  network,
  direction,
  positionSize,
  state,
  onArm,
  jupiterOk,
}: {
  level: TradePlanLevel;
  baseSymbol: string;
  network: 'mainnet-beta' | 'devnet' | 'testnet';
  direction: 'long' | 'short';
  positionSize: number | null;
  state: LevelActionState;
  onArm: () => void;
  jupiterOk: boolean;
}) {
  const t = useTranslations('predict.tradePlan');
  const kindLabel = t(`levels.${level.kind}`);
  const isEntry = level.kind === 'entry';
  const isStop = level.kind === 'sl';
  // Only render a Jupiter deep-link if the network supports it AND
  // we have a position size to use — sizing an "open" swap without a
  // position is meaningless and would confuse the user.
  const jupiterUrl =
    jupiterOk && positionSize && positionSize > 0
      ? jupiterSwapUrl(
          jupiterPlanFromLevel({
            direction,
            kind: level.kind,
            baseSymbol,
            amountBase: computeLevelSize(level, positionSize),
          })!,
          network,
        )
      : null;
  return (
    <div className="px-3.5 py-2.5 grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1 items-center">
      <div className="row-span-2 inline-flex items-center gap-2">
        <LevelKindPill kind={level.kind} />
      </div>
      <div className="min-w-0 flex items-center gap-2 flex-wrap text-[11.5px] text-[var(--fg)]">
        <span className="mono tabular font-semibold">
          ${formatPrice(level.price)}
        </span>
        {typeof level.deltaFromEntryPct === 'number' && !isEntry && (
          <DeltaBadge pct={level.deltaFromEntryPct} isStop={isStop} />
        )}
        {typeof level.positionPct === 'number' && !isEntry && !isStop && (
          <span className="mono tabular text-[9.5px] text-[var(--fg-3)] uppercase tracking-[0.18em]">
            {Math.round(level.positionPct * 100)}% {t('close')}
          </span>
        )}
      </div>
      <div className="row-span-2 shrink-0 flex items-center gap-1">
        {jupiterUrl && (
          <a
            href={jupiterUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'inline-flex items-center justify-center h-6 px-2',
              'text-[9.5px] mono tabular uppercase tracking-[0.16em]',
              'text-[var(--fg-2)] hover:text-[var(--fg)]',
              'border border-[var(--border)] rounded-md',
              'transition-colors duration-150',
            )}
          >
            {t('openJupiter')}
          </a>
        )}
        <ArmButton state={state} onArm={onArm} />
      </div>
      <div className="col-start-2 min-w-0 text-[9.5px] mono tabular text-[var(--fg-3)]">
        {kindLabel}
      </div>
    </div>
  );
}

function LevelKindPill({ kind }: { kind: TradePlanLevelKind }) {
  const t = useTranslations('predict.tradePlan');
  const tone =
    kind === 'entry'
      ? 'text-[var(--accent)]'
      : kind === 'tp1' || kind === 'tp2'
        ? 'text-[var(--up)]'
        : 'text-[var(--down)]';
  return (
    <span
      className={cn(
        'inline-flex items-center h-[18px] px-1.5 rounded',
        'border border-[var(--border)]',
        'mono tabular text-[9.5px] uppercase tracking-[0.18em] font-semibold',
        tone,
      )}
    >
      {t(`levels.${kind}`)}
    </span>
  );
}

function DeltaBadge({ pct, isStop }: { pct: number; isStop: boolean }) {
  const isPositive = pct >= 0;
  const tone = isStop
    ? 'text-[var(--down)]'
    : isPositive
      ? 'text-[var(--up)]'
      : 'text-[var(--down)]';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5',
        'mono tabular text-[10px] font-semibold',
        tone,
      )}
    >
      <span aria-hidden>{isPositive ? '▲' : '▼'}</span>
      {Math.abs(pct * 100).toFixed(2)}%
    </span>
  );
}

function ArmButton({
  state,
  onArm,
}: {
  state: LevelActionState;
  onArm: () => void;
}) {
  const t = useTranslations('predict.tradePlan');
  if (state.kind === 'armed') {
    return (
      <span
        className={cn(
          'inline-flex items-center justify-center h-6 px-2',
          'text-[9.5px] mono tabular uppercase tracking-[0.16em]',
          'text-[var(--up)]',
        )}
      >
        {t('armed')}
      </span>
    );
  }
  if (state.kind === 'error') {
    return (
      <button
        type="button"
        onClick={onArm}
        title={state.message}
        className={cn(
          'inline-flex items-center justify-center h-6 px-2',
          'text-[9.5px] mono tabular uppercase tracking-[0.16em]',
          'text-[var(--down)] border border-[var(--down)]/40 rounded-md',
          'hover:opacity-90',
        )}
      >
        {t('retry')}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onArm}
      disabled={state.kind === 'arming'}
      className={cn(
        'inline-flex items-center justify-center rounded-md h-6 px-2.5',
        'text-[9.5px] font-semibold mono tabular uppercase tracking-[0.16em]',
        'bg-[var(--fg)] text-[var(--bg)]',
        'hover:opacity-90 active:scale-95',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        'transition-[opacity,transform] duration-150',
      )}
    >
      {state.kind === 'arming' ? t('arming') : t('setAlert')}
    </button>
  );
}

/**
 * Direction routed to /api/alerts. Longs use `up` for entries + TPs
 * (buy or take profit above), `down` for the stop (invalidation
 * below). Shorts flip: `down` for the entry + TPs (sell/take below),
 * `up` for the stop (invalidation above).
 */
function directionForLevel(
  kind: TradePlanLevelKind,
  direction: 'long' | 'short',
): 'up' | 'down' {
  if (direction === 'long') return kind === 'sl' ? 'down' : 'up';
  return kind === 'sl' ? 'up' : 'down';
}

/**
 * Position sizing per level. Entry acts on the full position; TP1/TP2
 * on the fraction the engine specified (defaults to 60/40 split); SL
 * on whatever remains at fire-time — we assume 100% for the Jupiter
 * deep-link (worst case: extra hedge if not fully filled).
 */
function computeLevelSize(
  level: TradePlanLevel,
  positionSize: number,
): number {
  if (level.kind === 'entry' || level.kind === 'sl') return positionSize;
  const pct = level.positionPct ?? (level.kind === 'tp1' ? 0.6 : 0.4);
  return positionSize * pct;
}

function formatPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(4);
  return n.toFixed(6);
}

function shorten(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}
