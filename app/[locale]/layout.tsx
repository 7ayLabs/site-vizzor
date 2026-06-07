import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { sans, mono } from '../fonts';
import { ThemeProvider, themeBootScript } from '@/components/layout/theme-provider';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { TickerCarouselServer } from '@/components/layout/ticker-carousel-server';
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
    // SVG is the primary — its embedded <style> swaps to a white mark
    // under `prefers-color-scheme: dark`. Chrome and Firefox honour it
    // directly; Safari falls back to the .ico.
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
    { media: '(prefers-color-scheme: light)', color: '#FAFAF7' },
    { media: '(prefers-color-scheme: dark)', color: '#0A0A0B' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

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
      <body className="min-h-dvh antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider>
            <TickerCarouselServer />
            <Header />
            <main>{children}</main>
            <Footer />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
