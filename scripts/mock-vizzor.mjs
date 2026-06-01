#!/usr/bin/env node
/**
 * Mock Vizzor engine — stand-in for `api.vizzor.ai` during local dev.
 *
 * This file is **NOT part of the site code**. It's a development
 * convenience that conforms to the contract in `API_CONTRACT.md` so the
 * on-site chat surface at `/predict` can be exercised end-to-end
 * without the real engine being deployed. Excluded from the Docker
 * image via `.dockerignore`.
 *
 * Usage (two terminals):
 *   1. terminal A:  pnpm dev                    # site on :3001
 *   2. terminal B:  pnpm mock                   # mock engine on :7100
 *   3. write `.env.local`:
 *        VIZZOR_API_URL=http://localhost:7100
 *      and restart `pnpm dev` so Next.js picks the env up.
 *
 * When the real engine ships at api.vizzor.ai, kill this process and
 * unset the env var — the site re-points at production automatically.
 *
 * Tech: zero npm deps, just the Node std lib (`http`, `fs`, `url`,
 * `path`). Reads `data/snapshot.json` for current prices so receipts
 * stay consistent with what the site already renders for /price, /wr,
 * etc.
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number.parseInt(process.env.MOCK_PORT ?? '7100', 10);
const SNAPSHOT_PATH = join(__dirname, '..', 'data', 'snapshot.json');

/* ------------------------------------------------------------------ *\
 * Display glyphs — must match the same map the engine would emit.
\* ------------------------------------------------------------------ */

const COIN_GLYPH = {
  BTC: { emoji: '🟠', long: 'BITCOIN' },
  ETH: { emoji: '🔷', long: 'ETHEREUM' },
  SOL: { emoji: '🟣', long: 'SOLANA' },
  XRP: { emoji: '◽', long: 'XRP' },
  BNB: { emoji: '🟡', long: 'BNB' },
  DOGE: { emoji: '🐕', long: 'DOGECOIN' },
  ADA: { emoji: '🔵', long: 'CARDANO' },
  TRX: { emoji: '🔴', long: 'TRON' },
  AVAX: { emoji: '🔺', long: 'AVALANCHE' },
  SHIB: { emoji: '🐶', long: 'SHIBA INU' },
  LINK: { emoji: '🔗', long: 'CHAINLINK' },
  DOT: { emoji: '🟤', long: 'POLKADOT' },
  TON: { emoji: '💎', long: 'TONCOIN' },
  POL: { emoji: '🟪', long: 'POLYGON' },
  LTC: { emoji: '⚪', long: 'LITECOIN' },
  BCH: { emoji: '🟢', long: 'BITCOIN CASH' },
  NEAR: { emoji: '⬛', long: 'NEAR' },
  APT: { emoji: '🟦', long: 'APTOS' },
  UNI: { emoji: '🦄', long: 'UNISWAP' },
  HYPE: { emoji: '🌐', long: 'HYPERLIQUID' },
};

const HORIZON_GEOMETRY = {
  '5m':  { zone: 0.0015, tp: 0.0006, sl: 0.0040 },
  '15m': { zone: 0.0022, tp: 0.0010, sl: 0.0060 },
  '30m': { zone: 0.0028, tp: 0.0014, sl: 0.0075 },
  '1h':  { zone: 0.0040, tp: 0.0018, sl: 0.0090 },
  '2h':  { zone: 0.0050, tp: 0.0028, sl: 0.0120 },
  '4h':  { zone: 0.0070, tp: 0.0048, sl: 0.0200 },
  '6h':  { zone: 0.0090, tp: 0.0065, sl: 0.0260 },
  '1d':  { zone: 0.0120, tp: 0.0110, sl: 0.0420 },
  '7d':  { zone: 0.0240, tp: 0.0280, sl: 0.0900 },
  '30d': { zone: 0.0450, tp: 0.0550, sl: 0.1700 },
};

/* ------------------------------------------------------------------ *\
 * NLP — extract symbol + horizon from the user's raw text.
\* ------------------------------------------------------------------ */

const HORIZON_PATTERNS = [
  [/\b15\s*m(?:in(?:s|utes?|utos?)?)?\b/i, '15m'],
  [/\b30\s*m(?:in(?:s|utes?|utos?)?)?\b/i, '30m'],
  [/\b5\s*m(?:in(?:s|utes?|utos?)?)?\b/i, '5m'],
  [/\b24\s*h(?:r|our|ora|eure)?s?\b/i, '1d'],
  [/\b1\s*d(?:ay|ays|ia|ias|í|ía)?\b/i, '1d'],
  [/\b1\s*h(?:r|our|ours|ora|oras|eure|eures)?\b/i, '1h'],
  [/\b2\s*h(?:r|our|ours|ora|oras|eure|eures)?\b/i, '2h'],
  [/\b4\s*h(?:r|our|ours|ora|oras|eure|eures)?\b/i, '4h'],
  [/\b6\s*h(?:r|our|ours|ora|oras|eure|eures)?\b/i, '6h'],
  [/\b7\s*d(?:ay|ays|ia|ias)?s?\b/i, '7d'],
  [/\b1\s*w(?:eek|eeks|emaine|emaines|emana|emanas)?\b/i, '7d'],
  [/\b30\s*d(?:ay|ays|ia|ias)?s?\b/i, '30d'],
];

function detectSymbol(text) {
  const upper = ` ${text.toUpperCase()} `;
  for (const sym of Object.keys(COIN_GLYPH)) {
    if (upper.includes(` ${sym} `) || upper.includes(`$${sym}`)) return sym;
  }
  const lower = text.toLowerCase();
  for (const [sym, g] of Object.entries(COIN_GLYPH)) {
    if (lower.includes(g.long.toLowerCase())) return sym;
  }
  return null;
}

/**
 * Look for any ticker-shaped uppercase token (2–6 chars) in the
 * message. Used to distinguish "user typed a symbol we don't know"
 * from "user didn't specify a symbol at all". If we find one, we
 * return an honest "not tracked" response rather than silently
 * defaulting to BTC and pretending it answered the question.
 */
function detectUnknownTicker(text) {
  const stop = new Set([
    'PREDICT', 'PREDICE', 'PREDIRE', 'PREDICTION', 'PREDICTIONS',
    'IN', 'EN', 'EL', 'LA', 'LE', 'AT', 'ON', 'FOR', 'POR', 'POUR',
    'HOUR', 'HOURS', 'HORA', 'HORAS', 'HEURE', 'HEURES',
    'MIN', 'MINS', 'MINUTE', 'MINUTES', 'MINUTOS',
    'DAY', 'DAYS', 'DIA', 'DIAS', 'JOUR', 'JOURS',
    'WEEK', 'WEEKS', 'SEMANA', 'SEMAINE',
    'MONTH', 'MONTHS', 'MES', 'MESES', 'MOIS',
    'LONG', 'SHORT', 'RANGE', 'BUY', 'SELL', 'HOLD',
    'HELP', 'HR', 'HRS',
  ]);
  const matches = text.toUpperCase().match(/\b[A-Z]{2,6}\b/g);
  if (!matches) return null;
  for (const m of matches) {
    if (stop.has(m)) continue;
    if (/^\d+[A-Z]$/.test(m)) continue; // e.g. "4H", "30M"
    if (Object.prototype.hasOwnProperty.call(COIN_GLYPH, m)) continue;
    return m;
  }
  return null;
}

function detectHorizon(text) {
  for (const [pat, h] of HORIZON_PATTERNS) {
    if (pat.test(text)) return h;
  }
  return null;
}

/* ------------------------------------------------------------------ *\
 * Deterministic PRNG — seeded by symbol + horizon + UTC-hour so the
 * same query gives the same answer for 60 minutes.
\* ------------------------------------------------------------------ */

function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ *\
 * Receipt generator — produces the canonical Telegram-bot format.
\* ------------------------------------------------------------------ */

function formatUsd(n) {
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 1) return '$' + n.toFixed(2);
  if (n >= 0.01) return '$' + n.toFixed(4);
  return '$' + n.toFixed(6);
}

function buildReceipt(symbol, horizon, entryPrice) {
  const g = COIN_GLYPH[symbol] ?? { emoji: '🪙', long: symbol.toUpperCase() };
  const geo = HORIZON_GEOMETRY[horizon] ?? HORIZON_GEOMETRY['4h'];
  const hourBucket = Math.floor(Date.now() / 3_600_000);
  const rng = mulberry32(fnv1a(`${symbol}|${horizon}|${hourBucket}`));

  // Direction + confidence — bias slightly toward RANGE when conviction
  // is mixed (matches the real engine's calibration).
  const directionRoll = rng();
  const confidence = 0.5 + rng() * 0.4;
  const conviction = confidence >= 0.55;
  let dirEmoji, dirLabel, dir;
  if (!conviction) {
    dirEmoji = '➖'; dirLabel = 'RANGE'; dir = 'range';
  } else if (directionRoll < 0.5) {
    dirEmoji = '📉'; dirLabel = 'SHORT'; dir = 'short';
  } else {
    dirEmoji = '📈'; dirLabel = 'LONG'; dir = 'long';
  }
  const confPct = Math.round(confidence * 100);

  const lines = [];
  lines.push(`${g.emoji} ${g.long} · ${horizon}`);
  lines.push(`💰 ${symbol} Price: ${formatUsd(entryPrice)}`);
  lines.push(`💵 Direction: ${dirEmoji} ${dirLabel} (${confPct}%)`);

  if (dir === 'range') {
    const half = (geo.tp + geo.zone * 0.5) / 2;
    const low = entryPrice * (1 - half);
    const high = entryPrice * (1 + half);
    lines.push(`🪙 Band: ${formatUsd(low)} — ${formatUsd(high)}`);
    lines.push(`💹 Best Play: Range fade — long ${formatUsd(low)}, short ${formatUsd(high)} (no leverage)`);
  } else {
    let zoneLow, zoneHigh, tp1, tp1Pct, sl, slPct;
    if (dir === 'long') {
      zoneLow = entryPrice * (1 - geo.zone);
      zoneHigh = entryPrice;
      tp1 = entryPrice * (1 + geo.tp);
      tp1Pct = +geo.tp * 100;
      sl = entryPrice * (1 - geo.sl);
      slPct = -geo.sl * 100;
    } else {
      zoneLow = entryPrice;
      zoneHigh = entryPrice * (1 + geo.zone);
      tp1 = entryPrice * (1 - geo.tp);
      tp1Pct = -geo.tp * 100;
      sl = entryPrice * (1 + geo.sl);
      slPct = +geo.sl * 100;
    }
    const rr = geo.tp / geo.sl;
    lines.push(`🪙 Entry Zone: ${formatUsd(zoneLow)} — ${formatUsd(zoneHigh)}`);
    lines.push(`📈 TP1: ${formatUsd(tp1)} (${tp1Pct >= 0 ? '+' : ''}${tp1Pct.toFixed(2)}%)`);
    lines.push(`📊 SL: ${formatUsd(sl)} (${slPct >= 0 ? '+' : ''}${slPct.toFixed(2)}%)`);
    const rrStr = rr.toFixed(2);
    if (rr < 0.5) {
      lines.push(`⚠ Skip: R:R 1:${rrStr} — risk exceeds reward, no trade`);
    } else if (rr < 1) {
      lines.push(`⚠ Caution: R:R 1:${rrStr} — small edge, partial size only`);
    } else {
      lines.push(`✅ Take: R:R 1:${rrStr}`);
    }
  }

  return lines.join('\n');
}

/* ------------------------------------------------------------------ *\
 * Snapshot — look up current price for a symbol.
\* ------------------------------------------------------------------ */

function loadSnapshot() {
  try {
    return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
  } catch (err) {
    console.error('[mock-vizzor] could not load data/snapshot.json:', err.message);
    return { ticker: [] };
  }
}

function lookupPrice(symbol) {
  const snap = loadSnapshot();
  const entry = snap.ticker?.find(t => t.symbol === symbol);
  return entry ? entry.price : null;
}

/* ------------------------------------------------------------------ *\
 * HTTP server — implements POST /v1/site/chat per API_CONTRACT.md.
\* ------------------------------------------------------------------ */

function streamReceipt(res, text) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    'x-vercel-ai-ui-message-stream': 'v1',
    'x-vizzor-source': 'mock',
  });
  const id = 'mock-' + Date.now().toString(36);
  res.write(`data: ${JSON.stringify({ type: 'text-start', id })}\n\n`);
  for (const chunk of text.match(/.{1,40}/gs) ?? [text]) {
    res.write(
      `data: ${JSON.stringify({ type: 'text-delta', id, delta: chunk })}\n\n`,
    );
  }
  res.write(`data: ${JSON.stringify({ type: 'text-end', id })}\n\n`);
  res.write(`data: [DONE]\n\n`);
  res.end();
}

function extractLastUserText(messages) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user') continue;
    const text = (m.parts ?? [])
      .filter(p => p?.type === 'text')
      .map(p => p.text ?? '')
      .join(' ');
    if (text.trim().length > 0) return text;
  }
  return '';
}

function handleChat(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_json' }));
      return;
    }

    const text = extractLastUserText(payload.messages);
    const knownSymbol = detectSymbol(text);
    const unknownTicker = knownSymbol ? null : detectUnknownTicker(text);

    if (unknownTicker) {
      const tracked = Object.keys(COIN_GLYPH).join(' · ');
      streamReceipt(
        res,
        `⚠ ${unknownTicker} not tracked.

This demo covers the top-20 spot symbols:
  ${tracked}

For full-coverage predictions across every chain and token, open the
Vizzor bot: https://t.me/vizzorai_bot`,
      );
      return;
    }

    const symbol = knownSymbol ?? 'BTC';
    const horizon = detectHorizon(text) ?? '4h';
    const entryPrice = lookupPrice(symbol);

    if (!entryPrice) {
      streamReceipt(
        res,
        `⚠ Symbol ${symbol} not in snapshot — refresh data/snapshot.json or pick a tracked symbol.`,
      );
      return;
    }

    const receipt = buildReceipt(symbol, horizon, entryPrice);
    streamReceipt(res, receipt);
  });
}

const server = createServer((req, res) => {
  // Permissive CORS for local dev only.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-vizzor-burn-tx');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/v1/site/chat') {
    handleChat(req, res);
    return;
  }

  // Tiny health endpoint mirrors the site's own /api/health shape.
  if (req.method === 'GET' && req.url === '/v1/site/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'mock-vizzor', uptime: Math.round(process.uptime()) }));
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, () => {
  console.log(`[mock-vizzor] listening on http://localhost:${PORT}`);
  console.log(`[mock-vizzor] POST /v1/site/chat — Vizzor chat protocol`);
  console.log(`[mock-vizzor] point the site here:  VIZZOR_API_URL=http://localhost:${PORT}`);
});
