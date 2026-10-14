import { describe, expect, it } from 'vitest';

import vectors from '../conformance/agent-work-receipt-v0.3-vectors.json';
import missingAuthority from '../fixtures/invalid-missing-authority.json';
import releaseCheck from '../fixtures/release-check.v0.3.json';
import { AWR_VERIFY_EXIT, runAwrVerify } from '../src/cli';
import { applyPatch } from './patch';

const sv = vectors.signature_vectors;
const PEM = `-----BEGIN PUBLIC KEY-----\n${Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(sv.public_key.value, 'base64url')]).toString('base64')}\n-----END PUBLIC KEY-----\n`;

async function run(argv: string[], files: Record<string, string> = {}, stdin = '') {
  let stdout = '';
  let stderr = '';
  const code = await runAwrVerify(argv, {
    readFile: (path) => {
      if (!(path in files)) throw new Error(`ENOENT: ${path}`);
      return files[path];
    },
    readStdin: () => stdin,
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
  });
  return { code, stdout, stderr };
}

const signed = JSON.stringify(releaseCheck);
const files = {
  'r.json': signed,
  'jwks.json': JSON.stringify(sv.jwks),
  'key.pem': PEM,
  'key.jwk': JSON.stringify(sv.jwks.keys[0]),
  'key.txt': `${sv.public_key.value}\n`,
};

describe('awr-verify', () => {
  it('verifies a signed v0.3 receipt with --key and prints all three results', async () => {
    const { code, stdout } = await run(['r.json', '--key', sv.public_key.value], files);
    expect(code).toBe(AWR_VERIFY_EXIT.ok);
    expect(stdout).toContain('validation: ok (agent-work-receipt/v0.3)');
    expect(stdout).toContain('claim level: outcome_observed; highest supported: outcome_observed');
    expect(stdout).toContain(`content hash: verified (computed sha-256 hex ${releaseCheck.integrity.content_hash.value})`);
    expect(stdout).toContain('signature 0 [rfc8032-test-key-1]: verified');
    expect(stdout).toContain('signer trust: not evaluated');
  });

  it.each([['key.pem'], ['key.jwk'], ['key.txt']])('reads --key from %s', async (file) => {
    expect((await run(['r.json', '--key', file], files)).code).toBe(AWR_VERIFY_EXIT.ok);
  });

  it('resolves --keys by key id and emits JSON', async () => {
    const { code, stdout } = await run(['r.json', '--keys', 'jwks.json', '--json', '--strict'], files);
    expect(code).toBe(0);
    const result = JSON.parse(stdout);
    expect(result).toMatchObject({
      validation: { ok: true, schema_version: 'agent-work-receipt/v0.3', claim_level: 'outcome_observed' },
      integrity: { content_hash: { state: 'verified' }, signatures: [{ cryptographic_state: 'verified' }] },
      exit_code: 0,
    });
  });

  it('reads the receipt from stdin', async () => {
    expect((await run(['-', '--key', sv.public_key.value], files, signed)).code).toBe(0);
  });

  it('exits 2 for a wrong key, a tampered signature, or tampered content', async () => {
    expect((await run(['r.json', '--key', sv.wrong_public_key.value], files)).code).toBe(AWR_VERIFY_EXIT.integrity_failure);
    for (const name of ['signature-byte-flipped', 'content-changed-after-signing']) {
      const patch = sv.cases.find((c) => c.name === name)!.patch;
      const { code, stdout } = await run(['t.json', '--key', sv.public_key.value], { 't.json': JSON.stringify(applyPatch(releaseCheck, patch)) });
      expect([name, code]).toEqual([name, AWR_VERIFY_EXIT.integrity_failure]);
      expect(stdout).toMatch(/content hash: mismatch|signature 0 \[rfc8032-test-key-1\]: invalid/);
    }
  });

  it('exits 0 without a key but 3 under --strict, naming the unresolved key id', async () => {
    const lax = await run(['r.json'], files);
    expect(lax.code).toBe(0);
    expect(lax.stdout).toContain('not_checked (no key for this key_id)');
    expect((await run(['r.json', '--strict'], files)).code).toBe(AWR_VERIFY_EXIT.strict_unmet);
    const unsigned = { ...releaseCheck } as Record<string, unknown>;
    delete unsigned.integrity;
    expect((await run(['u.json', '--strict', '--key', sv.public_key.value], { 'u.json': JSON.stringify(unsigned) })).code).toBe(3);
  });

  it('exits 1 for an invalid receipt, a claim-level violation, bad JSON, or duplicate members', async () => {
    const invalid = await run(['m.json'], { 'm.json': JSON.stringify(missingAuthority) });
    expect(invalid.code).toBe(AWR_VERIFY_EXIT.invalid);
    expect(invalid.stdout).toContain('/authority [schema.required]');

    const selfChecked = applyPatch(releaseCheck, vectors.validation_vectors.find((v) => v.name === 'checked-by-the-actor-itself')!.patch);
    const claim = await run(['c.json', '--key', sv.public_key.value], { 'c.json': JSON.stringify(selfChecked) });
    expect(claim.code).toBe(1);
    expect(claim.stdout).toContain('[semantic.self_verification]');
    // Integrity is still reported for an invalid receipt.
    expect(claim.stdout).toContain('content hash: mismatch');

    expect((await run(['b.json'], { 'b.json': '{' })).code).toBe(1);
    expect((await run(['d.json'], { 'd.json': '{"a":1,"a":2}' })).code).toBe(1);
    expect((await run(['missing.json'], {})).code).toBe(1);
  });

  it('exits 64 for usage errors and prints help', async () => {
    expect((await run([], files)).code).toBe(AWR_VERIFY_EXIT.usage);
    expect((await run(['r.json', '--key', 'k', '--keys', 'jwks.json'], files)).code).toBe(64);
    expect((await run(['r.json', '--key'], files)).code).toBe(64);
    expect((await run(['r.json', '--key', 'nope.pem'], files)).code).toBe(64);
    expect((await run(['r.json', '--frobnicate'], files)).code).toBe(64);
    expect((await run(['r.json', 'second.json'], files)).code).toBe(64);
    const help = await run(['--help']);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('Exit codes');
  });
});
