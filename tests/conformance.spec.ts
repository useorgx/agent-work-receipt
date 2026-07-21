import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';

import claudeCodeReceipt from '../fixtures/claude-code.json';
import codexReceipt from '../fixtures/codex.json';
import missingAuthorityReceipt from '../fixtures/invalid-missing-authority.json';
import unresolvedEvidenceReceipt from '../fixtures/invalid-unresolved-evidence.json';
import openClawReceipt from '../fixtures/openclaw.json';
import {
  AGENT_WORK_RECEIPT_SCHEMA_ID,
  AGENT_WORK_RECEIPT_MAX_VALIDATION_ISSUES,
  AGENT_WORK_RECEIPT_SCHEMA_VERSION,
  AgentWorkReceiptValidationError,
  agentWorkReceiptSchema,
  formatAgentWorkReceiptIssues,
  parseAgentWorkReceipt,
  validateAgentWorkReceipt,
  type AgentWorkReceipt,
} from '../src';

const validFixtures = [
  ['Codex', codexReceipt],
  ['Claude Code', claudeCodeReceipt],
  ['OpenClaw', openClawReceipt],
] as const;

function clone(value: unknown): any {
  return JSON.parse(JSON.stringify(value));
}

describe('Agent Work Receipt v0.1 conformance', () => {
  it.each(validFixtures)('accepts the %s fixture', (_runtime, fixture) => {
    const result = validateAgentWorkReceipt(fixture);

    expect(result).toEqual({ ok: true, receipt: fixture });
    expect(parseAgentWorkReceipt(fixture).receipt_id).toBe(fixture.receipt_id);
  });

  it('rejects the canonical missing-authority fixture at the schema boundary', () => {
    expect(validateAgentWorkReceipt(missingAuthorityReceipt)).toEqual({
      ok: false,
      issue_count: 1,
      issues_truncated: false,
      issues: [
        {
          path: '/authority',
          code: 'schema.required',
          message: 'Required value is missing.',
        },
      ],
    });
  });

  it('rejects the canonical unresolved-evidence fixture semantically', () => {
    const result = validateAgentWorkReceipt(unresolvedEvidenceReceipt);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected validation to fail.');
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/verification/evidence_ids/0',
          code: 'semantic.unknown_evidence_id',
        }),
        expect.objectContaining({
          path: '/verification/checks/0/evidence_ids/0',
          code: 'semantic.unknown_evidence_id',
        }),
      ])
    );
  });

  it('publishes a standalone Draft 2020-12 JSON Schema', () => {
    const ajv = new Ajv2020({
      allErrors: true,
      allowUnionTypes: true,
      strict: true,
      validateFormats: false,
    });
    const validate = ajv.compile(agentWorkReceiptSchema);

    for (const [, fixture] of validFixtures) {
      expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
    }
    expect(agentWorkReceiptSchema.$id).toBe(AGENT_WORK_RECEIPT_SCHEMA_ID);
    expect(agentWorkReceiptSchema.properties.schema_version.const).toBe(
      AGENT_WORK_RECEIPT_SCHEMA_VERSION
    );
  });

  it('round-trips through plain JSON without OrgX state or custom classes', () => {
    const imported: unknown = JSON.parse(JSON.stringify(openClawReceipt));
    const parsed: AgentWorkReceipt = parseAgentWorkReceipt(imported);

    expect(parsed).toEqual(openClawReceipt);
    expect(parsed.receipt_id).toBe('openclaw:event:evt-704');
    expect(parsed.lineage.references.map(({ ref }) => ref.system)).toEqual([
      'a2a',
      'mcp',
      'opentelemetry',
    ]);
  });

  it('uses opaque strings instead of requiring account or UUID identifiers', () => {
    const schemaText = JSON.stringify(agentWorkReceiptSchema);
    expect(schemaText).not.toContain('workspace_id');
    expect(schemaText).not.toContain('workspaceId');
    expect(schemaText).not.toContain('"format":"uuid"');

    const receipt = clone(codexReceipt);
    receipt.receipt_id = 'plain-external-id';
    receipt.actor.id = 'agent@example/runtime';
    receipt.intent.request_ref.id = 'ticket:customer-owned:42';
    expect(validateAgentWorkReceipt(receipt).ok).toBe(true);
  });

  it('returns a stable fail-fast schema issue for malformed input', () => {
    const invalid = clone(codexReceipt);
    delete invalid.receipt_id;
    invalid.schema_version = 'v1';
    invalid.unknown_field = true;
    invalid.cost.total = -1;

    const first = validateAgentWorkReceipt(invalid);
    const second = validateAgentWorkReceipt({
      unknown_field: true,
      ...clone(invalid),
    });

    expect(first.ok).toBe(false);
    expect(second).toEqual(first);
    if (first.ok) throw new Error('Expected validation to fail.');
    expect(first.issues).toEqual([
      {
        path: '/receipt_id',
        code: 'schema.required',
        message: 'Required value is missing.',
      },
    ]);
    expect(first.issue_count).toBe(1);
    expect(first.issues_truncated).toBe(false);
  });

  it('rejects invalid RFC 3339 timestamps deterministically', () => {
    const invalid = clone(codexReceipt);
    invalid.timestamps.started_at = '2026-02-30T15:00:00Z';

    expect(validateAgentWorkReceipt(invalid)).toEqual({
      ok: false,
      issue_count: 1,
      issues_truncated: false,
      issues: [
        {
          path: '/timestamps/started_at',
          code: 'schema.format',
          message: 'Value must match the date-time format.',
        },
      ],
    });
  });

  it('accepts RFC 3339 timestamps with lowercase t and z', () => {
    const receipt = clone(codexReceipt);
    receipt.timestamps.started_at = '2026-07-19t15:00:00z';

    expect(validateAgentWorkReceipt(receipt)).toEqual({
      ok: true,
      receipt,
    });
  });

  it('orders RFC 3339 leap-second timestamps without Date.parse gaps', () => {
    const invalid = clone(codexReceipt);
    invalid.timestamps.started_at = '2016-12-31T23:59:60Z';
    invalid.timestamps.completed_at = '2016-12-31T23:59:59Z';

    expect(validateAgentWorkReceipt(invalid)).toEqual({
      ok: false,
      issue_count: 1,
      issues_truncated: false,
      issues: [
        {
          path: '/timestamps/completed_at',
          code: 'semantic.time_order',
          message: 'Receipt completion must not precede receipt start.',
        },
      ],
    });
  });

  it.each([
    ['malformed percent escape', '../evidence/%ZZ'],
    ['malformed IPv6 literal', 'https://[:::1]/evidence'],
    ['non-breaking whitespace', '/evidence/one\u00a0two'],
  ])('rejects a URI reference with %s', (_case, uri) => {
    const invalid = clone(codexReceipt);
    invalid.lineage.references[0].ref.uri = uri;

    expect(validateAgentWorkReceipt(invalid)).toEqual({
      ok: false,
      issue_count: 1,
      issues_truncated: false,
      issues: [
        {
          path: '/lineage/references/0/ref/uri',
          code: 'schema.format',
          message: 'Value must match the uri-reference format.',
        },
      ],
    });
  });

  it('accepts a relative URI reference with encoded Unicode', () => {
    const receipt = clone(codexReceipt);
    receipt.lineage.references[0].ref.uri =
      '../evidence/%E2%9C%93?source=agent#proof';

    expect(validateAgentWorkReceipt(receipt).ok).toBe(true);
  });

  it('rejects numbers outside the interoperable IEEE-754 safe range', () => {
    const invalid = clone(codexReceipt);
    invalid.cost.total = 9007199254740992;

    expect(validateAgentWorkReceipt(invalid)).toEqual({
      ok: false,
      issue_count: 1,
      issues_truncated: false,
      issues: [
        {
          path: '/cost/total',
          code: 'schema.maximum',
          message: 'Value does not satisfy schema rule maximum.',
        },
      ],
    });
  });

  it('rejects duplicate ids, dangling evidence ids, and inverted times', () => {
    const invalid = clone(openClawReceipt);
    invalid.actions.push({ ...invalid.actions[0] });
    invalid.verification.evidence_ids.push('evidence-not-present');
    invalid.timestamps.issued_at = '2026-07-19T16:59:59Z';

    const result = validateAgentWorkReceipt(invalid);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected validation to fail.');

    expect(result.issues).toEqual([
      {
        path: '/actions/1/id',
        code: 'semantic.duplicate_id',
        message: 'Identifier duplicates /actions/0/id.',
      },
      {
        path: '/timestamps/issued_at',
        code: 'semantic.time_order',
        message: 'Receipt issuance must not precede receipt completion.',
      },
      {
        path: '/verification/evidence_ids/2',
        code: 'semantic.unknown_evidence_id',
        message: 'Referenced evidence id is not present in /evidence.',
      },
    ]);
  });

  it('rejects verification claims that do not match their checks', () => {
    const invalid = clone(openClawReceipt);
    invalid.verification.checks[0].status = 'failed';

    const result = validateAgentWorkReceipt(invalid);
    expect(result).toEqual({
      ok: false,
      issue_count: 1,
      issues_truncated: false,
      issues: [
        {
          path: '/verification/status',
          code: 'semantic.inconsistent_verification_status',
          message: 'Passed verification cannot contain a non-passing check.',
        },
      ],
    });
  });

  it('fails safely for adversarially deep or circular extension values', () => {
    const deeplyNested = clone(codexReceipt);
    deeplyNested.extensions = {};
    let cursor = deeplyNested.extensions;
    for (let depth = 0; depth < 100; depth += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }

    const standaloneAjv = new Ajv2020({
      allErrors: true,
      strict: true,
      validateFormats: false,
    });
    expect(standaloneAjv.compile(agentWorkReceiptSchema)(deeplyNested)).toBe(
      true
    );

    expect(validateAgentWorkReceipt(deeplyNested)).toMatchObject({
      ok: false,
      issues: [{ code: 'input.structure_limit' }],
    });

    const circular = clone(codexReceipt);
    circular.extensions = {};
    circular.extensions.self = circular.extensions;
    expect(validateAgentWorkReceipt(circular)).toMatchObject({
      ok: false,
      issues: [{ code: 'input.circular_reference' }],
    });
  });

  it('fails fast instead of materializing schema-error amplification', () => {
    const invalid = clone(codexReceipt);
    invalid.actions = Array.from({ length: 10_000 }, () => ({}));

    const first = validateAgentWorkReceipt(invalid);
    const second = validateAgentWorkReceipt(clone(invalid));
    expect(first.ok).toBe(false);
    expect(second).toEqual(first);
    if (first.ok) throw new Error('Expected validation to fail.');

    expect(first.issues).toHaveLength(1);
    expect(first.issue_count).toBe(1);
    expect(first.issues_truncated).toBe(false);
  });

  it('bounds semantic issues while retaining their total observed count', () => {
    const invalid = clone(codexReceipt);
    const duplicateAction = {
      id: 'duplicate-action',
      type: 'test',
      summary: 'Duplicate action',
      status: 'planned',
    };
    invalid.actions = Array.from({ length: 9_000 }, () => duplicateAction);

    const result = validateAgentWorkReceipt(invalid);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected validation to fail.');

    expect(result.issues).toHaveLength(
      AGENT_WORK_RECEIPT_MAX_VALIDATION_ISSUES
    );
    expect(result.issue_count).toBe(8_999);
    expect(result.issues_truncated).toBe(true);

    try {
      parseAgentWorkReceipt(invalid);
      throw new Error('Expected parseAgentWorkReceipt to throw.');
    } catch (error) {
      expect(error).toBeInstanceOf(AgentWorkReceiptValidationError);
      const validationError = error as AgentWorkReceiptValidationError;
      expect(validationError.issues).toHaveLength(
        AGENT_WORK_RECEIPT_MAX_VALIDATION_ISSUES
      );
      expect(validationError.issue_count).toBe(8_999);
      expect(validationError.issues_truncated).toBe(true);
    }
  });

  it('throws a typed error with the same deterministic issue format', () => {
    const invalid = clone(claudeCodeReceipt);
    invalid.actions[0].completed_at = '2026-07-19T16:01:59Z';

    expect(() => parseAgentWorkReceipt(invalid)).toThrow(
      AgentWorkReceiptValidationError
    );

    try {
      parseAgentWorkReceipt(invalid);
      throw new Error('Expected parseAgentWorkReceipt to throw.');
    } catch (error) {
      expect(error).toBeInstanceOf(AgentWorkReceiptValidationError);
      const validationError = error as AgentWorkReceiptValidationError;
      expect(formatAgentWorkReceiptIssues(validationError.issues)).toBe(
        '/actions/0/completed_at [semantic.time_order] Action completion must not precede action start.'
      );
    }
  });
});
