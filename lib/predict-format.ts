/**
 * Prediction format helpers shared by the chat surface and the stub
 * fallback in `/api/predict`.
 *
 * Three concerns live here:
 *   1. parseUserMessage(text)   — extract symbol + horizon from natural
 *                                 language (en/es/fr). Used to drive the
 *                                 upstream Vizzor API call and to seed
 *                                 the stub.
 *   2. generatePrediction(opts) — deterministic, snapshot-backed
 *                                 Prediction object that looks like the
 *                                 v0.15.5 Helios output of the real
 *                                 product engine. Seeded by symbol +
 *                                 horizon + UTC hour so the same query
 *                                 returns the same answer for 60 min.
 *   3. formatPredictionText(p)  — render a Prediction as the
 *                                 vizzor-product terminal format that
 *                                 already appears in WhatsInIt and
 *                                 SurfaceCompare. One source of truth
 *                                 for "what a Vizzor receipt looks like".
 *
 * Why deterministic-seeded RNG instead of fully random: the demo must
 * feel like a real product. If a visitor asks "BTC 4h" twice and gets
 * wildly different answers, the calibration story collapses. Hour-
 * stable answers mirror how the real bot resolves a single trigger.
 */

import { TOP_20, TOP_20_BY_SYMBOL } from './coin-meta';
import { getTicker } from './snapshot';
import { formatUsd } from './utils';
import type {
  Direction,
  Prediction,
  SignalContribution,
  SignalFamily,
  Tier,
} from './types';

/* ------------------------------------------------------------------ *\
 * Parsing
 * ------------------------------------------------------------------ */

interface HorizonPattern {
  pattern: RegExp;
  horizon: string;
}

// Order matters: longer-form patterns first so "15m" doesn't get
// gobbled by a generic "1m"-ish rule.
const HORIZON_PATTERNS: HorizonPattern[] = [
  { pattern: /\b15\s*m(?:in(?:s|utes?|utos?)?)?\b/i, horizon: '15m' },
  { pattern: /\b30\s*m(?:in(?:s|utes?|utos?)?)?\b/i, horizon: '30m' },
  { pattern: /\b5\s*m(?:in(?:s|utes?|utos?)?)?\b/i, horizon: '5m' },
  { pattern: /\b24\s*h(?:r|our|ora|eure)?s?\b/i, horizon: '1d' },
  { pattern: /\b1\s*d(?:ay|ays|ia|ias|í|ía)?\b/i, horizon: '1d' },
  { pattern: /\b1\s*h(?:r|our|ours|ora|oras|eure|eures)?\b/i, horizon: '1h' },
  { pattern: /\b2\s*h(?:r|our|ours|ora|oras|eure|eures)?\b/i, horizon: '2h' },
  { pattern: /\b4\s*h(?:r|our|ours|ora|oras|eure|eures)?\b/i, horizon: '4h' },
  { pattern: /\b6\s*h(?:r|our|ours|ora|oras|eure|eures)?\b/i, horizon: '6h' },
  { pattern: /\b7\s*d(?:ay|ays|ia|ias)?s?\b/i, horizon: '7d' },
  { pattern: /\b1\s*w(?:eek|eeks|emaine|emaines|emana|emanas)?\b/i, horizon: '7d' },
  { pattern: /\b30\s*d(?:ay|ays|ia|ias)?s?\b/i, horizon: '30d' },
  { pattern: /\b1\s*month?s?\b|\b1\s*mes(?:es)?\b|\b1\s*mois\b/i, horizon: '30d' },
];

export interface ParsedRequest {
  symbol: string;
  horizon: string;
  locale: 'en' | 'es' | 'fr';
}

export function parseUserMessage(content: string): ParsedRequest {
  return {
    symbol: detectSymbol(content) ?? 'BTC',
    horizon: detectHorizon(content) ?? '4h',
    locale: detectLocale(content),
  };
}

function detectSymbol(text: string): string | null {
  const upperText = ` ${text.toUpperCase()} `;
  for (const meta of TOP_20) {
    if (upperText.includes(` ${meta.symbol} `) || upperText.includes(`$${meta.symbol}`)) {
      return meta.symbol;
    }
  }
  // Name-based fallback (Bitcoin, Ethereum, ...). Case-insensitive
  // substring match on the long names.
  const lower = text.toLowerCase();
  for (const meta of TOP_20) {
    if (lower.includes(meta.name.toLowerCase())) return meta.symbol;
  }
  return null;
}

function detectHorizon(text: string): string | null {
  for (const p of HORIZON_PATTERNS) {
    if (p.pattern.test(text)) return p.horizon;
  }
  return null;
}

function detectLocale(text: string): 'en' | 'es' | 'fr' {
  // Crude but adequate — looks for stop-words specific to each locale.
  if (/\b(predice|cripto|hora|dias?|días?|semana|próxima|cuál|quién)\b/i.test(text)) {
    return 'es';
  }
  if (/\b(prédire|crypto|heure|jours?|semaine|prochaine|combien)\b/i.test(text)) {
    return 'fr';
  }
  return 'en';
}

/* ------------------------------------------------------------------ *\
 * Generation — deterministic Helios-shape Prediction
 * ------------------------------------------------------------------ */

const HORIZON_VOLATILITY: Record<string, number> = {
  '5m': 0.004,
  '15m': 0.008,
  '30m': 0.012,
  '1h': 0.018,
  '2h': 0.024,
  '4h': 0.035,
  '6h': 0.045,
  '1d': 0.062,
  '7d': 0.14,
  '30d': 0.28,
  '90d': 0.45,
  '1y': 0.85,
};

// Family weights mirror the real product's calibrated weights post-Helios.
// They sum to ~1.0 so the weighted-CF magnitude is bounded.
const FAMILY_WEIGHTS: Record<SignalFamily, number> = {
  onChain: 0.26,
  mlEnsemble: 0.22,
  logicRules: 0.18,
  patternMatch: 0.14,
  predictionMarkets: 0.12,
  socialNarrative: 0.08,
};

const FAMILIES: SignalFamily[] = [
  'onChain',
  'mlEnsemble',
  'logicRules',
  'patternMatch',
  'predictionMarkets',
  'socialNarrative',
];

export interface GenerateOpts {
  symbol: string;
  horizon: string;
  /** Override the entry price; if omitted, snapshot ticker is consulted. */
  entryPrice?: number;
  /** Override the seed window; defaults to the current UTC hour. */
  hourBucket?: number;
}

export function generatePrediction(opts: GenerateOpts): Prediction {
  const { symbol, horizon } = opts;
  const entryPrice = opts.entryPrice ?? lookupTickerPrice(symbol);
  const hourBucket =
    opts.hourBucket ?? Math.floor(Date.now() / 3_600_000);
  const rng = mulberry32(fnv1a(`${symbol}|${horizon}|${hourBucket}`));

  // 1. Generate six signals with seeded CFs in [-0.85, 0.85].
  const signals: SignalContribution[] = FAMILIES.map((family) => {
    const raw = (rng() - 0.5) * 1.7;
    const cf = round2(clamp(raw, -0.85, 0.85));
    const direction: Direction =
      cf > 0.05 ? 'up' : cf < -0.05 ? 'down' : 'sideways';
    return {
      family,
      cf,
      direction,
      meta: buildMeta(family, cf, rng),
    };
  });

  // 2. Weighted score → overall direction + confidence.
  const score = signals.reduce(
    (acc, sig) => acc + sig.cf * FAMILY_WEIGHTS[sig.family],
    0,
  );
  const direction: Direction =
    score > 0.08 ? 'up' : score < -0.08 ? 'down' : 'sideways';
  const confidence = round2(
    clamp(0.52 + Math.abs(score) * 0.85, 0.42, 0.94),
  );

  // 3. Tier from conviction + whale heuristic.
  // FAMILIES has fixed length 6, so these indices are guaranteed
  // populated by the map above — assert non-undefined to satisfy
  // noUncheckedIndexedAccess without an explicit null check.
  const onChain = signals[0] as SignalContribution;
  const logicRulesSig = signals[2] as SignalContribution;
  const patternSig = signals[3] as SignalContribution;
  const tier: Tier = pickTier(confidence, onChain);

  // 4. Targets — scaled by horizon volatility, biased to direction.
  const vol = HORIZON_VOLATILITY[horizon] ?? 0.035;
  const dirSign = direction === 'up' ? 1 : direction === 'down' ? -1 : 0;
  const baseTarget = entryPrice * (1 + dirSign * vol);
  const bullTarget = entryPrice * (1 + (dirSign || 1) * vol * 1.6);
  const bearTarget = entryPrice * (1 - (dirSign || 1) * vol * 0.7);

  // 5. SMC / ICT details for the flattened-reason narrative.
  const smcDetails = makeSmcDetails(symbol, entryPrice, direction, rng);
  const ictDetails = makeIctDetails(direction, rng);

  return {
    id: `p_${idHash(symbol, horizon, hourBucket)}`,
    symbol,
    horizon,
    direction,
    confidence,
    tier,
    emittedAt: new Date().toISOString(),
    entryPrice: round2(entryPrice),
    predictedPrice: round2(baseTarget),
    targets: {
      bull: round2(bullTarget),
      base: round2(baseTarget),
      bear: round2(bearTarget),
    },
    triggerSnapshot: {
      vizzorTa: {
        vote: direction === 'up' ? 1 : direction === 'down' ? -1 : 0,
        signals,
      },
      smc: {
        vote: patternSig.cf > 0 ? 1 : patternSig.cf < 0 ? -1 : 0,
        details: smcDetails,
      },
      ict: {
        vote: logicRulesSig.cf > 0 ? 1 : logicRulesSig.cf < 0 ? -1 : 0,
        details: ictDetails,
      },
      flattenedReason: makeFlattenedReason(signals, direction),
    },
  };
}

function lookupTickerPrice(symbol: string): number {
  const ticker = getTicker();
  const entry = ticker.find((e) => e.symbol === symbol);
  if (entry) return entry.price;
  // Symbol isn't tracked in our snapshot — return a believable default
  // so the format still renders. Real product upstream would 404 here.
  const meta = TOP_20_BY_SYMBOL[symbol];
  return meta ? 1 : 100;
}

function pickTier(confidence: number, onChain: SignalContribution): Tier {
  if (confidence >= 0.78) return 'high-conviction';
  if (onChain.cf >= 0.55) return 'whale-confirmed';
  if (confidence >= 0.56) return 'tracked';
  return 'advisory';
}

function buildMeta(
  family: SignalFamily,
  cf: number,
  rng: () => number,
): Record<string, number | string> {
  switch (family) {
    case 'onChain': {
      const inflow = Math.round((Math.abs(cf) * 60 + rng() * 8) * 1_000_000);
      return { whale_inflow_usd: inflow };
    }
    case 'mlEnsemble': {
      const rsi = round1(30 + rng() * 50);
      const prob = round2(0.4 + rng() * 0.5);
      return { rsi14: rsi, ensemble_prob: prob };
    }
    case 'logicRules': {
      const rules = [
        'smart_money_accumulation',
        'coinbase_premium_positive',
        'cvd_divergence',
        'open_interest_spike',
        'funding_skew_long',
        'liquidation_cluster',
      ];
      return { fired: rules[Math.floor(rng() * rules.length)] ?? rules[0]! };
    }
    case 'patternMatch': {
      const patterns = [
        'BOS_4h_up',
        'OB_intact',
        'FVG_aligned',
        'liquidity_sweep_low',
        'demand_zone_reaction',
      ];
      return { pattern: patterns[Math.floor(rng() * patterns.length)] ?? patterns[0]! };
    }
    case 'predictionMarkets': {
      const implied = round2(0.38 + rng() * 0.42);
      return { implied_prob: implied };
    }
    case 'socialNarrative': {
      const sentiment = round2((rng() - 0.3) * 1.2);
      return { sentiment };
    }
  }
}

function makeSmcDetails(
  symbol: string,
  entryPrice: number,
  direction: Direction,
  rng: () => number,
): string {
  const arrow = direction === 'up' ? 'BOS' : direction === 'down' ? 'CHoCH' : 'range';
  const offset = entryPrice * (0.998 + rng() * 0.004);
  return `${arrow} confirmed at ${formatUsd(offset)} · OB intact`;
}

function makeIctDetails(direction: Direction, rng: () => number): string {
  const zones = ['NY kill-zone', 'London open', 'Asia kill-zone', 'NY PM session'];
  const zone = zones[Math.floor(rng() * zones.length)] ?? zones[0]!;
  const action = direction === 'up' ? 'liquidity sweep at low' : direction === 'down' ? 'liquidity sweep at high' : 'consolidation between PDH/PDL';
  return `${zone} · ${action}`;
}

function makeFlattenedReason(
  signals: SignalContribution[],
  direction: Direction,
): string {
  const strong = signals
    .filter((s) => Math.abs(s.cf) >= 0.4)
    .sort((a, b) => Math.abs(b.cf) - Math.abs(a.cf))
    .slice(0, 3)
    .map((s) => formatFamilyShort(s.family));
  if (strong.length === 0) {
    return `mixed signals, no strong conviction · ${direction}`;
  }
  return `${strong.join(' + ')} confluence · ${direction}`;
}

function formatFamilyShort(family: SignalFamily): string {
  switch (family) {
    case 'onChain': return 'whale';
    case 'mlEnsemble': return 'ML';
    case 'logicRules': return 'rules';
    case 'patternMatch': return 'pattern';
    case 'predictionMarkets': return 'markets';
    case 'socialNarrative': return 'narrative';
  }
}

/* ------------------------------------------------------------------ *\
 * Formatting — Helios-style text receipt
 * ------------------------------------------------------------------ */

const TIER_EMOJI: Record<Tier, string> = {
  'high-conviction': '🌟',
  'whale-confirmed': '🐋',
  'tracked': '✅',
  'advisory': '⚪',
};

const DIR_ARROW: Record<Direction, string> = {
  up: '↑',
  down: '↓',
  sideways: '↔',
};

const FAMILY_PAD_WIDTH = 18;

export function formatPredictionText(p: Prediction): string {
  const tierLabel = `${TIER_EMOJI[p.tier]} ${p.tier}`;
  const lines: string[] = [];

  lines.push(`${p.symbol} · ${p.horizon} · ${tierLabel}`);
  lines.push(
    `direction: ${DIR_ARROW[p.direction]} ${p.direction} · confidence ${p.confidence.toFixed(2)}`,
  );
  lines.push(`entry:     ${formatUsd(p.entryPrice)}`);
  if (p.targets) {
    lines.push(
      `targets:   bull ${formatUsd(p.targets.bull)} · base ${formatUsd(p.targets.base)} · bear ${formatUsd(p.targets.bear)}`,
    );
  }
  lines.push('');
  lines.push('trigger snapshot');
  if (p.triggerSnapshot?.vizzorTa.signals) {
    for (const sig of p.triggerSnapshot.vizzorTa.signals) {
      const sign = sig.cf >= 0 ? '+' : '';
      lines.push(
        `  ▸ ${padRight(sig.family, FAMILY_PAD_WIDTH)} ${sign}${sig.cf.toFixed(2)}  ${formatMeta(sig)}`,
      );
    }
  }
  if (p.triggerSnapshot?.smc?.details) {
    lines.push(`  · smc: ${p.triggerSnapshot.smc.details}`);
  }
  if (p.triggerSnapshot?.ict?.details) {
    lines.push(`  · ict: ${p.triggerSnapshot.ict.details}`);
  }
  if (p.triggerSnapshot?.flattenedReason) {
    lines.push('');
    lines.push(`reason: ${p.triggerSnapshot.flattenedReason}`);
  }
  lines.push('');
  lines.push('🔔 alerts armed at TP1 / TP2 / SL');

  return lines.join('\n');
}

function formatMeta(sig: SignalContribution): string {
  const meta = sig.meta ?? {};
  switch (sig.family) {
    case 'onChain': {
      const raw = Number(meta.whale_inflow_usd) || 0;
      return `whale_inflow ${formatCompactUsd(raw)}`;
    }
    case 'mlEnsemble':
      return `rsi ${meta.rsi14 ?? '–'} · ensemble ${meta.ensemble_prob ?? '–'}`;
    case 'logicRules':
      return String(meta.fired ?? 'no_rule_fired');
    case 'patternMatch':
      return String(meta.pattern ?? 'no_pattern');
    case 'predictionMarkets':
      return `implied ${meta.implied_prob ?? '–'}`;
    case 'socialNarrative':
      return `sentiment ${meta.sentiment ?? '–'}`;
  }
}

function formatCompactUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function padRight(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

/* ------------------------------------------------------------------ *\
 * Hash + RNG (FNV-1a + mulberry32) — small, no dependencies.
 * ------------------------------------------------------------------ */

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function idHash(symbol: string, horizon: string, hourBucket: number): string {
  const h = fnv1a(`${symbol}${horizon}${hourBucket}`);
  return h.toString(36).padStart(6, '0').slice(0, 6);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
