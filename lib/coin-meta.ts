/**
 * Top-20 cryptocurrency metadata for the homepage ticker carousel.
 *
 * Logo URLs default to the open-source `atomiclabs/cryptocurrency-icons`
 * repo served via jsDelivr — globally cached, free, predictable URL
 * pattern. That repo stopped shipping in 2021, though, so anything
 * launched or rebranded after that point falls back to a monogram
 * tile — or, where we care, a self-hosted override in `public/coins/`.
 *
 * Add a symbol here and it shows up in the ticker. Order is roughly
 * market-cap descending (stablecoins intentionally excluded — they
 * don't carry price-action information for prediction context).
 *
 * To self-host a logo: drop the file at `public/coins/<key>.<ext>`
 * (svg | png | jpg) and register it in `LOCAL_ICON_OVERRIDES` below.
 * `coinIconUrl()` checks the override map first, so once a symbol is
 * listed it bypasses the external CDN entirely.
 */

export interface CoinMeta {
  symbol: string;
  name: string;
  geckoId: string;
  iconKey: string; // jsdelivr icon key (lowercase symbol; alias for renames)
  chain?: string;
}

export const TOP_20: CoinMeta[] = [
  { symbol: 'BTC', name: 'Bitcoin', geckoId: 'bitcoin', iconKey: 'btc' },
  { symbol: 'ETH', name: 'Ethereum', geckoId: 'ethereum', iconKey: 'eth' },
  { symbol: 'SOL', name: 'Solana', geckoId: 'solana', iconKey: 'sol' },
  { symbol: 'XRP', name: 'XRP', geckoId: 'ripple', iconKey: 'xrp' },
  { symbol: 'BNB', name: 'BNB', geckoId: 'binancecoin', iconKey: 'bnb' },
  { symbol: 'DOGE', name: 'Dogecoin', geckoId: 'dogecoin', iconKey: 'doge' },
  { symbol: 'ADA', name: 'Cardano', geckoId: 'cardano', iconKey: 'ada' },
  { symbol: 'TRX', name: 'TRON', geckoId: 'tron', iconKey: 'trx' },
  { symbol: 'AVAX', name: 'Avalanche', geckoId: 'avalanche-2', iconKey: 'avax' },
  { symbol: 'SHIB', name: 'Shiba Inu', geckoId: 'shiba-inu', iconKey: 'shib' },
  { symbol: 'LINK', name: 'Chainlink', geckoId: 'chainlink', iconKey: 'link' },
  { symbol: 'DOT', name: 'Polkadot', geckoId: 'polkadot', iconKey: 'dot' },
  { symbol: 'TON', name: 'Toncoin', geckoId: 'the-open-network', iconKey: 'ton' },
  // POL is the rebrand of MATIC (Sept 2024). Different brand mark
  // from the old purple Polygon glyph — served from public/coins/.
  { symbol: 'POL', name: 'Polygon', geckoId: 'polygon-ecosystem-token', iconKey: 'pol' },
  { symbol: 'LTC', name: 'Litecoin', geckoId: 'litecoin', iconKey: 'ltc' },
  { symbol: 'BCH', name: 'Bitcoin Cash', geckoId: 'bitcoin-cash', iconKey: 'bch' },
  { symbol: 'NEAR', name: 'NEAR Protocol', geckoId: 'near', iconKey: 'near' },
  { symbol: 'APT', name: 'Aptos', geckoId: 'aptos', iconKey: 'apt' },
  { symbol: 'UNI', name: 'Uniswap', geckoId: 'uniswap', iconKey: 'uni' },
  { symbol: 'HYPE', name: 'Hyperliquid', geckoId: 'hyperliquid', iconKey: 'hype' },
];

export const TOP_20_BY_SYMBOL: Record<string, CoinMeta> = TOP_20.reduce(
  (acc, c) => {
    acc[c.symbol] = c;
    return acc;
  },
  {} as Record<string, CoinMeta>,
);

/**
 * Self-hosted overrides for symbols whose brand artwork is wrong or
 * missing on the upstream CDN. Files live under `public/coins/`.
 * Source: CoinGecko (each project's verified brand asset as of the
 * date this file was last refreshed).
 *
 * Update protocol:
 *   1. Drop the new file at `public/coins/<key>.<ext>`
 *   2. Register `<key>: '<key>.<ext>'` here
 *   3. Done — `coinIconUrl()` picks it up automatically.
 */
const LOCAL_ICON_OVERRIDES: Record<string, string> = {
  hype: 'hype.jpg', // Hyperliquid — launched 2024, absent from atomiclabs
  pol: 'pol.png', // Polygon's POL rebrand — Sept 2024
  ton: 'ton.jpg', // Toncoin refreshed brand — Sept 2024
};

export function coinIconUrl(iconKey: string): string {
  const key = iconKey.toLowerCase();
  const local = LOCAL_ICON_OVERRIDES[key];
  if (local) return `/coins/${local}`;
  return `https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons@master/svg/color/${key}.svg`;
}

export function chainIconUrl(chain: string): string {
  // DeFiLlama provides resized chain icons; mapping our chain names to theirs.
  const map: Record<string, string> = {
    ethereum: 'ethereum',
    polygon: 'polygon',
    arbitrum: 'arbitrum',
    optimism: 'optimism',
    base: 'base',
    bsc: 'binance',
    avalanche: 'avalanche',
    solana: 'solana',
    sui: 'sui',
    aptos: 'aptos',
    ton: 'ton',
  };
  const slug = map[chain] ?? chain;
  return `https://icons.llamao.fi/icons/chains/rsz_${slug}.jpg`;
}
