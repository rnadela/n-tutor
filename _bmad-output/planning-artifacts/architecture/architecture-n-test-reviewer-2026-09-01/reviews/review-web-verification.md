# Review — Web-Verification Lens

**Artifact:** `ARCHITECTURE-SPINE.md` (architecture-n-test-reviewer-2026-09-01)
**Date of verification:** 2026-09-02
**Method:** live npm registry queries (`registry.npmjs.org`), nodejs.org dist index, vendor documentation fetches, and web search. Package metadata (dist-tags, `peerDependencies`, `engines`, `type`) was read from the registry directly, not recalled.

---

## Verdict

**Conditional pass with two blockers.** Almost every pin in the Stack table is genuinely current — this table was researched, not hallucinated. `gpt-5.6-sol/terra/luna` is real; `pg-boss`'s `fromPrisma` adapter and per-schedule IANA `tz` are real; `zodTextFormat` is real and undeprecated; OpenAI vision genuinely does not accept HEIC/HEIF, so AD-28 is load-bearing and justified.

Two things will stop a build on day one: the `[ASSUMPTION]` TypeScript 7.0.2 pin is incompatible with the NestJS 12 CLI, and `@nestjs/throttler`'s published peer range excludes NestJS 12. Both are resolved below.

---

## 1. Resolved `[ASSUMPTION]` rows

### PostgreSQL — **pin `18.6`** (image `postgres:18.6-alpine`)

| Fact | Source |
| --- | --- |
| Latest stable major is **18**, current patch **18.6**, released 2026-08-13 alongside 17.11 / 16.15 / 15.19 / 14.24 | postgresql.org release news |
| **19 is Beta 3** — preview only, final expected ~Sept–Oct 2026 | postgresql.org |

**Reason for 18.6:** it is the newest *generally available* major, which maximises the runway before a forced major upgrade on a single-Droplet deployment that has no blue/green story (AD-17/AD-18 region). PostgreSQL 19 must not be pinned — it is still beta on the review date and would go to production untested. Pin the **patch**, not just the major: the compose file is scp'd verbatim on every deploy (spine line 261), so `postgres:18` would silently float a major-version-internal upgrade under a named volume. Compatible downstream: `@prisma/adapter-pg` 7.10.0 talks plain wire protocol, and `pg-boss` 12 targets modern PG lines.

**Action:** replace the `[ASSUMPTION]` row with `PostgreSQL | 18.6 (image postgres:18.6-alpine, patch-pinned)`. Add a note that a major upgrade is a deliberate, scheduled operation because the data lives in a named volume.

### TypeScript — **pin `6.0.3`, NOT 7.0.2**

The spine's own hedge ("unless the web-verification reviewer finds it superseded") is the right instinct but the wrong axis. TypeScript 7.0.2 is not superseded — it is the npm `latest` tag, published 2026-07-08. It is **incompatible with this stack**.

| Evidence | Detail |
| --- | --- |
| npm dist-tags for `typescript` | `latest: 7.0.2`, `next: 7.1.0-dev.20260902.1` — **7.1 has not shipped** |
| TS 7.0 ships **no programmatic compiler API**; it lands in 7.1 (targeted autumn 2026, ~October) | Microsoft TS 7.0 announcement |
| **`nest build` is an API consumer** — NestJS maintainers state integration is impossible until 7.1. TS 7 will *type-check* a Nest app; it will not *build* it. Any CLI plugin (e.g. Swagger OpenAPI generation) is dead. | nestjs/nest, NestJS+TS7 field reports |
| `typescript-eslint`'s published peer range allows only `< 6.1.0` — `npm install` hard-fails `ERESOLVE` against `typescript@7` | typescript-eslint npm metadata |
| Next.js 16.3 supports TS 7 only behind **`experimental.useTypeScriptCli`** | vercel/next.js discussion #95633 |
| `@prisma/client@7.10.0` peer: `typescript: ">=5.4.0"` — 6.0.3 satisfies it | registry |

**Reason for 6.0.3:** it is the last stable release of the JS-implementation line (`6.0.2`, `6.0.3`; 6.0.3 published 2026-04-16), it is what `nest build`, `typescript-eslint`, and the Next.js non-experimental path all actually consume, and it keeps the whole monorepo on one compiler. Microsoft explicitly ships `@typescript/typescript6` as the side-by-side compatibility package precisely for this situation, which is a tell that 6.x is the supported production line right now.

**Action:** replace the `[ASSUMPTION]` row with `TypeScript | 6.0.3`. Add a revisit trigger: *"re-evaluate TS 7 when 7.1 GA ships with the programmatic API and NestJS CLI + typescript-eslint publish support."* Do not adopt TS 7 mid-build for a claimed 10x type-check speedup on a project this size — the speedup is not worth losing `nest build`.

---

## 2. Corrected Stack table

Changes marked **▲ changed**, **✚ added pin**, **⚠ risk**.

| Name | Spine | Verified / recommended | Note |
| --- | --- | --- | --- |
| Node | `>= 22` | **`>= 24` (pin 24.20.0 in the image)** ▲ | Node 24 *Krypton* is **Active LTS** (24.20.0, 2026-08-26). Node 22 *Jod* is in **Maintenance** (22.23.2), EOL April 2027. `openai@7` requires `>=22.0.0`, `pg-boss@12` `>=22.12.0`, `file-type@22` `>=22`, `@prisma/client@7.10` `^20.19 \|\| ^22.12 \|\| >=24`. `>=22` is not *wrong*, but starting a greenfield build on a maintenance line is a self-inflicted upgrade within the v0 lifetime. |
| Turborepo | 2.10.12 | ✅ 2.10.12 (latest, 2026-08-25) | Correct. |
| pnpm | 11.25.0 | ✅ 11.25.0 (`latest` and `latest-11`) | Correct. ⚠ Note `latest-12: 12.2.1` exists as a published major but is **not** the `latest` tag — 11.25.0 is the right conservative pin. |
| NestJS (core) | 12.0.1 | ✅ 12.0.1 (latest, 2026-08-27) | Correct. ⚠ v12 is a large shift: ESM-first packages, Standard Schema validation, rebuilt CLI, **Vitest replacing Jest**, **oxlint replacing ESLint**, **Rspack replacing Webpack**. The spine's test-tier AD (AD-22) names Playwright but never names a unit runner — decide Vitest explicitly rather than inheriting it. Requires Node `^20.19 \|\| ^22.12+`. |
| prisma (CLI) | 7.10.0 | ✅ 7.10.0 — **⚠ do not use `@latest`** | **npm `latest` for `prisma` currently points at `8.0.0-rc.12`** (published 2026-08-26). The stable line is carried on the **`prev`** tag (`7.10.0`). `@prisma/client`'s own `latest` is still `7.10.0`, so CLI and client diverge under `@latest`. Exact-pin both; never `^`. |
| @prisma/client | 7.10.0 | ✅ 7.10.0 (latest, 2026-08-25) | Correct. |
| @prisma/adapter-pg | "matching 7.10.0" | ✅ 7.10.0 exists | Correct — and required by `pg-boss`'s `fromPrisma` (see §3). Write the literal version, not "matching". |
| PostgreSQL | `[ASSUMPTION]` | **18.6** ✚ | Resolved above. |
| TypeScript | `[ASSUMPTION]` 7.0.2 | **6.0.3** ▲ **BLOCKER** | Resolved above. |
| pg-boss | 12.29.0 | ✅ 12.29.0 (latest, 2026-08-30) | Correct. ⚠ `"type": "module"` — **ESM-only**. Fine under NestJS 12's ESM packaging, fatal under a CJS build. |
| Next.js | 16.3.4 | ✅ 16.3.4 (latest, 2026-08-31) | Correct. |
| React | 19.2.8 | ✅ 19.2.8 (latest, 2026-07-21) | Correct; satisfies Next 16.3.4 peer `^19.0.0`. |
| @mui/material | 9.4.0 | ✅ 9.4.0 (latest, 2026-08-27) | Correct; peer allows React 19. ✚ The Stack table omits the **required** peers `@emotion/react ^11.5.0` and `@emotion/styled ^11.3.0` — add them, they are not optional. `@mui/material-pigment-css ^9.4.0` is also declared as a peer; confirm it is in `peerDependenciesMeta.optional` before assuming you can skip it. |
| openai (Node SDK) | 7.8.0 | **7.9.0** ▲ | 7.9.0 is `latest`, published **2026-09-02** (today) — 7.8.0 is one minor behind, not wrong. `engines: node >=22`. Peer `zod: ^3.25 \|\| ^4.0`; current zod `latest` is **4.5.4** — the spine never pins zod despite AD-9 depending on it. ✚ **Add a `zod` row (4.5.4).** |
| argon2 | 0.45.1 | ✅ 0.45.1 (latest, 2026-07-21) | Correct, maintained, right fit for password hashing (AD-23 correctly notes it is deliberately expensive, hence the login throttle). |
| sharp | *(no version)* | ✚ **0.35.4** (latest, 2026-08-26) | Usage is right — see §4. |
| file-type | *(no version)* | ✚ **22.0.2** (latest, 2026-08-15) | ⚠ `"type": "module"` — **ESM-only** since v17. Byte-sniffing usage is correct. |
| Playwright | 1.62.1 | ✅ 1.62.1 (latest, 2026-07-30) | Correct. |
| @nestjs/throttler | *(named in AD-23, unpinned)* | ⚠ **6.5.0 — peer range excludes NestJS 12** | **BLOCKER.** Published 2025-12-02; `peerDependencies` cap at `@nestjs/core: ^7 \|\| ^8 \|\| ^9 \|\| ^10 \|\| ^11`. Against `@nestjs/core@12.0.1` this is an `ERESOLVE` / pnpm peer failure. Nine months without a release across a NestJS major is a maintenance signal. See §5. |
| @sentry/node | *(unpinned)* | ✚ **10.73.0** (2026-08-31) | Active, current major. |
| @sentry/nextjs | *(unpinned)* | ✚ **10.73.0** (2026-08-31) | Peer `next: ^16.0.0-0` — satisfied by 16.3.4. `engines: node >=18`. |
| Sentry plan | "free tier, one project" | ⚠ **Developer plan = 5,000 errors/mo, 1 user, 30-day retention** | See §6. |
| Caddy | "automatic ACME, reverse proxy" | ✚ **2.11.4** (2026-06-03) | Actively maintained, right fit. Pin the image tag — the Caddyfile is scp'd on every deploy, so a floating `caddy:latest` changes TLS behaviour without a code change. |
| OpenAI models | `gpt-5.6-sol` / `-terra` / `-luna`, `text-embedding-3-small` | ✅ all four exist | See §7. |

---

## 3. `pg-boss` — both claimed features **confirmed**

The spine relies on two specific pg-boss capabilities. Both are real, documented, and match the spine's description.

- **Enqueue inside a Prisma transaction (AD-5).** `pg-boss` exports an ORM transaction adapter `fromPrisma` (imported from `pg-boss` itself, alongside `fromKnex`, `fromKysely`, `fromDrizzle`). `send()`, `insert()`, `fetch()`, and `complete()` accept a `db` option: `await boss.send('q', payload, { db: fromPrisma(tx) })` inside `prisma.$transaction`. If the transaction rolls back, so does the job — exactly the atomicity AD-5 asserts.
  **Requirement, and the spine already satisfies it:** `fromPrisma` requires **Prisma v7+ with `@prisma/adapter-pg`**. The Stack table pins both. This is a case where the spine's pins are load-bearing rather than incidental — annotate the `@prisma/adapter-pg` row to say so, or a future "simplify the deps" pass will delete it and break AD-5.
- **Per-schedule IANA timezone (AD-33, and AD-27's timezone-history rule).** `schedule(name, cron, data, options)` takes `tz`, which accepts IANA names (`{ tz: 'America/Chicago' }`), defaults to UTC, and — usefully for AD-27 — **an unrecognised zone is rejected at `schedule()` time**, so a typo cannot be persisted and then fail silently on a cron pass. This validation behaviour is worth quoting in AD-33; it is a free correctness guarantee the spine currently does not claim.

**AD-33's "pg-boss schedules only; never `@nestjs/schedule`" is sound** — it is the only way to get single-fire scheduling on a multi-container deploy, and `@nestjs/schedule` is per-process.

---

## 4. `sharp` and `file-type` — usage confirmed, one caveat the spine already anticipates

- **`sharp(buffer).rotate()`** with no arguments is documented as the auto-orient operation: it applies the EXIF Orientation tag to the pixels and then removes the tag. Correct as written in AD-28. In current sharp, `.autoOrient()` is the named form and parameterless `.rotate()` calls it for backwards compatibility — either is fine; keep `.rotate()`.
- **The `meta.autoOrient` width caveat the spine tells you to carry forward from n-electric is real and still open.** After `rotate()`, image *pixels* are rotated but `metadata()` `width`/`height` are not updated (lovell/sharp #1897, #3124). AD-28's instruction to carry the n-electric fix is therefore correct and should not be dropped as cargo-cult — flag it as verified rather than inherited.
- Also note: **sharp strips EXIF by default**; retaining orientation requires `keepExif()`. Since AD-28 deliberately normalises orientation into the pixels, stripping is the *desired* behaviour — but say so, because "we re-encode to JPEG q85" silently also means "we drop all EXIF", which has a privacy upside (GPS tags from a phone camera never reach storage) that AD-20's no-child-content rule would want to claim explicitly.
- **`file-type` byte-sniffing** is the correct control and correctly distrusts the client MIME. v22 is current and maintained. ⚠ ESM-only.

---

## 5. `@nestjs/throttler` — the second blocker

AD-23 makes IP rate limiting on unauthenticated endpoints a named defense, with an explicit dependency on `@nestjs/throttler`. Registry facts as of today:

```
@nestjs/throttler  latest: 6.5.0   published 2025-12-02
  peerDependencies:
    @nestjs/core:   ^7.0.0 || ^8.0.0 || ^9.0.0 || ^10.0.0 || ^11.0.0
    @nestjs/common: ^7.0.0 || ^8.0.0 || ^9.0.0 || ^10.0.0 || ^11.0.0
```

Against the pinned `@nestjs/core@12.0.1` this fails peer resolution. There is precedent (nestjs/throttler #2235) for exactly this lag at the v10→v11 boundary, resolved by a subsequent release.

**Not fatal, but it must be a decision rather than a surprise.** Options, in order of preference:
1. Check for a v7 release before the build starts — a NestJS 12–compatible throttler is the likely near-term outcome and the cleanest path.
2. Ship with a pnpm `peerDependencyRules.allowedVersions` override and a test that actually exercises the throttle. The library is unlikely to break on a Nest major, but "unlikely" needs the test.
3. Implement the throttle directly as a NestJS guard over the same in-process store. AD-23 already scopes this narrowly ("in-process storage is valid only while the deployment is single-host"), so the surface is small — two endpoints, signup and login.

**Do not silently drop the throttle.** AD-23 correctly identifies that argon2's cost makes an unthrottled login endpoint a CPU DoS; that reasoning stands and the mechanism is required.

---

## 6. Sentry — the free tier is tighter than AD-21 assumes

- SDKs: `@sentry/node` and `@sentry/nextjs` are both at **10.73.0** (2026-08-31), actively released, correct choices. `@sentry/nextjs` peers `next: ^16.0.0-0`.
- **Free Developer plan: 5,000 errors/month, 1 user, 30-day retention.** AD-21 routes *three* runtime containers (`api`, `web`, `worker`) into one free project.

Two consequences AD-21 does not address:
- **5k/mo is one bad deploy.** A crash-looping worker or a repeated provider timeout can exhaust the monthly quota in hours, after which the very failures the AD exists to catch are dropped. Add client-side rate limiting / `sampleRate` and, more importantly, **spike protection**, so the alerting channel survives its own incident.
- **1 user.** AD-21 treats Sentry as the notification path for "a queued job dying silently in the worker." A single-seat plan means exactly one human can ever see that. If more than one person operates this, the free tier is not a viable ops channel and the spine should say so rather than discover it during an incident.

The AD-21 privacy configuration (`sendDefaultPii: false`, request-body off, local-variable capture off, cookie/header capture off, `beforeSend` denylist) is correct and matches current SDK option names. Keep it mandatory.

---

## 7. OpenAI — models, API mechanism, and the HEIC claim

### Model family: real, current, correctly chosen

`gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` are genuine OpenAI API model ids, GA since **2026-07-09**, self-serve with no gating. `gpt-5.6` is an alias for Sol. All three accept **text and image input**, 1,050,000-token context, up to 128,000 output tokens. Published pricing per 1M tokens: Sol $5/$30, Terra $2.50/$15, Luna $1/$6.

AD-8's tier assignment is defensible against that price curve: the frontier tier on Extraction (vision over a child's handwritten page, where an error propagates into every downstream artifact), the cheap fast tier on the high-volume Grading/Explanation path.

**One inconsistency to fix.** AD-8 says model ids are *"snapshot ids held in configuration"* and the operative rule is "pinned snapshot ids in configuration, never in code." But every id the spine actually names — `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` — is a **rolling alias**, not a dated snapshot. The convention table (line 435) repeats "Pinned snapshot ids." The spine therefore mandates snapshot pinning and then supplies aliases. Resolve one way or the other: either record the dated snapshot ids at build time and accept the retirement-tracking burden that AD-22's Tier-3 live suite is explicitly designed to detect, or state that v0 pins aliases and that Tier 3 is the retirement canary. The current text asserts a discipline the Stack table does not follow.

`text-embedding-3-small` (AD-11 stage 2) is **current and undeprecated** — still the default production embedding model in 2026 at $0.02/1M tokens; `text-embedding-ada-002` is the superseded one. AD-11's decision to store vectors in an ordinary Prisma column and cosine-compare in application code, with **pgvector explicitly not adopted**, is proportionate at this scale.

### Responses API + Structured Outputs + `zodTextFormat`: confirmed current, not deprecated

Verified by unpacking `openai@7.9.0` from the registry:

```
package/helpers/zod.d.ts exports:
  zodFunction, zodRealtimeFunction, zodResponseFormat,
  zodResponsesFunction, zodTextFormat
```

No `@deprecated` marker anywhere in the file. AD-9 is accurate on every point:

- **Import path `openai/helpers/zod` is correct** and `zodTextFormat` is exported from it.
- **`zodTextFormat` is the Responses-API helper**, used as `text.format` with `responses.parse()`. `zodResponseFormat` is the *Chat Completions* helper — AD-9's "never Chat Completions `response_format`, never legacy `json_object`" correctly keeps these apart, and this is a distinction call sites get wrong constantly.
- **Responses API + Structured Outputs is the current recommended mechanism** for parsed output.

⚠ **One implementation trap worth putting in the AD.** There is a recurring, well-documented failure (openai-node #1597 and community reports) where `zodTextFormat` yields a 400 — *"schema must be a JSON Schema of type: 'object'"* — usually from a zod version mismatch or a non-object root schema. Since AD-9 binds **every** parsed call site, add the rule: **the root of every AI schema is a `z.object`, never a bare scalar, union, or array**, and pin `zod` explicitly (`4.5.4`) since the SDK peer accepts both `^3.25` and `^4.0` and a floating install can land on either.

### HEIC/HEIF: AD-28 is correct — this is a real constraint, not a defensive myth

Per the current OpenAI images-and-vision documentation, supported input formats are exactly:

> PNG (`.png`), JPEG (`.jpeg`/`.jpg`), WEBP (`.webp`), non-animated GIF (`.gif`)

**HEIC, HEIF, and AVIF are not supported.** AD-28's premise — "an iPhone-default HEIC reaching a vision call that cannot read it" — is verified, and mandatory ingest normalisation before any vision call is the right structural answer for a product whose primary input is a parent photographing a page with an iPhone.

AD-28's `ALLOWED_MIMES` set (`jpeg, png, webp, heic, heif, avif`) is **correctly wider than the provider's** — accept what the phone produces, normalise to JPEG q85 before the model ever sees it. That asymmetry is deliberate and should be commented as such in code, or someone will "fix" the list down to the provider's four and break iPhone upload.

### Per-request limits: the spine is well inside them

Current documented limits: **up to 512 MB total payload per request** and **up to 1,500 images per request** (plus a per-image cap of 30,000 patches after model-side resizing, beyond which the image is *rejected*, not downscaled). Common secondary sources still cite the older 20 MB / 500-image figures — those are stale; the vendor docs are authoritative.

The spine's Extraction call is **"up to 10 images"** (line 101), which is two orders of magnitude inside both limits. **No limit stated in the spine is wrong.** The relevant risk is the per-image patch cap: a modern phone camera JPEG at full resolution can be large, so AD-28's re-encode step should also **bound the long edge**, not only re-encode quality — the spine currently specifies `q85` but no dimension cap.

AD-33's **180-second vision timeout** and its reasoning ("the SDK retries the whole multi-image request, so the inherited 30s default is 90s of guaranteed failure on a 10-image call") is sound and consistent with the SDK's default retry behaviour.

---

## 8. Abandoned / deprecated / poor-fit scan

Every named technology was checked for abandonment. Results:

| Verdict | Items |
| --- | --- |
| **Actively maintained, right fit** | Turborepo, pnpm, NestJS, Prisma, pg-boss, Next.js, React, MUI, openai SDK, argon2, sharp, file-type, Playwright, Caddy, Sentry, PostgreSQL, zod |
| **Maintenance-lag risk** | `@nestjs/throttler` — 9 months since release, peer range excludes the pinned NestJS major (§5) |
| **Wrong line pinned** | TypeScript 7.0.2 (§1) |
| **Deceptive `latest` tag** | `prisma` CLI — `latest` is `8.0.0-rc.12`, stable is on `prev` |
| **Nothing abandoned or superseded** | — |
| **Correctly rejected** | `pgvector` / `prisma-extension-pgvector` (AD-11) and `@nestjs/schedule` (AD-33). Both rejections are well-reasoned for this scale and this deployment shape. |

**ESM footgun, worth one line in the spine.** `pg-boss@12`, `file-type@22`, and NestJS 12's packaging are all ESM; `sharp`, `openai`, `@mui/material`, and `argon2` publish CommonJS. NestJS 12's ESM migration makes this workable, but module format is now a real integration constraint rather than a non-issue, and it is the kind of thing that surfaces at the first `worker` container build rather than in local dev.

---

## 9. Recommended edits, ordered

1. **TypeScript → `6.0.3`.** Delete the 7.0.2 assumption. Add the TS 7.1 revisit trigger. *(blocker)*
2. **Resolve `@nestjs/throttler` against NestJS 12** — recheck for v7, else pnpm override + a test, else a hand-rolled guard. *(blocker)*
3. **PostgreSQL → `18.6`**, patch-pinned in the compose file.
4. **Annotate the prisma CLI row: never `@latest`** — `latest` is an 8.0 RC; stable is `prev`/`7.10.0`. Exact-pin CLI and client together.
5. **Add the missing Stack rows:** `zod 4.5.4`, `sharp 0.35.4`, `file-type 22.0.2`, `@nestjs/throttler`, `@sentry/node 10.73.0`, `@sentry/nextjs 10.73.0`, `Caddy 2.11.4`, `@emotion/react` + `@emotion/styled`.
6. **Node → `>= 24`** (Active LTS) rather than `>= 22` (Maintenance).
7. **Fix AD-8's snapshot-vs-alias contradiction** — pick one and say which.
8. **AD-9: mandate `z.object` roots** and pin zod, to pre-empt the known `zodTextFormat` 400.
9. **AD-21: acknowledge the 5k-errors/month and 1-user free-tier ceilings**; enable spike protection.
10. **AD-28: add a max-dimension bound** alongside JPEG q85; note that re-encoding also strips EXIF (a privacy win worth claiming under AD-20).
11. **openai SDK → 7.9.0** (optional; 7.8.0 is one minor behind, not broken).
12. **Name the unit test runner explicitly** (NestJS 12 defaults to Vitest) — AD-22 defines three tiers but never names the Tier-1 runner.

---

## Sources

- [npm registry](https://registry.npmjs.org/) — dist-tags, `peerDependencies`, `engines`, publish timestamps for all pinned packages
- [Node.js release index](https://nodejs.org/dist/index.json) — LTS status for 22 / 24 / 26
- [PostgreSQL 18.6 release announcement](https://www.postgresql.org/about/news/postgresql-184-1710-1614-1518-and-1423-released-3297/) · [endoflife.date/postgresql](https://endoflife.date/postgresql)
- [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) · [Why Angular, Vue, and ESLint can't upgrade to TS 7.0 yet](https://dev.to/the-modern-web/why-angular-vue-and-eslint-cant-upgrade-to-typescript-70-yet-and-why-ts-71-changes-441g) · [NestJS and TypeScript 7: what works, what doesn't](https://fernforge.github.io/devnotes/nestjs-typescript-7/)
- [NestJS v12 release](https://github.com/nestjs/nest/releases/tag/v12.0.0) · [NestJS v12 is Now Available (Trilon)](https://trilon.io/blog/nestjs-12-is-now-available)
- [pg-boss ORM transaction adapters](https://pgboss.io/api/adapters) · [pg-boss scheduling](https://pgboss.io/api/scheduling)
- [OpenAI — Images and vision guide](https://developers.openai.com/api/docs/guides/images-vision) · [Models](https://developers.openai.com/api/docs/models) · [GPT-5.6 announcement](https://openai.com/index/gpt-5-6/) · [Structured outputs guide](https://platform.openai.com/docs/guides/structured-outputs) · [Vector embeddings](https://developers.openai.com/api/docs/guides/embeddings)
- [openai-node #1597 — zodTextFormat schema error](https://github.com/openai/openai-node/issues/1597)
- [sharp image operations](https://sharp.pixelplumbing.com/api-operation/) · [lovell/sharp #1897 — width/height not updated after rotate()](https://github.com/lovell/sharp/issues/1897)
- [nestjs/throttler](https://github.com/nestjs/throttler) · [#2235 — unable to install on Nest v11](https://github.com/nestjs/throttler/issues/2235)
- [Next.js — Add support for TypeScript 7](https://github.com/vercel/next.js/discussions/95633)
- [Sentry Developer plan limits](https://costbench.com/software/developer-tools/sentry/free-plan/)
- [Caddy releases](https://github.com/caddyserver/caddy/releases)
