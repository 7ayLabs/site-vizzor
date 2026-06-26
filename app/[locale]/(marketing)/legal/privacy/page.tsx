/**
 * /legal/privacy — public-facing privacy policy.
 *
 * Server component. Mirrors the authoritative source at
 * `docs/legal/privacy.md` (kept human-friendly there for the
 * operator runbook flow) into a marketing-shaped page so end users
 * can read it from the site footer without leaving the brand.
 *
 * v0.2.x security pass — Layer G3. When the underlying retention
 * windows, cookie list, or third-party flows change, update both
 * this file and the markdown source.
 */

import { setRequestLocale } from 'next-intl/server';
import { GsapHeadline } from '@/components/ui/gsap-headline';

const LAST_UPDATED = '2026-06-06';

export const metadata = {
  title: 'Privacy',
  description:
    'What Vizzor collects, why, how long we keep it, and what you can do about it. No analytics, no tracking cookies, no marketing pixels.',
};

export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <section className="relative">
      <div className="mx-auto w-full max-w-[820px] px-4 sm:px-6 lg:px-8 py-16 lg:py-24">
        <GsapHeadline
          as="h1"
          className="flex flex-col gap-3"
          eyebrow={`Last updated · ${LAST_UPDATED}`}
          title="Privacy"
          titleClassName="display text-[var(--fg)] text-balance text-[40px] sm:text-[52px] lg:text-[60px] leading-[1.0] tracking-tight font-semibold"
        />

        <p className="mt-8 text-[15px] leading-relaxed text-[var(--fg-2)]">
          This is what we collect, why, how long we keep it, and what
          you can do about it. The authoritative source for operators
          lives at{' '}
          <a
            href="https://github.com/7ayLabs/site-vizzor/blob/main/docs/legal/privacy.md"
            target="_blank"
            rel="noopener"
            className="underline underline-offset-4 hover:text-[var(--fg)]"
          >
            docs/legal/privacy.md
          </a>
          . The Git history at that path is the change-log; this page
          is updated together with it.
        </p>

        <Section title="What we collect">
          <ul className="mt-4 flex flex-col gap-3 text-[14px] leading-relaxed text-[var(--fg-2)]">
            <Bullet
              label="Wallet address"
              body="Your public Solana base58 string, captured when you sign the SIWS challenge. We use it to identify your subscription state."
            />
            <Bullet
              label="Auth-session token"
              body="Generated on SIWS verify. The raw value lives only in your browser cookie; the database stores the SHA-256 hash. A database leak yields hashes, not session credentials."
            />
            <Bullet
              label="Subscription state"
              body="Your wallet, tier, cadence, and expiry. Created when the watcher confirms an on-chain payment to our treasury."
            />
            <Bullet
              label="Telegram user ID"
              body="Stored when you redeem a grant code in the Telegram bot. Bound 1:1 with your wallet. Nullable and deletable via the right-to-erasure flow below."
            />
            <Bullet
              label="Hashed client IP"
              body="We HMAC your IP with a server-side salt and use it as a rate-limit bucket key. The raw IP is never persisted."
            />
            <Bullet
              label="Audit log entries"
              body="Each bot-route PII read or write appends a row with hashed subject + hashed IP + hashed UA prefix + outcome. The log doesn't contain raw identifiers and is retained 1 year."
            />
          </ul>
        </Section>

        <Section title="What we don't collect">
          <ul className="mt-4 flex flex-col gap-3 text-[14px] leading-relaxed text-[var(--fg-2)]">
            <Bullet body="Emails, real names, postal addresses, phone numbers." />
            <Bullet body="Browser fingerprints, device IDs, advertising IDs." />
            <Bullet body="Analytics cookies — no Plausible, PostHog, Google Analytics, Vercel Analytics, Microsoft Clarity." />
            <Bullet body="Behavioral tracking across sessions or marketing pixels." />
          </ul>
        </Section>

        <Section title="Cookies we set">
          <p className="mt-4 text-[14px] leading-relaxed text-[var(--fg-2)]">
            Two HttpOnly cookies, both server-set, both SameSite-scoped,
            both <code className="mono">Secure</code> in production:
          </p>
          <div className="mt-3 border border-[var(--border)] rounded-xl overflow-hidden">
            <table className="w-full text-[13px]">
              <thead className="bg-[var(--surface-2)]">
                <tr className="text-left text-[var(--fg-3)]">
                  <th className="px-4 py-2 font-medium">Cookie</th>
                  <th className="px-4 py-2 font-medium">Purpose</th>
                  <th className="px-4 py-2 font-medium">TTL</th>
                </tr>
              </thead>
              <tbody className="text-[var(--fg-2)]">
                <tr className="border-t border-[var(--border)]">
                  <td className="px-4 py-2 mono">vizzor.siws.nonce</td>
                  <td className="px-4 py-2">One-time auth nonce</td>
                  <td className="px-4 py-2">5 min</td>
                </tr>
                <tr className="border-t border-[var(--border)]">
                  <td className="px-4 py-2 mono">vizzor.auth</td>
                  <td className="px-4 py-2">Browser session (raw value never persists server-side)</td>
                  <td className="px-4 py-2">24 hours</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Retention windows">
          <p className="mt-4 text-[14px] leading-relaxed text-[var(--fg-2)]">
            A daily sweep prunes durable rows past their window:
          </p>
          <ul className="mt-3 flex flex-col gap-2 text-[14px] leading-relaxed text-[var(--fg-2)]">
            <li>· Failed / expired payment sessions — <b>30 days</b></li>
            <li>· Confirmed payment sessions — <b>1 year</b> (tax / audit retention)</li>
            <li>· Grant codes after expiry — <b>90 days</b></li>
            <li>· Wallet-link challenges — <b>7 days</b></li>
            <li>· Idempotency keys — <b>7 days</b></li>
            <li>· Rate-limit buckets — <b>1 day</b></li>
            <li>· Audit log — <b>1 year</b></li>
          </ul>
        </Section>

        <Section title="Right to erasure (GDPR Art. 17 / CCPA)">
          <p className="mt-4 text-[14px] leading-relaxed text-[var(--fg-2)]">
            Sign in with the wallet whose data you want removed and
            POST <code className="mono">/api/account/delete</code>. The
            handler:
          </p>
          <ul className="mt-3 flex flex-col gap-2 text-[14px] leading-relaxed text-[var(--fg-2)]">
            <li>· Deletes your <code className="mono">wallet_links</code> row (binding removed)</li>
            <li>· Nulls <code className="mono">subscriptions.telegram_user_id</code> and tombstones the wallet address</li>
            <li>· Scrubs payer addresses on non-confirmed payment sessions</li>
            <li>· Deletes every active auth session for the wallet</li>
            <li>· Appends a hashed audit-log entry</li>
          </ul>
          <p className="mt-3 text-[14px] leading-relaxed text-[var(--fg-2)]">
            Confirmed payment records are retained for 1 year for tax
            and audit compliance — after that window the daily sweep
            removes them too.
          </p>
        </Section>

        <Section title="Third-party data flows">
          <ul className="mt-4 flex flex-col gap-3 text-[14px] leading-relaxed text-[var(--fg-2)]">
            <Bullet
              label="Solana RPC provider"
              body="Your IP when your browser or our server queries the RPC. Operator sets a private RPC URL to keep this out of public providers."
            />
            <Bullet
              label="cdn.jsdelivr.net"
              body="Coin icons fallback. Bypassed for HYPE / POL / TON which we serve from /public/coins."
            />
            <Bullet
              label="Sentry"
              body="Only if the operator has configured SENTRY_DSN. Cookies, signatures, bot tokens, and IPs are stripped by beforeSend before any event reaches Sentry."
            />
          </ul>
        </Section>

        <Section title="Contact">
          <p className="mt-4 text-[14px] leading-relaxed text-[var(--fg-2)]">
            Security disclosures:{' '}
            <a
              href="https://github.com/7ayLabs/site-vizzor/security/advisories/new"
              target="_blank"
              rel="noopener"
              className="underline underline-offset-4 hover:text-[var(--fg)]"
            >
              GitHub Security Advisories
            </a>
            . Privacy-specific contact:{' '}
            <a
              href="mailto:privacy@vizzor.ai"
              className="underline underline-offset-4 hover:text-[var(--fg)]"
            >
              privacy@vizzor.ai
            </a>
            .
          </p>
        </Section>
      </div>
    </section>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12">
      <h2 className="display text-[var(--fg)] text-[24px] sm:text-[28px] leading-[1.1] tracking-tight font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Bullet({ label, body }: { label?: string; body: string }) {
  return (
    <li>
      <span className="text-[var(--fg)] font-medium">{label ? `${label}: ` : ''}</span>
      {body}
    </li>
  );
}
