/**
 * Top-20 cryptocurrency metadata for the homepage ticker carousel.
 *
 * Logo URLs use the open-source `atomiclabs/cryptocurrency-icons` repo
 * served via jsDelivr — globally cached, free, predictable URL pattern.
 * The `<CoinIcon>` component falls back to a monogram tile if a key 404s
 * (e.g. for newer tokens like HYPE that pre-date the icon repo).
 *
 * Add a symbol here and it shows up in the ticker. Order is roughly
 * market-cap descending (stablecoins intentionally excluded — they don't
 * carry price-action information for prediction context).
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
  // MATIC migrated to POL in late 2024. Logo glyph is identical, so we
  // reuse the matic icon key to avoid a monogram fallback for POL.
  { symbol: 'POL', name: 'Polygon', geckoId: 'matic-network', iconKey: 'matic' },
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

export function coinIconUrl(iconKey: string): string {
  return `https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons@master/svg/color/${iconKey.toLowerCase()}.svg`;
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
