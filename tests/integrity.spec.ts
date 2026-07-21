import Ajv2020 from 'ajv/dist/2020';
import {
  createHash,
  createPublicKey,
  verify as verifyEd25519,
} from 'node:crypto';
import { describe, expect, it } from 'vitest';

import integrityReportSchema from '../conformance/agent-work-receipt-integrity-report.v0.1.schema.json';
import integrityVectors from '../conformance/agent-work-receipt-integrity-vectors.v0.1.json';
import claudeCodeReceipt from '../fixtures/claude-code.json';
import codexReceipt from '../fixtures/codex.json';
import {
  AgentWorkReceiptDuplicateMemberError,
  assertAgentWorkReceiptJsonHasUniqueMembers,
  canonicalizeAgentWorkJson,
  canonicalizeAgentWorkReceiptSignaturePayload,
  hashAgentWorkReceiptContent,
  parseAgentWorkReceiptJson,
  validateAgentWorkReceipt,
  verifyAgentWorkReceiptIntegrity,
  withAgentWorkReceiptContentHash,
  type AgentWorkReceipt,
  type AgentWorkSignatureVerificationInput,
} from '../src';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function replaceAtPointer(
  target: Record<string, any>,
  pointer: string,
  value: unknown
) {
  const segments = pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
  const leaf = segments.pop()!;
  const parent = segments.reduce(
    (current: Record<string, any>, segment) => current[segment],
    target
  );
  parent[leaf] = value;
}

function signatureVerifier(
  publicKeyBase64url = integrityVectors.signature_vector.public_key.value
) {
  const rawKey = Buffer.from(publicKeyBase64url, 'base64url');
  const publicKey = createPublicKey({
    key: Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      rawKey,
    ]),
    format: 'der',
    type: 'spki',
  });
  return (input: AgentWorkSignatureVerificationInput) =>
    verifyEd25519(
      null,
      input.signature_payload,
      publicKey,
      input.signature_bytes
    )
      ? ('verified' as const)
      : ('invalid' as const);
}

describe('Agent Work Receipt v0.1 integrity', () => {
  it.each(integrityVectors.canonicalization_vectors)(
    'matches the language-neutral $name vector',
    ({ input, canonical_json: expected, sha256_hex: expectedHash }) => {
      const canonical = canonicalizeAgentWorkJson(input);
      expect(canonical).toBe(expected);
      expect(createHash('sha256').update(canonical).digest('hex')).toBe(
        expectedHash
      );
    }
  );

  it.each(integrityVectors.number_serialization_vectors)(
    'matches RFC 8785 Appendix B number $ieee754',
    ({ input, canonical_json: expected }) => {
      expect(canonicalizeAgentWorkJson(input)).toBe(expected);
    }
  );

  it.each(integrityVectors.canonical_equivalence_vectors)(
    'canonicalizes equivalent $name values identically',
    ({ left, right, canonical_json: expected }) => {
      expect(canonicalizeAgentWorkJson(left)).toBe(expected);
      expect(canonicalizeAgentWorkJson(right)).toBe(expected);
    }
  );

  it.each(integrityVectors.canonical_difference_vectors)(
    'preserves the significant distinction in $name',
    ({ left, right }) => {
      expect(canonicalizeAgentWorkJson(left)).not.toBe(
        canonicalizeAgentWorkJson(right)
      );
    }
  );

  it.each(integrityVectors.raw_json_negative_vectors)(
    'rejects the raw JSON boundary vector $name',
    ({ raw_json: rawJson, member, path }) => {
      try {
        assertAgentWorkReceiptJsonHasUniqueMembers(rawJson);
        throw new Error('Expected duplicate JSON member rejection.');
      } catch (error) {
        expect(error).toBeInstanceOf(AgentWorkReceiptDuplicateMemberError);
        expect(error).toMatchObject({ member, path });
      }
    }
  );

  it('parses a receipt from raw JSON only after duplicate-name admission', () => {
    expect(
      parseAgentWorkReceiptJson(JSON.stringify(codexReceipt)).receipt_id
    ).toBe(codexReceipt.receipt_id);
  });

  it('computes the published receipt digest in every portable encoding', async () => {
    const receipt = codexReceipt as AgentWorkReceipt;

    await expect(hashAgentWorkReceiptContent(receipt, 'hex')).resolves.toEqual({
      algorithm: 'sha-256',
      encoding: 'hex',
      value: integrityVectors.receipt_vector.sha256.hex,
    });
    await expect(
      hashAgentWorkReceiptContent(receipt, 'base64')
    ).resolves.toEqual({
      algorithm: 'sha-256',
      encoding: 'base64',
      value: integrityVectors.receipt_vector.sha256.base64,
    });
    await expect(
      hashAgentWorkReceiptContent(receipt, 'base64url')
    ).resolves.toEqual({
      algorithm: 'sha-256',
      encoding: 'base64url',
      value: integrityVectors.receipt_vector.sha256.base64url,
    });
    await expect(
      verifyAgentWorkReceiptIntegrity(receipt)
    ).resolves.toMatchObject({
      content_hash: { state: 'verified' },
      signatures: [],
    });
  });

  it.each(integrityVectors.receipt_vector.tamper_vectors)(
    'detects the $name tamper vector',
    async (vector) => {
      const receipt = clone(codexReceipt) as AgentWorkReceipt;
      replaceAtPointer(
        receipt as Record<string, any>,
        vector.json_pointer,
        vector.value
      );

      const digest = await hashAgentWorkReceiptContent(receipt);
      const report = await verifyAgentWorkReceiptIntegrity(receipt);
      expect(digest.value).toBe(vector.expected_sha256_hex);
      expect(report.content_hash.state).toBe(vector.expected_content_state);
    }
  );

  it('omits only root integrity and preserves key and array semantics', async () => {
    const original = clone(codexReceipt) as AgentWorkReceipt;
    const originalHash = await hashAgentWorkReceiptContent(original);
    const withoutIntegrity = clone(original) as any;
    delete withoutIntegrity.integrity;
    await expect(
      hashAgentWorkReceiptContent(withoutIntegrity)
    ).resolves.toEqual(originalHash);

    const changedSignature = clone(original) as any;
    changedSignature.integrity.signatures = [
      {
        algorithm: 'ed25519',
        encoding: 'base64url',
        key_id: 'ignored-at-content-scope',
        value: 'A'.repeat(86),
      },
    ];
    await expect(
      hashAgentWorkReceiptContent(changedSignature)
    ).resolves.toEqual(originalHash);

    const nestedIntegrity = clone(original) as any;
    nestedIntegrity.extensions = { integrity: { state: 'nested-and-covered' } };
    await expect(
      hashAgentWorkReceiptContent(nestedIntegrity)
    ).resolves.not.toEqual(originalHash);

    const reordered = Object.fromEntries(
      Object.entries(clone(original)).reverse()
    ) as unknown as AgentWorkReceipt;
    await expect(hashAgentWorkReceiptContent(reordered)).resolves.toEqual(
      originalHash
    );

    const reorderedActions = clone(original) as any;
    reorderedActions.actions.reverse();
    await expect(
      hashAgentWorkReceiptContent(reorderedActions)
    ).resolves.not.toEqual(originalHash);
  });

  it('verifies the deterministic Ed25519 signature wire vector', async () => {
    const receipt = claudeCodeReceipt as AgentWorkReceipt;
    const signature = receipt.integrity!.signatures![0];
    const payload = canonicalizeAgentWorkReceiptSignaturePayload(
      signature,
      receipt.integrity!.content_hash
    );
    expect(payload).toBe(
      integrityVectors.signature_vector.payload_canonical_json
    );
    expect(signature.value).toBe(
      integrityVectors.signature_vector.signature_base64url
    );

    const report = await verifyAgentWorkReceiptIntegrity(receipt, {
      verify_signature: signatureVerifier(),
      evaluate_signer_trust: () => 'trusted',
    });
    expect(report.content_hash.state).toBe('verified');
    expect(report.signatures).toEqual([
      {
        index: 0,
        profile: integrityVectors.signature_vector.profile,
        algorithm: 'ed25519',
        encoding: 'base64url',
        key_id: 'rfc8032-test-key-1',
        cryptographic_state: 'verified',
        trust_state: 'trusted',
      },
    ]);

    const validateReport = new Ajv2020({ strict: true }).compile(
      integrityReportSchema
    );
    expect(validateReport(JSON.parse(JSON.stringify(report)))).toBe(true);

    const wrongKeyReport = await verifyAgentWorkReceiptIntegrity(receipt, {
      verify_signature: signatureVerifier(
        integrityVectors.signature_vector.wrong_public_key.value
      ),
    });
    expect(wrongKeyReport.signatures[0].cryptographic_state).toBe(
      integrityVectors.signature_vector.wrong_public_key
        .expected_cryptographic_state
    );
  });

  it.each(integrityVectors.signature_vector.tamper_vectors)(
    'detects signed-envelope tamper $name',
    async (vector) => {
      const receipt = clone(claudeCodeReceipt) as AgentWorkReceipt;
      replaceAtPointer(
        receipt as Record<string, any>,
        vector.json_pointer,
        vector.value
      );
      const report = await verifyAgentWorkReceiptIntegrity(receipt, {
        verify_signature: signatureVerifier(),
      });
      expect(report.content_hash.state).toBe(vector.expected_content_state);
      expect(report.signatures[0].cryptographic_state).toBe(
        vector.expected_cryptographic_state
      );
    }
  );

  it('rejects integrity reports that cannot be emitted by the runtime', async () => {
    const validateReport = new Ajv2020({ strict: true }).compile(
      integrityReportSchema
    );
    const report = await verifyAgentWorkReceiptIntegrity(
      codexReceipt as AgentWorkReceipt
    );

    const invalidAlgorithm = clone(report) as any;
    invalidAlgorithm.content_hash.computed.algorithm = 'md5';
    invalidAlgorithm.content_hash.computed.value = 'x';
    expect(validateReport(invalidAlgorithm)).toBe(false);

    const missingEncoding = clone(report) as any;
    delete missingEncoding.content_hash.computed.encoding;
    expect(validateReport(missingEncoding)).toBe(false);

    const missingDeclared = clone(report) as any;
    delete missingDeclared.content_hash.declared;
    expect(validateReport(missingDeclared)).toBe(false);

    const impossibleNotPresent = clone(report) as any;
    impossibleNotPresent.content_hash.state = 'not_present';
    expect(validateReport(impossibleNotPresent)).toBe(false);

    const absentReceipt = clone(codexReceipt) as any;
    delete absentReceipt.integrity;
    const absentReport = await verifyAgentWorkReceiptIntegrity(absentReceipt);
    expect(validateReport(absentReport)).toBe(true);
  });

  it('keeps cryptographic verification and signer trust independent', async () => {
    const report = await verifyAgentWorkReceiptIntegrity(
      claudeCodeReceipt as AgentWorkReceipt,
      {
        verify_signature: () => 'invalid',
        evaluate_signer_trust: () => 'trusted',
      }
    );

    expect(report.content_hash.state).toBe('verified');
    expect(report.signatures[0]).toMatchObject({
      cryptographic_state: 'invalid',
      trust_state: 'trusted',
    });
  });

  it('requires content_hash whenever integrity or signatures are present', () => {
    const invalid = clone(claudeCodeReceipt) as any;
    delete invalid.integrity.content_hash;
    const result = validateAgentWorkReceipt(invalid);
    expect(result).toMatchObject({
      ok: false,
      issues: [{ path: '/integrity/content_hash', code: 'schema.required' }],
    });
  });

  it('rejects malformed content digest syntax during contract validation', () => {
    const malformedHex = clone(claudeCodeReceipt) as any;
    malformedHex.integrity.content_hash.value = 'not-a-hash';
    const malformedHexResult = validateAgentWorkReceipt(malformedHex);
    expect(malformedHexResult.ok).toBe(false);
    if (!malformedHexResult.ok) {
      expect(malformedHexResult.issues).toContainEqual(
        expect.objectContaining({ path: '/integrity/content_hash/value' })
      );
    }

    const malformedBase64 = clone(codexReceipt) as any;
    malformedBase64.integrity.content_hash = {
      algorithm: 'sha-256',
      encoding: 'base64',
      value: `${integrityVectors.receipt_vector.sha256.base64.slice(0, -2)}V=`,
    };
    const malformedBase64Result = validateAgentWorkReceipt(malformedBase64);
    expect(malformedBase64Result.ok).toBe(false);
    if (!malformedBase64Result.ok) {
      expect(malformedBase64Result.issues).toContainEqual(
        expect.objectContaining({ path: '/integrity/content_hash/value' })
      );
    }
  });

  it('rejects unknown output encodings at the public SDK boundary', async () => {
    await expect(
      hashAgentWorkReceiptContent(
        codexReceipt as AgentWorkReceipt,
        'rot13' as any
      )
    ).rejects.toThrow('Digest encoding must be hex, base64, or base64url');
    await expect(
      withAgentWorkReceiptContentHash(
        codexReceipt as AgentWorkReceipt,
        'rot13' as any
      )
    ).rejects.toThrow('Digest encoding must be hex, base64, or base64url');
  });

  it('uses an explicit digest algorithm allowlist and canonical encodings', async () => {
    const allowedAlias = clone(claudeCodeReceipt) as any;
    allowedAlias.integrity.content_hash.algorithm = 'sha256';
    allowedAlias.integrity.content_hash.value =
      allowedAlias.integrity.content_hash.value.toUpperCase();
    await expect(
      verifyAgentWorkReceiptIntegrity(allowedAlias, {
        verify_signature: signatureVerifier(),
      })
    ).resolves.toMatchObject({
      content_hash: { state: 'verified' },
      signatures: [{ cryptographic_state: 'verified' }],
    });

    const unsupported = clone(codexReceipt) as any;
    unsupported.integrity.content_hash.algorithm = 's-h-a-2-5-6';
    await expect(
      verifyAgentWorkReceiptIntegrity(unsupported)
    ).resolves.toMatchObject({ content_hash: { state: 'unsupported' } });

    const nonCanonicalBase64 = clone(codexReceipt) as any;
    nonCanonicalBase64.integrity.content_hash = {
      algorithm: 'sha-256',
      encoding: 'base64',
      value: `${integrityVectors.receipt_vector.sha256.base64.slice(0, -2)}V=`,
    };
    await expect(
      verifyAgentWorkReceiptIntegrity(nonCanonicalBase64)
    ).resolves.toMatchObject({ content_hash: { state: 'malformed' } });

    const malformedSignature = clone(claudeCodeReceipt) as any;
    malformedSignature.integrity.signatures[0].value = `${'A'.repeat(85)}B`;
    await expect(
      verifyAgentWorkReceiptIntegrity(malformedSignature)
    ).resolves.toMatchObject({
      signatures: [{ cryptographic_state: 'malformed' }],
    });
  });

  it('fails closed for invalid I-JSON and mutable accessor input', async () => {
    const invalidValue = clone(codexReceipt) as any;
    invalidValue.intent.summary = String.fromCharCode(0xd800);
    expect(validateAgentWorkReceipt(invalidValue)).toMatchObject({
      ok: false,
      issues: [{ code: 'input.invalid_unicode' }],
    });
    expect(() => canonicalizeAgentWorkJson(invalidValue)).toThrow(
      'unpaired UTF-16 surrogate'
    );

    const invalidKey = clone(codexReceipt) as any;
    invalidKey.extensions = { [String.fromCharCode(0xd800)]: true };
    expect(validateAgentWorkReceipt(invalidKey)).toMatchObject({
      ok: false,
      issues: [{ code: 'input.invalid_unicode' }],
    });

    expect(() =>
      canonicalizeAgentWorkJson({ value: Number.POSITIVE_INFINITY })
    ).toThrow('non-finite number');

    const accessor = {} as Record<string, unknown>;
    Object.defineProperty(accessor, 'value', {
      enumerable: true,
      get: () => 'changes-between-reads',
    });
    expect(() => canonicalizeAgentWorkJson(accessor)).toThrow('accessor');
  });

  it('hashes once and gives callbacks the exact corresponding content bytes', async () => {
    let callbackChecked = false;
    const report = await verifyAgentWorkReceiptIntegrity(
      claudeCodeReceipt as AgentWorkReceipt,
      {
        verify_signature: (input) => {
          callbackChecked = true;
          expect(
            createHash('sha256').update(input.canonical_content).digest('hex')
          ).toBe(input.computed_content_hash.value);
          return signatureVerifier()(input);
        },
      }
    );
    expect(callbackChecked).toBe(true);
    expect(report.signatures[0].cryptographic_state).toBe('verified');
  });

  it('clears stale signatures on rehash unless preservation is explicit', async () => {
    const receipt = clone(claudeCodeReceipt) as AgentWorkReceipt;
    receipt.outcome.summary = 'Changed after signing';

    const safe = await withAgentWorkReceiptContentHash(receipt);
    expect(safe.integrity?.signatures).toBeUndefined();

    const explicitlyPreserved = await withAgentWorkReceiptContentHash(
      receipt,
      'hex',
      { preserve_signatures: true }
    );
    expect(explicitlyPreserved.integrity?.signatures).toEqual(
      receipt.integrity?.signatures
    );
  });
});
