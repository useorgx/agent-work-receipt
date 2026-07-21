# Agent Work Receipt v0.1

Agent Work Receipt is an account-free interchange contract for recording what an
agent was asked to do, what authority it had, what it did, what changed, how the
result was checked, and what it cost.

The contract does not require an OrgX account, workspace id, UUID, database row,
or proprietary runtime. Every cross-system identifier is an opaque
`{ system, type, id }` reference owned by its producer. Git commits, GitHub pull
requests, MCP calls, A2A tasks, deployments, and OpenTelemetry traces can all be
represented without translation into an OrgX identifier.

## Contract

- Schema version: `agent-work-receipt/v0.1`
- JSON Schema: `schema/agent-work-receipt.v0.1.schema.json`
- Dialect: JSON Schema Draft 2020-12
- License: Apache-2.0

The required top-level records are:

- `intent`
- `actor`
- `authority`
- `actions`
- `artifacts`
- `evidence`
- `outcome`
- `verification`
- `cost`
- `lineage`
- `human_interventions`
- `timestamps`

`integrity` is optional, but when present it always contains `content_hash`;
signatures without that hash are invalid. Artifact and evidence digests describe
their referenced bytes. Receipt `content_hash` hashes the UTF-8 bytes of RFC 8785
canonical JSON for the receipt with the entire root `integrity` property omitted.
The portable profile uses the exact algorithm identifiers `sha-256` or `sha256`
and supports hex, canonical padded base64, and canonical unpadded base64url;
omitting digest encoding means hex.

Agent Work Receipt signature profile `agent-work-receipt-signature/v0.1` uses
Ed25519 with a canonical unpadded base64url 64-byte signature. Its signed message
is the UTF-8 encoding of RFC 8785 canonical JSON with this semantic shape:

```json
{
  "content_hash": {
    "algorithm": "sha-256",
    "value": "lowercase 64-character hex"
  },
  "profile": "agent-work-receipt-signature/v0.1",
  "protected": {
    "algorithm": "ed25519",
    "encoding": "base64url",
    "key_id": "producer-owned key reference",
    "signed_at": "optional protected timestamp",
    "signer": "optional protected AgentWorkActor"
  }
}
```

The hash is normalized to lowercase hex inside this envelope regardless of its
receipt encoding. The signature value itself is excluded. This domain-separated
payload binds the algorithm, key id, optional signer attribution, and optional
signing time instead of leaving envelope metadata mutable.

Content equality, cryptographic signature validity, and signer trust are three
different states. `verifyAgentWorkReceiptIntegrity` reports them independently
and deliberately has no aggregate `valid` boolean. The SDK computes content
hashes itself; the signature verification implementation, key resolution, and
trust roots remain consumer-supplied policy callbacks. The callback receives
the exact canonical signature payload, its UTF-8 bytes, and decoded signature
bytes.

Numeric values follow the interoperable JSON/IEEE-754 boundary: they must be
finite and between `-9007199254740991` and `9007199254740991`; integer fields
must be safe integers. RFC 8785 hashing therefore has the same number semantics
in JavaScript, JSONB, and conforming consumers. Arbitrary-precision values
belong in a namespaced string extension with an explicit unit or encoding.

## TypeScript

Install the account-free package from npm:

```sh
npm install @useorgx/agent-work-receipt
```

```ts
import {
  hashAgentWorkReceiptContent,
  parseAgentWorkReceipt,
  validateAgentWorkReceipt,
  verifyAgentWorkReceiptIntegrity,
  withAgentWorkReceiptContentHash,
  type AgentWorkReceipt,
} from '@useorgx/agent-work-receipt';

const result = validateAgentWorkReceipt(input);
if (!result.ok) {
  console.error(result.issues);
}

const receipt: AgentWorkReceipt = parseAgentWorkReceipt(input);
const portableReceipt = await withAgentWorkReceiptContentHash(receipt);
const digest = await hashAgentWorkReceiptContent(portableReceipt);

// Verify an independently received signed receipt without rehashing it first.
const signedReceipt: AgentWorkReceipt = parseAgentWorkReceipt(signedInput);
const integrity = await verifyAgentWorkReceiptIntegrity(signedReceipt, {
  verify_signature: async ({ signature, signature_payload, signature_bytes }) =>
    verifyWithYourKeyring(signature.key_id, signature_payload, signature_bytes)
      ? 'verified'
      : 'invalid',
  evaluate_signer_trust: async ({ signature }) =>
    yourTrustPolicy(signature) ? 'trusted' : 'untrusted',
});
```

`withAgentWorkReceiptContentHash` removes existing signatures by default because
rehashing can make them stale. A caller that has independently proved the
signatures still cover identical content may pass
`{ preserve_signatures: true }` as the third argument.

The hashing helpers use the Web Crypto API available in modern browsers and
Node.js 20+. Canonicalization rejects cycles, non-JSON values, non-finite
numbers, sparse arrays, non-plain objects, and unpaired UTF-16 surrogates instead
of silently producing a non-conforming digest.

Duplicate JSON object names must be rejected before ordinary JSON parsing,
because `JSON.parse` and many other parsers irreversibly collapse them. Use
`parseAgentWorkReceiptJson(rawText)` at any raw-text boundary, or provide an
equivalent duplicate-aware parser before calling the object validator. Escaped
and literal spellings that decode to the same member name are duplicates.

Validation failures use RFC 6901 JSON Pointer paths and are sorted by path,
code, then message. This makes errors stable for CLIs, APIs, tests, and import
pipelines. `parseAgentWorkReceipt` throws `AgentWorkReceiptValidationError` with
the same structured issues. `validateAgentWorkReceipt` returns at most 100
issues; failure results include `issue_count` and `issues_truncated` so callers
can report the observed finding count without returning an amplified payload.
Schema validation fails fast at the first structural violation; schema-valid
receipts can receive multiple bounded semantic findings.

The standard JSON Schema `date-time` and `uri-reference` formats are validated
with AJV Formats in full mode. Timestamps therefore follow RFC 3339 (including
the permitted lowercase `t` and `z` forms), while URI references reject malformed
percent escapes, IP literals, and whitespace.

Before JSON Schema evaluation, the SDK applies bounded traversal guards: at
most 64 levels and 50,000 visited JSON nodes. These limits prevent adversarial
recursive `extensions` values from exhausting a validator. A document can
therefore satisfy the standalone JSON Schema yet still fail SDK/API admission
with `input.structure_limit`; public validator metadata exposes both limits.

The validator enforces the JSON Schema plus cross-record invariants:

- unique action, artifact, evidence, intervention, and verification-check ids;
- evidence references resolve to the receipt's evidence records;
- receipt, action, and authority timestamps are ordered;
- terminal actions include completion timestamps; and
- verification summaries agree with their checks.

## Fixtures

The `fixtures` directory contains valid, account-free receipts emitted in the
style of [Codex](fixtures/codex.json),
[Claude Code](fixtures/claude-code.json), and
[OpenClaw](fixtures/openclaw.json). The OpenClaw fixture demonstrates MCP, A2A,
and OpenTelemetry references in a single lineage record. The Claude Code fixture
carries the deterministic Ed25519 conformance signature and a public test key is
published in the integrity vectors; it is test material, not a production key.

Two reusable negative fixtures demonstrate distinct failure boundaries:

- [missing authority](fixtures/invalid-missing-authority.json) is structurally
  invalid because every receipt must declare its authority boundary;
- [unresolved evidence](fixtures/invalid-unresolved-evidence.json) is
  schema-valid but semantically invalid because its verification references an
  evidence id that does not exist in the receipt.

## Cross-language integrity conformance

Portable implementations can consume two versioned, JSON-only boundaries:

- [`conformance/agent-work-receipt-integrity-vectors.v0.1.json`](conformance/agent-work-receipt-integrity-vectors.v0.1.json)
  fixes the RFC 8785 canonical strings and Appendix B number cases, SHA-256
  encodings, receipt hash scope, raw duplicate-member rejection, protected
  Ed25519 payload, and content/signature tamper vectors;
- [`conformance/agent-work-receipt-integrity-report.v0.1.schema.json`](conformance/agent-work-receipt-integrity-report.v0.1.schema.json)
  defines the language-neutral result states for content, cryptography, and
  trust.

The Codex fixture carries the published digest from those vectors. Conforming
implementations must reproduce it after removing only the root `integrity`
member. Changing claimed outcome or cost must change the digest; changing a
declared signature or hash does not change the computed content digest, but can
make the corresponding integrity state fail.

Conforming signature verifiers must reproduce the published payload bytes and
Ed25519 result. Altering `key_id`, `signed_at`, `signer`, signature bytes, or the
declared digest must fail cryptographic verification. Signer trust remains a
separate consumer decision.

## Hosted OrgX import (optional)

Portable receipts can remain entirely outside OrgX. Producers that want a
hosted ledger can `POST https://useorgx.com/api/v1/agent-work-receipts` with a
bearer token or authenticated session and this JSON body:

```json
{
  "workspace_id": "00000000-0000-0000-0000-000000000000",
  "receipt": {},
  "idempotency_key": "producer-owned-retry-key"
}
```

`workspace_id` and `receipt` are required; `idempotency_key` is optional. A new
import returns `201`, and a safe retry of the same content returns `200`. When no
key is supplied, OrgX derives one from the canonical SHA-256 hash of the full
receipt. An explicit key is workspace-scoped, and reuse for different content
returns `409`. Imported producer claims remain unverified until OrgX records
hosted verification or human review. See the
[public OpenAPI contract](https://useorgx.com/api/v1/openapi.yaml) for complete
request, response, and authentication details.

## Versioning

`v0.1` is an interoperability preview. Producers must emit the exact
`schema_version` they implement. Breaking field or meaning changes require a new
schema version; additions that older strict validators cannot accept also require
a new version. Runtime-specific data belongs in namespaced `extensions` and must
not be required to interpret the core receipt.
