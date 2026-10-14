import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

import vectors from '../conformance/agent-work-receipt-v0.3-vectors.json';
import claudeCodeReceipt from '../fixtures/claude-code.json';
import codexReceipt from '../fixtures/codex.json';
import hatchReview from '../fixtures/hatch-2216-review.v0.2.json';
import releaseCheck from '../fixtures/release-check.v0.3.json';
import trailV02 from '../fixtures/trail-v0.2.json';
import {
  AGENT_WORK_RECEIPT_CLAIM_LEVELS,
  AGENT_WORK_RECEIPT_SCHEMA_ID_V03,
  agentWorkClaimLevelIssues,
  agentWorkReceiptSchemaV03,
  compareAgentWorkClaimLevels,
  computeAgentWorkTraceCommitmentRoot,
  createAgentWorkTraceCommitment,
  highestSupportedAgentWorkClaimLevel,
  isAgentWorkConsequential,
  validateAgentWorkReceipt,
  verifyAgentWorkTraceCommitment,
  type AgentWorkReceipt,
} from '../src';
import { applyPatch } from './patch';

const bases: Record<string, unknown> = {
  '../fixtures/release-check.v0.3.json': releaseCheck,
  '../fixtures/trail-v0.2.json': trailV02,
  '../fixtures/codex.json': codexReceipt,
};
const clone = (value: unknown): any => JSON.parse(JSON.stringify(value));

describe('Agent Work Receipt v0.3', () => {
  it('publishes a standalone Draft 2020-12 schema with its own $id', () => {
    expect((agentWorkReceiptSchemaV03 as { $id: string }).$id).toBe(AGENT_WORK_RECEIPT_SCHEMA_ID_V03);
    const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true });
    addFormats.default(ajv, ['date-time', 'uri-reference']);
    const validate = ajv.compile(agentWorkReceiptSchemaV03);
    expect(validate(releaseCheck)).toBe(true);
  });

  it('keeps every earlier fixture valid (backward compatible)', () => {
    for (const fixture of [codexReceipt, claudeCodeReceipt, trailV02, hatchReview]) {
      expect(validateAgentWorkReceipt(fixture)).toMatchObject({ ok: true });
    }
  });

  it.each(vectors.validation_vectors)('conformance vector $name', (vector) => {
    const receipt = applyPatch(bases[vector.base], vector.patch);
    const result = validateAgentWorkReceipt(receipt);
    expect(result.ok).toBe(vector.expected.ok);
    if (result.ok) {
      if ('highest_supported_claim_level' in vector.expected) {
        expect(highestSupportedAgentWorkClaimLevel(result.receipt)).toBe(vector.expected.highest_supported_claim_level);
      }
    } else {
      expect(result.issues.map(({ path, code }) => ({ path, code }))).toEqual((vector.expected as { issues: unknown[] }).issues);
    }
  });

  it('orders the claim ladder and treats work as consequential by default', () => {
    expect(AGENT_WORK_RECEIPT_CLAIM_LEVELS).toEqual(['asserted', 'executed', 'observed', 'checked', 'accepted', 'outcome_observed']);
    expect(compareAgentWorkClaimLevels('checked', 'observed')).toBeGreaterThan(0);
    expect(compareAgentWorkClaimLevels('asserted', 'outcome_observed')).toBeLessThan(0);
    const r = clone(releaseCheck);
    delete r.intent.consequential;
    expect(isAgentWorkConsequential(r)).toBe(true);
    r.intent.consequential = false;
    expect(isAgentWorkConsequential(r)).toBe(false);
  });

  it('applies claim rules only to v0.3 receipts and only to what is claimed', () => {
    // A v0.2 receipt has no claim_level field to violate.
    expect(highestSupportedAgentWorkClaimLevel(trailV02 as AgentWorkReceipt)).toBe('executed');
    const r = clone(releaseCheck) as AgentWorkReceipt;
    expect(agentWorkClaimLevelIssues(r, 'outcome_observed')).toEqual([]);
    expect(agentWorkClaimLevelIssues(r, 'asserted')).toEqual([]);
  });

  it('does not let a self-verified check count even beside a failing independent one', () => {
    const r = clone(releaseCheck);
    r.outcome.claim_level = 'checked';
    r.verification.status = 'partial';
    r.verification.checks[0].status = 'failed';
    r.verification.checks[1].status = 'failed';
    const result = validateAgentWorkReceipt(r);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => `${i.code} ${i.path}`)).toEqual(['semantic.self_verification /verification/checks/2/verifier/actor']);
    }
  });

  it('compares identities by type and id, not display name or model', () => {
    const r = clone(releaseCheck);
    r.outcome.claim_level = 'checked';
    r.verification.checks = [r.verification.checks[2]];
    r.verification.checks[0].verifier.actor = { type: 'agent', id: 'claude-code-agent', display_name: 'Another name' };
    expect(validateAgentWorkReceipt(r).ok).toBe(false);
    r.verification.checks[0].verifier.actor = { type: 'service', id: 'claude-code-agent' };
    expect(validateAgentWorkReceipt(r).ok).toBe(true);
  });

  it('requires a verifier for checked when no check or receipt verifier is named', () => {
    const r = clone(releaseCheck);
    r.outcome.claim_level = 'checked';
    r.verification.status = 'unverified';
    delete r.verification.verifier;
    delete r.verification.verified_at;
    for (const check of r.verification.checks) delete check.verifier;
    const result = validateAgentWorkReceipt(r);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((i) => `${i.code} ${i.path}`)).toEqual([
        'semantic.claim_level_unsupported /verification/checks',
        'semantic.claim_level_unsupported /verification/status',
      ]);
    }
  });
});

describe('awr-trace-merkle/v1 trace commitments', () => {
  it.each(vectors.trace_commitment_vectors)('reproduces the $name root', async (vector) => {
    await expect(computeAgentWorkTraceCommitmentRoot(vector.spans)).resolves.toBe(vector.expected_root);
    if ('differs_from' in vector) {
      const other = vectors.trace_commitment_vectors.find((v) => v.name === vector.differs_from)!;
      expect(vector.expected_root).not.toBe(other.expected_root);
    }
  });

  it('matches the empty-tree root of RFC 6962', async () => {
    await expect(computeAgentWorkTraceCommitmentRoot([])).resolves.toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('commits the fixture trace by reference and verifies it', async () => {
    const spans = vectors.trace_commitment_vectors.find((v) => v.name === 'fixture-trace')!.spans;
    const commitment = (releaseCheck as AgentWorkReceipt).lineage.trace_commitments![0];
    await expect(verifyAgentWorkTraceCommitment(commitment, spans)).resolves.toBe(true);
    await expect(verifyAgentWorkTraceCommitment(commitment, spans.slice(1))).resolves.toBe(false);
    await expect(verifyAgentWorkTraceCommitment({ ...commitment, leaf_count: undefined }, [...spans].reverse())).resolves.toBe(true);
    const created = await createAgentWorkTraceCommitment('4bf92f3577b34da6a3ce929d0e0e4736', spans);
    expect(created).toEqual({
      trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
      algorithm: 'sha256',
      construction: 'awr-trace-merkle/v1',
      root: commitment.root,
      leaf_count: 3,
    });
  });
});
