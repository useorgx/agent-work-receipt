// Builds the v0.3 conformance material from fixtures/release-check.v0.3.json:
//   - fills the fixture's trace commitment root and signs it (integrity) with the RFC 8032 section 7.1 TEST 1 key;
//   - writes conformance/agent-work-receipt-v0.3-vectors.json.
//
// It deliberately does not import the SDK: canonicalization, hashing, the Merkle construction, and Ed25519 signing are
// re-implemented here with node:crypto so the tests compare two independent implementations. Expected validation
// results are written by hand below, never computed by the validator under test.
//
// The signing key is the published RFC 8032 test key. It is test material, not a production key.
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import fs from 'node:fs';

const fixtureUrl = new URL('../fixtures/release-check.v0.3.json', import.meta.url);
const vectorsUrl = new URL('../conformance/agent-work-receipt-v0.3-vectors.json', import.meta.url);

// RFC 8785 for the I-JSON values used here: ES2015 number formatting, sorted UTF-16 keys.
const jcs = (v) =>
  v === null || typeof v !== 'object'
    ? JSON.stringify(v)
    : Array.isArray(v)
      ? `[${v.map(jcs).join(',')}]`
      : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${jcs(v[k])}`).join(',')}}`;
const sha256 = (...parts) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
};

// awr-trace-merkle/v1
const mth = (leaves) => {
  if (leaves.length === 0) return sha256(Buffer.alloc(0));
  if (leaves.length === 1) return leaves[0];
  let k = 1;
  while (k * 2 < leaves.length) k *= 2;
  return sha256(Buffer.of(1), mth(leaves.slice(0, k)), mth(leaves.slice(k)));
};
const traceRoot = (spans) =>
  mth(spans.map((s) => sha256(Buffer.of(0), Buffer.from(jcs(s), 'utf8'))).sort(Buffer.compare)).toString('hex');

const fixtureSpans = [
  { trace_id: '4bf92f3577b34da6a3ce929d0e0e4736', span_id: '00f067aa0ba902b7', name: 'agent.session', start_time_unix_nano: '1790845200000000000', end_time_unix_nano: '1790850600000000000' },
  { trace_id: '4bf92f3577b34da6a3ce929d0e0e4736', span_id: '53995c3f42cd8ad8', parent_span_id: '00f067aa0ba902b7', name: 'tool.file_edit', start_time_unix_nano: '1790845320000000000', end_time_unix_nano: '1790845380000000000', attributes: { 'file.path': 'services/reporting/limits.yaml' } },
  { trace_id: '4bf92f3577b34da6a3ce929d0e0e4736', span_id: 'b7ad6b7169203331', parent_span_id: '00f067aa0ba902b7', name: 'tool.github.create_pull_request', start_time_unix_nano: '1790845380000000000', end_time_unix_nano: '1790845440000000000' },
];

const seed = Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex');
const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
const publicKey = createPublicKey(privateKey).export({ format: 'jwk' }).x;
const wrongPublicKey = 'PUAXw-hDiVqStwqnTRt-vJyYLM8uxJaMwM1V8Sr0Zgw'; // RFC 8032 TEST 2

const receipt = JSON.parse(fs.readFileSync(fixtureUrl, 'utf8'));
delete receipt.integrity;
receipt.lineage.trace_commitments[0].root = traceRoot(fixtureSpans);
const contentHash = sha256(Buffer.from(jcs(receipt), 'utf8')).toString('hex');
const sig = { algorithm: 'ed25519', encoding: 'base64url', key_id: 'rfc8032-test-key-1', signer: { type: 'service', id: 'claude-code-receipt-emitter' }, signed_at: '2026-10-01T10:30:06Z' };
const payload = jcs({
  content_hash: { algorithm: 'sha-256', value: contentHash },
  profile: 'agent-work-receipt-signature/v0.1',
  protected: { algorithm: sig.algorithm, encoding: sig.encoding, key_id: sig.key_id, signer: sig.signer, signed_at: sig.signed_at },
});
const signature = sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64url');
receipt.integrity = {
  content_hash: { algorithm: 'sha-256', value: contentHash, encoding: 'hex' },
  signatures: [{ algorithm: sig.algorithm, encoding: sig.encoding, value: signature, key_id: sig.key_id, signer: sig.signer, signed_at: sig.signed_at }],
};
fs.writeFileSync(fixtureUrl, JSON.stringify(receipt, null, 2) + '\n');

// A different, still canonical signature: flip one byte in the middle.
const flipped = Buffer.from(signature, 'base64url');
flipped[20] ^= 0x01;
const flippedSignature = flipped.toString('base64url');

// The content hash a verifier must compute after the "metric-changed" tamper below.
const tampered = structuredClone(receipt);
delete tampered.integrity;
tampered.outcome.metrics[0].value = 0.01;
const tamperedHash = sha256(Buffer.from(jcs(tampered), 'utf8')).toString('hex');

const issue = (path, code) => ({ path, code });
const F = '../fixtures/release-check.v0.3.json';
const vectors = {
  vector_version: 'agent-work-receipt-v0.3-vectors/v1',
  description: 'Language-neutral v0.3 conformance vectors. Each case applies an RFC 6902 patch (add, replace, remove only) to its base receipt, then states the exact result. For invalid validation cases, issues lists every expected { path, code } pair in the validator\'s deterministic order (sorted by path, then code).',
  validation_vectors: [
    { name: 'outcome-observed-fixture', base: F, patch: [], expected: { ok: true, highest_supported_claim_level: 'outcome_observed' } },
    { name: 'v0.2-receipt-still-valid', base: '../fixtures/trail-v0.2.json', patch: [], expected: { ok: true } },
    { name: 'v0.1-receipt-still-valid', base: '../fixtures/codex.json', patch: [], expected: { ok: true } },
    { name: 'claim-level-absent', base: F, patch: [{ op: 'remove', path: '/outcome/claim_level' }], expected: { ok: true, highest_supported_claim_level: 'outcome_observed' } },
    { name: 'checked-without-outcome-observation', base: F, patch: [{ op: 'replace', path: '/outcome/claim_level', value: 'checked' }, { op: 'remove', path: '/outcome/metrics' }, { op: 'remove', path: '/outcome/expected_results' }], expected: { ok: true, highest_supported_claim_level: 'accepted' } },
    { name: 'self-check-supports-checked-for-inconsequential-work', base: F, patch: [{ op: 'replace', path: '/outcome/claim_level', value: 'checked' }, { op: 'replace', path: '/intent/consequential', value: false }, { op: 'remove', path: '/verification/checks/1' }, { op: 'remove', path: '/verification/checks/0' }], expected: { ok: true } },
    { name: 'asserted-needs-nothing', base: F, patch: [{ op: 'replace', path: '/outcome/claim_level', value: 'asserted' }, { op: 'remove', path: '/outcome/effects' }], expected: { ok: true, highest_supported_claim_level: 'executed' } },
    {
      name: 'executed-without-completed-action', base: F,
      patch: [{ op: 'replace', path: '/outcome/claim_level', value: 'executed' }, { op: 'replace', path: '/actions/0/status', value: 'running' }, { op: 'replace', path: '/actions/1/status', value: 'running' }, { op: 'replace', path: '/actions/2/status', value: 'running' }],
      expected: { ok: false, issues: [issue('/actions', 'semantic.claim_level_unsupported')] },
    },
    {
      name: 'observed-with-only-outside-coverage-effects', base: F,
      patch: [{ op: 'replace', path: '/outcome/claim_level', value: 'observed' }, { op: 'replace', path: '/outcome/effects/0/coverage', value: 'outside_coverage' }, { op: 'replace', path: '/outcome/effects/1/coverage', value: 'outside_coverage' }],
      expected: { ok: false, issues: [issue('/outcome/effects', 'semantic.claim_level_unsupported')] },
    },
    {
      name: 'checked-by-the-actor-itself', base: F,
      patch: [{ op: 'replace', path: '/outcome/claim_level', value: 'checked' }, { op: 'remove', path: '/verification/checks/1' }, { op: 'remove', path: '/verification/checks/0' }],
      expected: { ok: false, issues: [issue('/verification/checks/0/verifier/actor', 'semantic.self_verification')] },
    },
    {
      name: 'checked-by-the-actor-via-receipt-verifier', base: F,
      patch: [{ op: 'replace', path: '/outcome/claim_level', value: 'checked' }, { op: 'remove', path: '/verification/checks/2/verifier' }, { op: 'remove', path: '/verification/checks/1' }, { op: 'remove', path: '/verification/checks/0' }, { op: 'replace', path: '/verification/verifier', value: { type: 'agent', id: 'claude-code-agent' } }],
      expected: { ok: false, issues: [issue('/verification/verifier', 'semantic.self_verification')] },
    },
    {
      name: 'checked-without-passed-check', base: F,
      patch: [{ op: 'replace', path: '/outcome/claim_level', value: 'checked' }, { op: 'replace', path: '/verification/status', value: 'inconclusive' }, { op: 'replace', path: '/verification/checks/0/status', value: 'inconclusive' }, { op: 'replace', path: '/verification/checks/1/status', value: 'skipped' }, { op: 'replace', path: '/verification/checks/2/status', value: 'skipped' }],
      expected: { ok: false, issues: [issue('/verification/checks', 'semantic.claim_level_unsupported'), issue('/verification/status', 'semantic.claim_level_unsupported')] },
    },
    {
      name: 'accepted-by-an-agent', base: F,
      patch: [{ op: 'replace', path: '/outcome/claim_level', value: 'accepted' }, { op: 'replace', path: '/outcome/acceptance/actor', value: { type: 'agent', id: 'review-agent' } }],
      expected: { ok: false, issues: [issue('/outcome/acceptance', 'semantic.claim_level_unsupported')] },
    },
    {
      name: 'accepted-by-the-actor-itself', base: F,
      patch: [{ op: 'replace', path: '/outcome/claim_level', value: 'accepted' }, { op: 'replace', path: '/actor', value: { type: 'human', id: 'service-owner' } }],
      expected: { ok: false, issues: [issue('/outcome/acceptance/actor', 'semantic.self_acceptance')] },
    },
    {
      name: 'outcome-observed-without-observation', base: F,
      patch: [{ op: 'remove', path: '/outcome/metrics/0/observed_at' }, { op: 'replace', path: '/outcome/expected_results/0/status', value: 'unknown' }],
      expected: { ok: false, issues: [issue('/outcome/metrics', 'semantic.claim_level_unsupported')] },
    },
    {
      name: 'claim-needs-every-lower-level', base: F,
      patch: [{ op: 'remove', path: '/outcome/effects' }],
      expected: { ok: false, issues: [issue('/outcome/effects', 'semantic.claim_level_unsupported')] },
    },
    { name: 'unknown-claim-level', base: F, patch: [{ op: 'replace', path: '/outcome/claim_level', value: 'verified' }], expected: { ok: false, issues: [issue('/outcome/claim_level', 'schema.enum')] } },
    { name: 'unknown-coverage', base: F, patch: [{ op: 'replace', path: '/actions/0/coverage', value: 'partial' }], expected: { ok: false, issues: [issue('/actions/0/coverage', 'schema.enum')] } },
    { name: 'check-verifier-without-evidence-source', base: F, patch: [{ op: 'remove', path: '/verification/checks/0/verifier/evidence_source' }], expected: { ok: false, issues: [issue('/verification/checks/0/verifier/evidence_source', 'schema.required')] } },
    { name: 'trace-root-not-lowercase-hex', base: F, patch: [{ op: 'replace', path: '/lineage/trace_commitments/0/root', value: 'AB'.repeat(32) }], expected: { ok: false, issues: [issue('/lineage/trace_commitments/0/root', 'schema.pattern')] } },
    { name: 'trace-algorithm-not-sha256', base: F, patch: [{ op: 'replace', path: '/lineage/trace_commitments/0/algorithm', value: 'sha-512' }], expected: { ok: false, issues: [issue('/lineage/trace_commitments/0/algorithm', 'schema.const')] } },
    {
      name: 'duplicate-trace-commitment', base: F,
      patch: [{ op: 'add', path: '/lineage/trace_commitments/-', value: { trace_id: '4bf92f3577b34da6a3ce929d0e0e4736', algorithm: 'sha256', root: '0'.repeat(64) } }],
      expected: { ok: false, issues: [issue('/lineage/trace_commitments/1/trace_id', 'semantic.duplicate_trace_commitment')] },
    },
    {
      name: 'effect-references-unknown-action-and-evidence', base: F,
      patch: [{ op: 'replace', path: '/outcome/effects/1/action_ids/0', value: 'ghost-action' }, { op: 'add', path: '/outcome/effects/1/evidence_ids/-', value: 'ghost-evidence' }],
      expected: { ok: false, issues: [issue('/outcome/effects/1/action_ids/0', 'semantic.unknown_action_id'), issue('/outcome/effects/1/evidence_ids/1', 'semantic.unknown_evidence_id')] },
    },
    { name: 'duplicate-effect-id', base: F, patch: [{ op: 'replace', path: '/outcome/effects/1/id', value: 'pr-opened' }], expected: { ok: false, issues: [issue('/outcome/effects/1/id', 'semantic.duplicate_id')] } },
    { name: 'v0.3-fields-rejected-in-v0.2', base: F, patch: [{ op: 'replace', path: '/schema_version', value: 'agent-work-receipt/v0.2' }], expected: { ok: false, issues: [issue('/intent/consequential', 'schema.additional_property')] } },
  ],
  signature_vectors: {
    base: F,
    profile: 'agent-work-receipt-signature/v0.1',
    public_key: { encoding: 'base64url', value: publicKey },
    wrong_public_key: { encoding: 'base64url', value: wrongPublicKey },
    jwks: { keys: [{ kty: 'OKP', crv: 'Ed25519', kid: 'rfc8032-test-key-1', x: publicKey }, { kty: 'OKP', crv: 'Ed25519', kid: 'rfc8032-test-key-2', x: wrongPublicKey }] },
    payload_canonical_json: payload,
    signature_base64url: signature,
    cases: [
      { name: 'signed-receipt-verifies', key_source: 'public_key', patch: [], expected_content_state: 'verified', expected_cryptographic_state: 'verified' },
      { name: 'jwks-resolves-by-key-id', key_source: 'jwks', patch: [], expected_content_state: 'verified', expected_cryptographic_state: 'verified' },
      { name: 'no-key-available', key_source: 'none', patch: [], expected_content_state: 'verified', expected_cryptographic_state: 'not_checked' },
      { name: 'wrong-public-key', key_source: 'wrong_public_key', patch: [], expected_content_state: 'verified', expected_cryptographic_state: 'invalid' },
      { name: 'signature-byte-flipped', key_source: 'public_key', patch: [{ op: 'replace', path: '/integrity/signatures/0/value', value: flippedSignature }], expected_content_state: 'verified', expected_cryptographic_state: 'invalid' },
      { name: 'key-id-not-in-jwks', key_source: 'jwks', patch: [{ op: 'replace', path: '/integrity/signatures/0/key_id', value: 'unknown-key' }], expected_content_state: 'verified', expected_cryptographic_state: 'not_checked' },
      { name: 'content-changed-after-signing', key_source: 'public_key', patch: [{ op: 'replace', path: '/outcome/metrics/0/value', value: 0.01 }], expected_content_state: 'mismatch', expected_cryptographic_state: 'verified', expected_computed_sha256_hex: tamperedHash },
      { name: 'content-changed-and-rehashed', key_source: 'public_key', patch: [{ op: 'replace', path: '/outcome/metrics/0/value', value: 0.01 }, { op: 'replace', path: '/integrity/content_hash/value', value: tamperedHash }], expected_content_state: 'verified', expected_cryptographic_state: 'invalid' },
      { name: 'signed-at-changed', key_source: 'public_key', patch: [{ op: 'replace', path: '/integrity/signatures/0/signed_at', value: '2026-10-01T10:30:07Z' }], expected_content_state: 'verified', expected_cryptographic_state: 'invalid' },
    ],
  },
  trace_commitment_vectors: [
    { name: 'empty-trace', spans: [], expected_root: traceRoot([]), leaf_count: 0 },
    { name: 'single-span', spans: [fixtureSpans[0]], expected_root: traceRoot([fixtureSpans[0]]), leaf_count: 1 },
    { name: 'fixture-trace', spans: fixtureSpans, expected_root: traceRoot(fixtureSpans), leaf_count: 3 },
    { name: 'fixture-trace-reordered', spans: [fixtureSpans[2], fixtureSpans[0], fixtureSpans[1]], expected_root: traceRoot(fixtureSpans), leaf_count: 3 },
    { name: 'span-attribute-changed', spans: [fixtureSpans[0], { ...fixtureSpans[1], attributes: { 'file.path': 'services/reporting/other.yaml' } }, fixtureSpans[2]], expected_root: traceRoot([fixtureSpans[0], { ...fixtureSpans[1], attributes: { 'file.path': 'services/reporting/other.yaml' } }, fixtureSpans[2]]), leaf_count: 3, differs_from: 'fixture-trace' },
  ],
};
fs.writeFileSync(vectorsUrl, JSON.stringify(vectors, null, 2) + '\n');
console.log('wrote fixtures/release-check.v0.3.json and conformance/agent-work-receipt-v0.3-vectors.json');
