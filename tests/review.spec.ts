import { describe, expect, it } from 'vitest';

import hatchReview from '../fixtures/hatch-2216-review.v0.2.json';
import trailV02 from '../fixtures/trail-v0.2.json';
import {
  ORGX_REVIEW_EXTENSION_KEY,
  getOrgxReviewExtension,
  validateAgentWorkReceipt,
  validateOrgxReviewExtension,
  type AgentWorkReceipt,
} from '../src';

/** A mutable copy typed as the receipt it is, so the tests mutate real fields; `ext()` reaches the extension as a loose object. */
type Row = Record<string, unknown>;
type LooseReview = {
  criteria: (Row & { lenses: Record<string, Row>; source_refs: Row[] })[];
  episodes: Row[];
} & Row;
type MutableReceipt = Omit<AgentWorkReceipt, 'schema_version' | 'outcome' | 'verification' | 'extensions'> & {
  schema_version: string;
  outcome: Row & { criteria_results: Row[]; expected_results?: Row[] };
  verification: Row & { checks: Row[] };
  extensions: Record<string, unknown>;
};
const clone = (value: unknown): MutableReceipt => JSON.parse(JSON.stringify(value)) as MutableReceipt;
const ext = (r: MutableReceipt): LooseReview => r.extensions[ORGX_REVIEW_EXTENSION_KEY] as LooseReview;
const reviewCodes = (value: unknown) => {
  const r = validateOrgxReviewExtension(value as AgentWorkReceipt);
  return r.ok ? [] : r.issues.map((i) => `${i.code} ${i.path}`);
};
const EXT = '/extensions/org.orgx.review~1v1';

describe('org.orgx.review/v1 extension', () => {
  it('rides inside a valid v0.2 receipt without changing the core', () => {
    const core = validateAgentWorkReceipt(hatchReview);
    expect(core.ok).toBe(true);
    expect(reviewCodes(hatchReview)).toEqual([]);
    const review = getOrgxReviewExtension(hatchReview as unknown as AgentWorkReceipt)!;
    expect(review.version).toBe(ORGX_REVIEW_EXTENSION_KEY);
    expect(review.criteria.map((c) => c.criterion_id)).toEqual(['g1', 'g2', 'g3', 'g4', 'g5']);
    expect(review.episodes.length).toBeGreaterThan(5);
    expect(review.episodes.every((e) => /^ep-[0-9a-f]{12}$/.test(e.id))).toBe(true);
  });

  it('is absent, not invalid, on a receipt that never carried it', () => {
    expect(getOrgxReviewExtension(trailV02 as unknown as AgentWorkReceipt)).toBeNull();
    expect(reviewCodes(trailV02)).toEqual([`review.missing ${EXT}`]);
  });

  it('refuses unknown properties and bad enums at the schema stage', () => {
    const r = clone(hatchReview);
    (ext(r).criteria[0].lenses.judged as { status: string }).status = 'maybe';
    ext(r).bogus = 1;
    const codes = reviewCodes(r);
    expect(codes).toContain(`schema.enum ${EXT}/criteria/0/lenses/judged/status`);
    expect(codes).toContain(`schema.additional_property ${EXT}/bogus`);
  });

  it('ties every reference back to the receipt it sits in', () => {
    const r = clone(hatchReview);
    const x = ext(r);
    x.criteria[0].criterion_id = 'g9';
    x.criteria[1].source_refs[0].source_id = 'ghost';
    x.criteria[2].lenses.measured.evidence_ids = ['no-such-evidence'];
    x.episodes[0].criterion_ids = ['g8'];
    x.episodes[1].trajectory_id = 'd-nope';
    expect(reviewCodes(r)).toEqual(
      expect.arrayContaining([
        `review.unknown_criterion_id ${EXT}/criteria/0/criterion_id`,
        `review.unknown_source_id ${EXT}/criteria/1/source_refs/0/source_id`,
        `review.unknown_evidence_id ${EXT}/criteria/2/lenses/measured/evidence_ids/0`,
        `review.unknown_criterion_id ${EXT}/episodes/0/criterion_ids/0`,
        `review.unknown_trajectory_id ${EXT}/episodes/1/trajectory_id`,
      ])
    );
  });

  it('makes an off-source verdict show its quote', () => {
    const r = clone(hatchReview);
    const c = ext(r).criteria[0];
    c.source_check = 'wrong';
    c.source_refs = [{ source_id: 'plan', at: '§1' }];
    expect(reviewCodes(r)).toEqual([`review.wrong_without_quote ${EXT}/criteria/0/source_check`]);
    c.source_refs[0].quote = 'The plan says the opposite.';
    expect(reviewCodes(r)).toEqual([]);
  });

  it('keeps episode ids unique and commits carrying their sha', () => {
    const r = clone(hatchReview);
    const x = ext(r);
    x.episodes[1].id = x.episodes[0].id;
    x.episodes.push({ id: 'ep-commit000001', kind: 'commit', at: '2026-10-07T23:30:00.000Z', title: 'Saved the fix' });
    expect(reviewCodes(r)).toEqual(
      expect.arrayContaining([
        `review.duplicate_id ${EXT}/episodes/1/id`,
        `review.commit_without_sha ${EXT}/episodes/${x.episodes.length - 1}/commit`,
      ])
    );
  });
});
