import { createPublicKey } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import v01Vectors from '../conformance/agent-work-receipt-integrity-vectors.v0.1.json';
import vectors from '../conformance/agent-work-receipt-v0.3-vectors.json';
import claudeCodeReceipt from '../fixtures/claude-code.json';
import releaseCheck from '../fixtures/release-check.v0.3.json';
import {
  canonicalizeAgentWorkReceiptSignaturePayload,
  createAgentWorkKeyResolver,
  decodeAgentWorkEd25519PublicKey,
  importAgentWorkEd25519PublicKey,
  verifyAgentWorkEd25519Signature,
  verifyAgentWorkReceiptIntegrity,
  type AgentWorkPublicKeyResolver,
  type AgentWorkReceipt,
} from '../src';
import { applyPatch } from './patch';

const sv = vectors.signature_vectors;
const resolverFor = (source: string): AgentWorkPublicKeyResolver | undefined => {
  switch (source) {
    case 'public_key':
      return () => sv.public_key.value;
    case 'wrong_public_key':
      return () => sv.wrong_public_key.value;
    case 'jwks':
      return createAgentWorkKeyResolver({ keys: sv.jwks });
    default:
      return undefined;
  }
};

describe('built-in Ed25519 signature verification', () => {
  it('reproduces the v0.3 signed payload', () => {
    const receipt = releaseCheck as AgentWorkReceipt;
    const signature = receipt.integrity!.signatures![0];
    expect(canonicalizeAgentWorkReceiptSignaturePayload(signature, receipt.integrity!.content_hash)).toBe(sv.payload_canonical_json);
    expect(signature.value).toBe(sv.signature_base64url);
  });

  it.each(sv.cases)('signature vector $name', async (vector) => {
    const receipt = applyPatch(releaseCheck, vector.patch) as AgentWorkReceipt;
    const resolve = resolverFor(vector.key_source);
    const report = await verifyAgentWorkReceiptIntegrity(receipt, resolve ? { resolve_public_key: resolve } : { resolve_public_key: () => null });
    expect(report.content_hash.state).toBe(vector.expected_content_state);
    expect(report.signatures[0].cryptographic_state).toBe(vector.expected_cryptographic_state);
    expect(report.signatures[0].trust_state).toBe('not_evaluated');
    if ('expected_computed_sha256_hex' in vector) expect(report.content_hash.computed.value).toBe(vector.expected_computed_sha256_hex);
  });

  it('verifies the v0.1 signature vectors without a caller-supplied callback', async () => {
    const resolve = () => v01Vectors.signature_vector.public_key.value;
    const good = await verifyAgentWorkReceiptIntegrity(claudeCodeReceipt as AgentWorkReceipt, { resolve_public_key: resolve });
    expect(good.signatures[0].cryptographic_state).toBe('verified');
    const wrong = await verifyAgentWorkReceiptIntegrity(claudeCodeReceipt as AgentWorkReceipt, {
      resolve_public_key: () => v01Vectors.signature_vector.wrong_public_key.value,
    });
    expect(wrong.signatures[0].cryptographic_state).toBe('invalid');
    for (const vector of v01Vectors.signature_vector.tamper_vectors) {
      const patched = applyPatch(claudeCodeReceipt, [{ op: 'replace', path: vector.json_pointer, value: vector.value }]) as AgentWorkReceipt;
      const report = await verifyAgentWorkReceiptIntegrity(patched, { resolve_public_key: resolve });
      expect([vector.name, report.signatures[0].cryptographic_state]).toEqual([vector.name, vector.expected_cryptographic_state]);
    }
  });

  it('keeps the callback API in charge when both are supplied', async () => {
    const report = await verifyAgentWorkReceiptIntegrity(releaseCheck as AgentWorkReceipt, {
      verify_signature: () => 'invalid',
      resolve_public_key: () => sv.public_key.value,
      evaluate_signer_trust: () => 'trusted',
    });
    expect(report.signatures[0]).toMatchObject({ cryptographic_state: 'invalid', trust_state: 'trusted' });
  });

  it('leaves signatures not_checked without a resolver or callback', async () => {
    const report = await verifyAgentWorkReceiptIntegrity(releaseCheck as AgentWorkReceipt);
    expect(report.signatures[0].cryptographic_state).toBe('not_checked');
  });

  it('reports error for an unusable key or a throwing resolver, never verified', async () => {
    for (const resolve of [() => 'not-a-key', () => new Uint8Array(31), () => { throw new Error('keyring down'); }] as AgentWorkPublicKeyResolver[]) {
      const report = await verifyAgentWorkReceiptIntegrity(releaseCheck as AgentWorkReceipt, { resolve_public_key: resolve });
      expect(report.signatures[0].cryptographic_state).toBe('error');
    }
  });

  it('imports raw bytes, base64url, hex, a JWK, a CryptoKey, and ignores private JWK members', async () => {
    const raw = decodeAgentWorkEd25519PublicKey(sv.public_key.value);
    const hex = Buffer.from(raw).toString('hex');
    const jwk = { kty: 'OKP', crv: 'Ed25519', x: sv.public_key.value, d: 'nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A' } as const;
    const cryptoKey = await importAgentWorkEd25519PublicKey(raw);
    const payload = new TextEncoder().encode(sv.payload_canonical_json);
    const sig = new Uint8Array(Buffer.from(sv.signature_base64url, 'base64url'));
    for (const key of [raw, sv.public_key.value, hex, hex.toUpperCase(), jwk, cryptoKey]) {
      await expect(verifyAgentWorkEd25519Signature(key, payload, sig)).resolves.toBe(true);
    }
    // Same key through node:crypto, as a cross-check of the Web Crypto path.
    const nodeJwk = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: sv.public_key.value }, format: 'jwk' }).export({ format: 'jwk' });
    expect(nodeJwk.x).toBe(sv.public_key.value);
    await expect(verifyAgentWorkEd25519Signature(raw, payload.subarray(1), sig)).resolves.toBe(false);
    await expect(verifyAgentWorkEd25519Signature(raw, payload, sig.subarray(1))).rejects.toThrow('64 bytes');
    expect(() => decodeAgentWorkEd25519PublicKey(`${sv.public_key.value.slice(0, -1)}p`)).toThrow();
    expect(() => decodeAgentWorkEd25519PublicKey('AAAA')).toThrow();
  });

  it('resolves JWKS keys by kid, uses a fallback, and refuses ambiguous kids', async () => {
    const signature = (releaseCheck as AgentWorkReceipt).integrity!.signatures![0];
    const byKid = createAgentWorkKeyResolver({ keys: sv.jwks });
    expect(await byKid({ key_id: 'rfc8032-test-key-1', signature })).toMatchObject({ x: sv.public_key.value });
    expect(await byKid({ key_id: 'missing', signature })).toBeUndefined();
    const withFallback = createAgentWorkKeyResolver({ keys: { other: sv.wrong_public_key.value }, fallback: sv.public_key.value });
    expect(await withFallback({ key_id: 'missing', signature })).toBe(sv.public_key.value);
    const ambiguous = createAgentWorkKeyResolver({ keys: { keys: [...sv.jwks.keys, { ...sv.jwks.keys[1], kid: 'rfc8032-test-key-1' }] } });
    expect(await ambiguous({ key_id: 'rfc8032-test-key-1', signature })).toBeNull();
    const ignoresOtherKeyTypes = createAgentWorkKeyResolver({ keys: { keys: [{ kty: 'EC', crv: 'P-256', kid: 'ec', x: 'a', y: 'b' }] } });
    expect(await ignoresOtherKeyTypes({ key_id: 'ec', signature })).toBeUndefined();
  });
});
