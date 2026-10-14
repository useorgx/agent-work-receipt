# Changelog

## 0.3.0 - 2026-10-14

- Add Agent Work Receipt v0.3 (`schema/agent-work-receipt.v0.3.schema.json`,
  `$id` `https://useorgx.com/schemas/agent-work-receipt/v0.3/schema.json`,
  exported at `./schema/v0.3`). It is additive over v0.2 and generated from it
  by `scripts/build-v0.3-schema.mjs`; v0.1 and v0.2 receipts validate exactly
  as before. It adds:
  - `outcome.claim_level`: `asserted` < `executed` < `observed` < `checked` <
    `accepted` < `outcome_observed`
  - `outcome.effects[]` and `actions[].coverage` / `outcome.effects[].coverage`:
    `enforced` | `observed_only` | `outside_coverage`
  - `verification.checks[].verifier`: `actor`, `evidence_source`, `model_family`
  - `intent.consequential` (default `true`) and `model.family`
  - `lineage.trace_commitments[]`: `trace_id`, `algorithm: "sha256"`, `root`,
    `construction` (`awr-trace-merkle/v1`), `leaf_count`, `trace_ref`,
    `committed_at`
- The validator enforces v0.3 rules (docs/v0.3.md): a claimed level needs the
  supporting fields of every level up to it (`semantic.claim_level_unsupported`);
  a check verified by the receipt actor cannot support `checked` for
  consequential work (`semantic.self_verification`); the actor cannot accept
  its own work (`semantic.self_acceptance`); effect references resolve and
  effect ids and trace commitments are unique.
- Export `highestSupportedAgentWorkClaimLevel`, `agentWorkClaimLevelIssues`,
  `compareAgentWorkClaimLevels`, `isAgentWorkConsequential`,
  `isSameAgentWorkIdentity`, `effectiveAgentWorkCheckVerifier`, and
  `AGENT_WORK_RECEIPT_CLAIM_LEVELS`.
- Verify Ed25519 signatures in the SDK with Web Crypto: new
  `resolve_public_key` option on `verifyAgentWorkReceiptIntegrity`, plus
  `createAgentWorkKeyResolver` (key-id map, JWKS, fallback),
  `verifyAgentWorkEd25519Signature`, `importAgentWorkEd25519PublicKey`, and
  `decodeAgentWorkEd25519PublicKey`. The `verify_signature` callback API is
  unchanged and takes precedence. No new dependencies.
- Add trace commitment helpers: `computeAgentWorkTraceCommitmentRoot`,
  `createAgentWorkTraceCommitment`, `verifyAgentWorkTraceCommitment`.
- Add the `awr-verify` offline verifier CLI (`bin`), with `--key`, `--keys`,
  `--json`, and `--strict`, and documented exit codes.
- Add `fixtures/release-check.v0.3.json` (signed with the RFC 8032 test key),
  `conformance/agent-work-receipt-v0.3-vectors.json`, its generator
  `scripts/build-v0.3-vectors.mjs`, and tests.
- `npm run build:schema` now builds v0.2 and v0.3.

## 0.2.2 - 2026-10-08

Security maintenance release. No changes to the schema, validator, or public API.

- Patch vulnerable development dependencies: move to `vitest` 4.1.11 and
  `vite` 6.4.3, and pin patched transitive versions via `overrides`
  (`@vitest/mocker`, `fast-uri`, `nanoid`, `postcss`, `source-map-js`,
  `tinypool`), keeping Node 20 test compatibility.
- Add Dependabot for npm (grouped security updates) and GitHub Actions.
- Add a source-release workflow that creates a GitHub release for `v*` and
  `security-*` tags.

## 0.2.1 - 2026-10-08

- Add the `org.orgx.review/v1` extension (`docs/review-extension.md`,
  `schema/extensions/org.orgx.review.v1.schema.json`). It rides in
  `extensions['org.orgx.review/v1']` and is additive: the v0.2 core is unchanged
  and hosts that do not know the namespace ignore it. It carries what a reviewer
  needs to approve or reject work: where each criterion came from (with the
  quoted line and a link), whether that source still agrees (`source_check`),
  four kinds of proof per criterion (`judged`, `measured`, `observed`,
  `outcome`), the episodes of the work with stable content-derived ids tied to
  commits, which layers of the record exist, the inputs, the conversation, and
  independent readings of the same run.
- Export `validateOrgxReviewExtension`, `getOrgxReviewExtension`,
  `orgxReviewExtensionSchema`, `ORGX_REVIEW_EXTENSION_KEY` and the
  `OrgxReview*` types. The validator checks the extension against its schema
  and ties every id back to the receipt it sits in (criteria, sources,
  evidence, actions, trajectory, episodes). It never changes the result of
  `validateAgentWorkReceipt`.
- Export the v0.2 schema at `./schema/v0.2` and the extension schema at
  `./schema/extensions/org.orgx.review/v1`.
- Add `fixtures/hatch-2216-review.v0.2.json`: a real skill-guided verification
  run of pypa/hatch#2216 carrying the extension, and `tests/review.spec.ts`.

## 0.2.0 - 2026-09-27

- Add Agent Work Receipt v0.2. It is additive over v0.1, and the schema is generated from v0.1 by
  `scripts/build-v0.2-schema.mjs`. It adds:
  - `intent.criteria` and `intent.expected_outcomes`
  - `outcome.criteria_results` and `outcome.expected_results`
  - `verification.checks[].criterion_ids`
  - top-level `provenance` and `trajectory`
  - `lineage.workstream_ref` and `lineage.references[].confidence`
- The validator dispatches on `schema_version` and adds the v0.2 cross-reference rules (docs/v0.2.md). v0.1
  receipts validate exactly as before.
- Generic validation messages no longer name a version.
- Add a trail-shaped v0.2 fixture and tests.

## 0.1.1 - 2026-09-24

- Add a crosswalk from Agent Work Receipt fields to agent behavior specs
  (`docs/agent-behavior-spec-crosswalk.md`) and a behavior-spec conformance
  fixture (`fixtures/braintrust-behavior-spec.json`) covered by the
  conformance suite.
- Publish through npm trusted publishing only; the workflow holds no
  long-lived npm token.

## 0.1.0 - 2026-07-21

- Define the account-free Agent Work Receipt v0.1 schema and TypeScript types.
- Add deterministic validation with bounded semantic checks.
- Define RFC 8785 canonicalization and SHA-256 content integrity.
- Define the domain-separated Ed25519 signature profile.
- Publish Codex, Claude Code, and OpenClaw fixtures plus cross-language
  canonicalization, digest, signature, and tamper vectors.
- Keep content equality, cryptographic verification, and signer trust as
  independent result states.
