/**
 * /legal/security — public-facing security disclosure policy.
 *
 * Linked from /.well-known/security.txt (RFC 9116) as the `Policy:`
 * URL. Wallet reputation systems (Phantom domain classifier, Blowfish
 * crawler) follow it to confirm the dApp publishes a responsible-
 * disclosure surface.
 *
 * Mirrors the privacy page shape so the marketing footer can render
 * both with the same component conventions.
 */

import { setRequestLocale } from 'next-intl/server';
import { GsapHeadline } from '@/components/ui/gsap-headline';

const LAST_UPDATED = '2026-06-27';

export const metadata = {
  title: 'Security',
  description:
    'Vizzor responsible disclosure policy — scope, safe harbor, reward expectations, and how to report a vulnerability.',
};

export default async function SecurityPage({
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
          title="Security"
          titleClassName="display text-[var(--fg)] text-balance text-[40px] sm:text-[52px] lg:text-[60px] leading-[1.0] tracking-tight font-semibold"
        />

        <p className="mt-8 text-[15px] leading-relaxed text-[var(--fg-2)]">
          This is Vizzor&rsquo;s responsible disclosure policy. The
          canonical contact point is{' '}
          <a
            href="/.well-known/security.txt"
            className="underline underline-offset-4 hover:text-[var(--fg)]"
          >
            /.well-known/security.txt
          </a>{' '}
          (RFC 9116). The page below is the human-readable expansion of
          that file.
        </p>

        <Section title="How to report">
          <ul className="mt-4 flex flex-col gap-3 text-[14px] leading-relaxed text-[var(--fg-2)]">
            <Bullet
              label="Preferred"
              body="Open a GitHub Security Advisory at github.com/7ayLabs/site-vizzor/security/advisories/new. Private, end-to-end encrypted, threaded with the maintainers."
            />
            <Bullet
              label="Email"
              body="security@vizzor.ai. Use PGP if you carry sensitive details; we will reply within 72 hours acknowledging receipt."
            />
            <Bullet
              label="Not for security issues"
              body="Public GitHub issues, Telegram DMs, Twitter — please don't post live exploits on public channels."
            />
          </ul>
        </Section>

        <Section title="What to expect">
          <ul className="mt-4 flex flex-col gap-3 text-[14px] leading-relaxed text-[var(--fg-2)]">
            <Bullet body="Acknowledgement of receipt within 72 hours." />
            <Bullet body="Initial triage decision (in-scope / out-of-scope, severity estimate) within 7 days." />
            <Bullet body="A coordinated disclosure timeline once a fix is staged. Default embargo is 30 days; we negotiate if the bug needs longer." />
            <Bullet body="Public credit in the release notes if you want it. Anonymous credit if you prefer." />
          </ul>
        </Section>

        <Section title="In scope">
          <ul className="mt-4 flex flex-col gap-3 text-[14px] leading-relaxed text-[var(--fg-2)]">
            <Bullet body="vizzor.ai, app.vizzor.ai, api.vizzor.ai — the production stack." />
            <Bullet body="Smart-contract interactions: SIWS authentication, payment session creation, treasury watcher, wallet linking." />
            <Bullet body="Anything that lets an attacker bypass payment, impersonate another wallet, exfiltrate session credentials, or escalate access in the Telegram bot." />
            <Bullet body="Auth-session token handling, CSRF protection, CSP regressions, supply-chain (dependency / build) compromise paths." />
          </ul>
        </Section>

        <Section title="Out of scope">
          <ul className="mt-4 flex flex-col gap-3 text-[14px] leading-relaxed text-[var(--fg-2)]">
            <Bullet body="Reports without a reproducible proof-of-concept." />
            <Bullet body="Volumetric DoS / DDoS — Cloudflare handles those upstream." />
            <Bullet body="Social engineering against the team or our users." />
            <Bullet body="Issues only reproducible on outdated browsers (&lt; latest stable -1)." />
            <Bullet body="Missing security headers on endpoints that intentionally don't set them (e.g. the public RSS feed)." />
            <Bullet body="Self-XSS, clickjacking on pages with no sensitive actions, login/logout CSRF." />
          </ul>
        </Section>

        <Section title="Safe harbor">
          <p className="mt-4 text-[14px] leading-relaxed text-[var(--fg-2)]">
            Good-faith security research is welcome. If you stay inside
            the scope above, avoid harming users, and report what you
            find through the channels above, we will not pursue legal
            action and we will treat your testing as authorized. In
            particular:
          </p>
          <ul className="mt-3 flex flex-col gap-2 text-[14px] leading-relaxed text-[var(--fg-2)]">
            <li>· Don&rsquo;t exfiltrate data beyond what is needed to demonstrate the bug. Stop at proof of concept.</li>
            <li>· Don&rsquo;t pivot from one user&rsquo;s wallet to another&rsquo;s.</li>
            <li>· Don&rsquo;t run automated scanners that submit live payments.</li>
            <li>· Don&rsquo;t publish details before we&rsquo;ve had a chance to ship a fix (default 30-day embargo, negotiable).</li>
          </ul>
        </Section>

        <Section title="Rewards">
          <p className="mt-4 text-[14px] leading-relaxed text-[var(--fg-2)]">
            Vizzor does not currently run a paid bug bounty program. We
            offer public credit and, for high-severity findings that
            we ship as part of a coordinated disclosure, a discretionary
            thank-you payout from the operator&rsquo;s personal wallet.
            This will become a structured program once the user base
            justifies the operational overhead.
          </p>
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
            . Email:{' '}
            <a
              href="mailto:security@vizzor.ai"
              className="underline underline-offset-4 hover:text-[var(--fg)]"
            >
              security@vizzor.ai
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
