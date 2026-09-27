import { describe, expect, it } from 'vitest';

import claudeCodeReceipt from '../fixtures/claude-code.json';
import trailV02 from '../fixtures/trail-v0.2.json';
import { agentWorkReceiptSchemaV02, validateAgentWorkReceipt } from '../src';

const clone = (value: unknown): any => JSON.parse(JSON.stringify(value));
const codes = (value: unknown) => {
  const r = validateAgentWorkReceipt(value);
  return r.ok ? [] : r.issues.map((i) => `${i.code} ${i.path}`);
};

describe('Agent Work Receipt v0.2', () => {
  it('accepts the trail v0.2 fixture and keeps v0.1 unchanged', () => {
    expect(codes(trailV02)).toEqual([]);
    expect(codes(claudeCodeReceipt)).toEqual([]);
    expect((agentWorkReceiptSchemaV02 as { $id: string }).$id).toMatch(/v0\.2/);
  });

  it('keeps v0.2 fields out of v0.1 receipts', () => {
    const r = clone(trailV02); r.schema_version = 'agent-work-receipt/v0.1';
    expect(codes(r)).toEqual(['schema.additional_property /provenance']);
  });

  it('requires results and checks to name declared criteria', () => {
    const r = clone(trailV02);
    r.outcome.criteria_results[0].criterion_id = 'nope';
    r.verification.checks[0].criterion_ids = ['ghost'];
    expect(codes(r)).toEqual(expect.arrayContaining(['semantic.unknown_criterion_id /outcome/criteria_results/0/criterion_id', 'semantic.unknown_criterion_id /verification/checks/0/criterion_ids/0']));
  });

  it('rejects a met criterion with neither evidence nor a deciding person', () => {
    const r = clone(trailV02); r.outcome.criteria_results[0].evidence_ids = [];
    expect(codes(r)).toContain('semantic.criterion_result_without_basis /outcome/criteria_results/0/evidence_ids');
    r.outcome.criteria_results[0].decided_by = { type: 'human', id: 'reviewer-1' };
    expect(codes(r)).toEqual([]);
  });

  it('does not let a succeeded outcome hide an unmet required criterion', () => {
    const r = clone(trailV02); r.outcome.criteria_results[0].status = 'unmet';
    expect(codes(r)).toContain('semantic.succeeded_with_unmet_criterion /outcome/status');
    r.outcome.status = 'partially_succeeded';
    expect(codes(r)).toEqual([]);
    const optional = clone(trailV02); optional.outcome.criteria_results[2] = { criterion_id: 'c3', status: 'unmet', evidence_ids: ['configuration-test'] };
    expect(codes(optional)).toEqual([]); // c3 is not required
  });

  it('checks provenance pointers, trajectory references, ranges and confidences', () => {
    const r = clone(trailV02);
    r.provenance[0].path = '/intent/criteria/9';
    r.trajectory[0].action_ids = ['missing-action'];
    r.intent.expected_outcomes[0].min = 200;
    expect(codes(r)).toEqual(expect.arrayContaining(['semantic.unresolved_provenance_path /provenance/0/path', 'semantic.unknown_action_id /trajectory/0/action_ids/0', 'semantic.expected_range_order /intent/expected_outcomes/0/max']));
    const c = clone(trailV02); c.outcome.criteria_results[0].confidence = 1.5;
    expect(codes(c)[0]).toMatch(/^schema\./);
  });
});
