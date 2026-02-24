# Issue: Hit Quality Fact-Check Rubric

**Goal**
Increase confidence in live algorithm comparison by applying a consistent, lightweight fact-check method to top-ranked Reddit/X hits.

## Scope
- Applies to `docs/issues/2026-02-23-algorithm-winner-scorecard.md`.
- Sources in scope: `reddit`, `x`.
- Check only top-10 items per topic/source/implementation.

## Rating Rules
- `good_hit`:
  - clearly relevant to the topic intent, and
  - no material factual contradiction found in quick verification.
- `bad_hit`:
  - clearly irrelevant/noise, or
  - materially false/misleading claim against primary source.
- `uncertain`:
  - potentially relevant but not verifiable in quick pass.
  - Count as bad for strictness only when claim is high-risk (security/version/date).

## 3-Step Fact Check (Fast)
1. Relevance pass (30-60s/item):
   - Does this item directly address the query?
2. Claim pass (only when concrete claim exists):
   - Verify version/CVE/date/benchmark claims against primary source.
3. Evidence note:
   - Record one short rationale and one primary-source reference.

## Primary Source Priority
1. Official project/vendor docs/changelog/release notes
2. Official advisories (CVE/NVD/vendor security bulletins)
3. Maintainer-authored posts/releases
4. Reposts/aggregators (supporting only, not primary truth)

## Scoring Mapping
- `relevance_at_10` = `good_hit_count / 10`
- `known_bad_hits` = count of `bad_hit`
- `order_quality`:
  - `5`: top order strongly aligned to high-signal, high-confidence hits
  - `4`: mostly strong ordering with minor noise
  - `3`: acceptable but mixed ordering/noise
  - `2`: weak ordering with frequent noise
  - `1`: mostly poor ordering

## Evidence Table Template

| Topic | Source | Impl | Rank | Item ID | Verdict (`good`/`bad`/`uncertain`) | Why | Primary Source |
|------|--------|------|------|---------|--------------------------------------|-----|----------------|
| topic-a | x | current | 1 | X123 | good | Direct release post, consistent details | https://example.com/release-note |

## Guardrails
- Do not deep-investigate all items.
- Verify only concrete claims; skip broad opinion takes unless ranked very high.
- Keep total review to ~10-15 minutes per topic.

## Decision Use
- Use this rubric to justify `relevance_at_10`, `known_bad_hits`, and `order_quality`.
- Attach filled evidence rows before declaring a final winner.

## Evidence Rows (2026-02-23, X Sample)

| Topic | Source | Impl | Rank | Item ID | Verdict (`good`/`bad`/`uncertain`) | Why | Primary Source |
|------|--------|------|------|---------|--------------------------------------|-----|----------------|
| Bun 1.3 features | x | current | 1 | X5 | good | Direct Bun 1.3.9 performance claim, on-topic | https://bun.sh/blog |
| Bun 1.3 features | x | current | 2 | X20 | bad | SMTP feature request is tangential to “Bun 1.3 features” | https://x.com/jarredsumner/status/2025159838880465406 |
| Bun 1.3 features | x | legacy | 1 | X10 | bad | tsdown bundling post is adjacent ecosystem noise vs core Bun 1.3 release features | https://x.com/youyuxi/status/2024831224045568123 |
| Bun 1.3 features | x | legacy | 2 | X4 | good | Same direct Bun 1.3.9 performance/release signal | https://bun.sh/blog |
| React Server Components security fixes | x | current | 1 | X1 | uncertain | CVE-2026-23864 claim is high-risk; quick pass found secondary references but no primary advisory link in item | https://x.com/ryotkak/status/2015929125631099284 |
| React Server Components security fixes | x | current | 2 | X5 | good | React2Shell exploitation claim aligns with independent vendor analysis | https://www.microsoft.com/en-us/security/blog/2026/02/06/code-injection-attacks-using-publicly-disclosed-rce-vulnerability-in-react-servers/ |
| React Server Components security fixes | x | legacy | 1 | X1 | uncertain | Same high-risk CVE claim needs stronger primary advisory evidence | https://x.com/ryotkak/status/2015929125631099284 |
| React Server Components security fixes | x | legacy | 3 | X11 | good | Threat-activity framing aligns with documented exploitation of React2Shell | https://www.microsoft.com/en-us/security/blog/2026/02/06/code-injection-attacks-using-publicly-disclosed-rce-vulnerability-in-react-servers/ |
| Node.js 24/25 release changes | x | current | 1 | X10 | uncertain | pnpm migration notes are relevant but partially indirect to core Node release deltas | https://x.com/pnpmjs/status/2025699883609428200 |
| Node.js 24/25 release changes | x | current | 3 | X1 | good | Official Node.js account release announcement and version-specific link | https://nodejs.org/en/blog/release/v25.5.0 |
| Node.js 24/25 release changes | x | legacy | 1 | X10 | bad | “Model updates are breaking changes” post is largely opinion/adjacent noise | https://x.com/EtOH0621/status/2024445976304582926 |
| Node.js 24/25 release changes | x | legacy | 2 | X2 | good | Official Node.js patch release references are directly on-topic | https://nodejs.org/en/blog/release/v24.13.1 |
