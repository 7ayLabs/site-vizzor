# Branching Strategy

## 1. Purpose

This document is the governance contract for the `v0.2.x` release cycle of `site-vizzor`. It layers on top of the README's general branch policy and codifies the conventions, naming taxonomy, pull-request rules, commit conventions, forbidden-attribution policy, and exit criteria specific to release cycles that span multiple engineering disciplines.

For day-to-day work outside an active release cycle, the README remains the source of truth. For any work tagged to `v0.2.0`, this document supersedes the README where they differ and supplements it where they agree.

## 2. Flow diagram

```
feature/v0.2.0/<scope>  ─┐
fix/v0.2.0/<scope>       ─┼──►  release/v0.2.0  ──►  main
                          │      (integration)        (1 PR per cycle)
hotfix/<scope>  ──────────┴──►  main                  (production incidents only)
                                  │
                                  └──►  develop, release/* (back-merge)
```

Inter-release flow (carries forward from the README, valid between cycles):

```
feat/* | fix/* ──►  develop  ──►  testing  ──►  main
```

During an active release cycle, the release branch is the integration target. The `develop` / `testing` ladder remains the canonical inter-release flow and resumes between cycles.

## 3. Naming convention

| Branch pattern                  | Purpose                                                                                  | PR target           |
|---------------------------------|------------------------------------------------------------------------------------------|---------------------|
| `release/vX.Y.Z`                | Long-lived integration branch for one minor or major release cycle.                       | `main` (one PR)     |
| `feature/vX.Y.Z/<scope>`        | Sub-branch under a release cycle. Owns a single discipline or deliverable.                | `release/vX.Y.Z`    |
| `fix/vX.Y.Z/<scope>`            | In-cycle bug fix sub-branch.                                                              | `release/vX.Y.Z`    |
| `hotfix/<scope>`                | Production incident response. Branches off `main`.                                        | `main`              |
| `feat/<scope>/<name>`           | Inter-release feature work, per README taxonomy.                                          | `develop`           |
| `fix/<scope>/<name>`            | Inter-release bug fix, per README taxonomy.                                               | `develop`           |

Scope segment rules:
- `<scope>` is mandatory in every branch name.
- For `feature/vX.Y.Z/<scope>`, the scope is a single path component (e.g., `crypto-security`, `wallet-telegram-binding`), not a `domain/name` pair. The version segment provides the additional context the README's two-segment `feat/<scope>/<name>` form was designed to carry.
- Branch-name scope and commit-message scope are orthogonal. A branch named `feature/v0.2.0/purchase-ux` will produce commits with scopes from the README-approved list (e.g., `feat(ui): …`, `feat(i18n): …`).

## 4. Pull-request rules

- Every sub-branch in an active release cycle opens its PR against the matching `release/vX.Y.Z` branch. Never against `main`. Never against `develop` during the cycle.
- The release branch opens exactly one PR into `main` when the cycle is ready to ship.
- No sub-branch ever PRs directly to `main`.
- `hotfix/*` is the only path that bypasses the release branch, and only for production incidents. After a hotfix merges to `main`, it must be back-merged into the active `release/*` branch and into `develop`.

Every pull request, regardless of target, must contain these sections in this order:

1. Summary
2. Business Impact
3. Technical Changes
4. Affected Areas
5. Testing
6. Screenshots (or `N/A` with written justification)
7. Risks
8. Rollback Plan
9. Checklist

The checklist must include, at minimum:

- [ ] Typecheck passes
- [ ] Build passes
- [ ] No dead code
- [ ] No console logs
- [ ] Accessibility reviewed
- [ ] Locale impact reviewed
- [ ] Theme impact reviewed
- [ ] Snapshot impact reviewed
- [ ] Documentation updated

Items marked `N/A` require a one-line justification.

## 5. Commit conventions

All commits follow Conventional Commits and must satisfy the repo's commitlint configuration:

```
type(scope): description
```

- **Allowed types**: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`, `build`, `ci`, `style`, `revert`.
- **Allowed scopes** (from the README's approved list): `home`, `predictions`, `pricing`, `manifesto`, `changelog`, `docs`, `ui`, `i18n`, `api`, `motion`, `theme`, `seo`, `deploy`, `deps`.
- **Description**: lowercase, imperative mood (`add`, not `added` or `adds`), no trailing period.
- Subject line under 72 characters when practical.
- Body is optional; when present, it is wrapped at 100 characters and separated from the subject by one blank line.

## 6. Forbidden attribution

The following are strictly forbidden in commit messages, pull-request bodies, changelog entries, and any markdown content authored under this cycle:

- `Co-Authored-By:` trailer of any form.
- `Generated-By:` trailer of any form.
- References to Claude, ChatGPT, Copilot, Cursor, or any AI tooling, by name or by allusion.
- Pair-programming metadata when one of the parties is an AI tool.
- Emoji of any codepoint in commit messages, PR titles, PR bodies, or changelogs.

Violations are blocking review feedback. A PR with any forbidden attribution must be rewritten before review begins. The maintainer rewriting the offending commits will use `git commit --amend` or `git rebase` on the contributor's own branch — never on a shared branch — and will force-push only the contributor's sub-branch with the contributor's prior consent.

## 7. v0.2.0 cycle structure

The `v0.2.0` cycle decomposes into six sub-branches, one per engineering discipline. Each sub-branch owns its discipline end-to-end and PRs into `release/v0.2.0`.

| Sub-branch                                  | Discipline                  | Common commit scopes          | Definition of done                                                                                          |
|---------------------------------------------|-----------------------------|-------------------------------|-------------------------------------------------------------------------------------------------------------|
| `feature/v0.2.0/web3-purchase-flow`         | Data-integrity / backend    | `api`, `deps`                 | HD-derived per-session addresses, TON watcher parity, idempotent session creation, durable replay cache.    |
| `feature/v0.2.0/wallet-telegram-binding`    | Backend                     | `api`                         | Grant-redeem route, subscription-lookup route, wallet-link route, additive schema migrations, contract doc. |
| `feature/v0.2.0/purchase-ux`                | Frontend                    | `ui`, `i18n`, `pricing`, `motion`, `theme` | Wallet-connect state machine, full failure-mode copy in `en`/`es`/`fr`, grant-handoff card, mobile audit.   |
| `feature/v0.2.0/crypto-security`            | Cybersecurity (blockchain)  | `api`, `deps`                 | Threat model, SIWS replay-protection audit, treasury custody review, durable replay cache, CVE sweep.       |
| `feature/v0.2.0/payment-qa`                 | QA engineering              | `api`, `ui`, `deps`           | Vitest setup, unit + integration coverage for payment surfaces, manual E2E plan, CI `continue-on-error` removed. |
| `feature/v0.2.0/infra-hardening`            | Platform engineering        | `deploy`, `deps`              | Persistent DB volume, secrets in managed store, dedicated RPC, monitoring wiring, documented rollback.      |

Sub-branches operate in parallel. Inter-branch contract dependencies (for example, the binding branch's schema is consumed by the frontend branch's pre-link affordance) are resolved by documenting the contract in the binding branch's RFC and pinning to that contract on the consuming branch.

## 8. Release exit criteria

`release/v0.2.0` may open its single PR to `main` only when all of the following hold:

- All six sub-branches are merged into `release/v0.2.0` or formally dropped from cycle scope with a written rationale in the PR body.
- `pnpm typecheck` is green on `release/v0.2.0` HEAD.
- `pnpm lint` is green on `release/v0.2.0` HEAD.
- `pnpm test` is green on `release/v0.2.0` HEAD with the CI `continue-on-error` flag removed from the test job.
- `pnpm build` is green on `release/v0.2.0` HEAD.
- `package.json` `version` is bumped from `0.1.0` to `0.2.0`.
- `CHANGELOG.md` contains a `v0.2.0` entry with `Added`, `Changed`, `Fixed`, `Removed`, and `Security` sections. Empty sections may be omitted only if no entries exist for that category.
- The PR body documents the rollback plan: image-tag pin, database-migration reversibility, watcher-state implications.
- The PR body documents risk analysis and validation evidence for `/api/health`, `/api/snapshot/`, and `/docs` on a staging deploy.

## 9. Hotfix flow

Hotfixes address production incidents and are the only branches permitted to PR directly to `main`.

```
main ──► hotfix/<scope> ──► main ──► back-merge: release/v0.2.0, develop
```

Procedure:

1. Branch `hotfix/<scope>` off `main` at the SHA that is live in production.
2. Land the minimum change needed to resolve the incident. No refactors. No unrelated cleanups.
3. Open a PR against `main` with the full nine-section PR body. The rollback plan must specify the image tag to redeploy if the hotfix itself regresses.
4. After merge to `main`, immediately open back-merge PRs from `main` into the active `release/v0.2.0` and into `develop`. Both back-merges use the same commit set and must merge before the next deploy.
5. Tag the hotfix commit on `main` with a patch SemVer bump (for example, `v0.1.1` if `v0.1.0` is the last release tag in production).
