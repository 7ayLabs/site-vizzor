import { setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { CapabilitiesSettings } from '@/components/settings/capabilities-settings';

/**
 * /app/settings/capabilities — the per-wallet capability control
 * surface for agent-payment features (v0.5.0).
 *
 * Every capability is opt-in with a per-day USD spend cap and a
 * TOS acceptance. Autonomous mode ships behind an extra
 * acknowledgment because it can trigger transfers without per-
 * message confirmation. Kill switch at the bottom disables all
 * capabilities atomically and cancels pending intents.
 *
 * Client interactivity lives in `CapabilitiesSettings`; the page
 * shell just sets the locale + metadata + wraps the client
 * component in the site's standard settings width.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  return {
    title: 'Capabilities — Vizzor',
    description:
      'Enable and cap the agent-payment capabilities Vizzor can trigger on your wallet.',
  };
}

export default async function CapabilitiesSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div className="mx-auto w-full max-w-[720px] px-6 py-12">
      <CapabilitiesSettings />
    </div>
  );
}
