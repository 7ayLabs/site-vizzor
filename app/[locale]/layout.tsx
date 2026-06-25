import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { sans, mono } from '../fonts';
import { ThemeProvider, themeBootScript } from '@/components/layout/theme-provider';
import { routing } from '@/i18n/routing';
import '../globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://vizzor.ai'),
  title: {
    default: 'Vizzor · Predictions with receipts',
    template: '%s · Vizzor',
  },
  description:
    'AI-powered crypto price predictions with real dollar targets across every chain, token, and timeframe. Calibrated confidence, tracked win rate.',
  applicationName: 'Vizzor',
  authors: [{ name: '7ayLabs', url: 'https://7aylabs.com' }],
  generator: 'Next.js',
  keywords: [
    'crypto',
    'predictions',
    'AI',
    'chronovisor',
    'on-chain',
    'derivatives',
    'whale flow',
    'tracked win rate',
  ],
  openGraph: {
    type: 'website',
    siteName: 'Vizzor',
    title: 'Vizzor · Predictions with receipts',
    description:
      'Calibrated crypto forecasts. Six signal families. Tracked win rate on every horizon.',
    url: 'https://vizzor.ai',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Vizzor · Predictions with receipts',
    description:
      'Calibrated crypto forecasts. Six signal families. Tracked win rate on every horizon.',
  },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-96x96.png', sizes: '96x96', type: 'image/png' },
      { url: '/favicon.ico', sizes: 'any' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  manifest: '/site.webmanifest',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F4F5F0' },
    { media: '(prefers-color-scheme: dark)', color: '#0A0B0F' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * Root locale layout — owns html/body/head + cross-cutting providers
 * (next-intl, theme). Chrome (header, footer, ticker) lives in the
 * `(marketing)` route-group layout; app shell lives in `app/layout.tsx`.
 * This split lets `/app/*` render without marketing chrome and lets
 * marketing pages keep their full layout without per-route conditionals.
 */
export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${sans.variable} ${mono.variable}`}
    >
      <head>
        <script
          // Pre-React boot to avoid theme flash.
          dangerouslySetInnerHTML={{ __html: themeBootScript }}
        />
      </head>
      {/* suppressHydrationWarning on <body> because some browser
          extensions inject attributes onto <body> before React hydrates
          (ColorZilla, Grammarly, 1Password, etc.) — those are out of
          our control and never affect the tree underneath. */}
      <body className="min-h-dvh antialiased" suppressHydrationWarning>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider>{children}</ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
