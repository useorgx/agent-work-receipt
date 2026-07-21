import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';

import { agentWorkReceiptSchema } from './schema.ts';
import type {
  AgentWorkReceipt,
  AgentWorkReceiptValidationIssue,
  AgentWorkReceiptValidationResult,
} from './types.ts';
import { hasUnpairedUtf16Surrogate } from './unicode.ts';

const TERMINAL_ACTION_STATUSES = new Set([
  'completed',
  'failed',
  'skipped',
  'blocked',
]);
export const AGENT_WORK_RECEIPT_MAX_INPUT_DEPTH = 64;
export const AGENT_WORK_RECEIPT_MAX_INPUT_NODES = 50_000;
export const AGENT_WORK_RECEIPT_MAX_VALIDATION_ISSUES = 100;

const ajv = new Ajv2020({
  allErrors: false,
  allowUnionTypes: true,
  strict: true,
  validateFormats: true,
});

addFormatsModule.default(ajv, {
  mode: 'full',
  formats: ['date-time', 'uri-reference'],
  keywords: false,
});

const validateSchema = ajv.compile<AgentWorkReceipt>(agentWorkReceiptSchema);

function escapeJsonPointerSegment(segment: string | number): string {
  return String(segment).replace(/~/g, '~0').replace(/\//g, '~1');
}

function appendJsonPointer(path: string, segment: string | number): string {
  return `${path}/${escapeJsonPointerSegment(segment)}`;
}

function schemaIssuePath(error: ErrorObject): string {
  if (error.keyword === 'required') {
    const missingProperty = (error.params as { missingProperty?: unknown })
      .missingProperty;
    if (typeof missingProperty === 'string') {
      return appendJsonPointer(error.instancePath, missingProperty);
    }
  }

  if (error.keyword === 'additionalProperties') {
    const additionalProperty = (
      error.params as { additionalProperty?: unknown }
    ).additionalProperty;
    if (typeof additionalProperty === 'string') {
      return appendJsonPointer(error.instancePath, additionalProperty);
    }
  }

  return error.instancePath;
}

function schemaIssueMessage(error: ErrorObject): string {
  switch (error.keyword) {
    case 'required':
      return 'Required value is missing.';
    case 'additionalProperties':
      return 'Property is not allowed by Agent Work Receipt v0.1.';
    case 'type':
      return `Value must be of type ${String(
        (error.params as { type?: unknown }).type ?? 'required by the schema'
      )}.`;
    case 'const':
      return 'Value does not match the required contract constant.';
    case 'enum':
      return 'Value is not one of the allowed contract values.';
    case 'format':
      return `Value must match the ${String(
        (error.params as { format?: unknown }).format ?? 'required'
      )} format.`;
    case 'pattern':
      return 'Value does not match the required pattern.';
    case 'minLength':
      return 'String is shorter than the contract minimum.';
    case 'maxLength':
      return 'String exceeds the contract maximum.';
    case 'minItems':
      return 'Array contains fewer items than the contract minimum.';
    case 'maxItems':
      return 'Array exceeds the contract maximum.';
    case 'minimum':
      return 'Number is below the contract minimum.';
    case 'minProperties':
      return 'Object contains fewer properties than the contract minimum.';
    default:
      return `Value does not satisfy schema rule ${error.keyword}.`;
  }
}

function schemaIssue(error: ErrorObject): AgentWorkReceiptValidationIssue {
  return {
    path: schemaIssuePath(error),
    code:
      error.keyword === 'additionalProperties'
        ? 'schema.additional_property'
        : `schema.${error.keyword}`,
    message: schemaIssueMessage(error),
  };
}

function compareIssues(
  left: AgentWorkReceiptValidationIssue,
  right: AgentWorkReceiptValidationIssue
): number {
  const leftKey = `${left.path}\u0000${left.code}\u0000${left.message}`;
  const rightKey = `${right.path}\u0000${right.code}\u0000${right.message}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function deterministicIssues(
  issues: readonly AgentWorkReceiptValidationIssue[]
): AgentWorkReceiptValidationIssue[] {
  const unique = new Map<string, AgentWorkReceiptValidationIssue>();
  for (const issue of issues) {
    unique.set(`${issue.path}\u0000${issue.code}\u0000${issue.message}`, issue);
  }
  return [...unique.values()].sort(compareIssues);
}

function validationFailure(
  issues: readonly AgentWorkReceiptValidationIssue[],
  issueCount?: number
): AgentWorkReceiptValidationResult {
  const deterministic = deterministicIssues(issues);
  const observedIssueCount = Math.max(issueCount ?? deterministic.length, 0);
  const bounded = deterministic.slice(
    0,
    AGENT_WORK_RECEIPT_MAX_VALIDATION_ISSUES
  );
  return {
    ok: false,
    issues: bounded,
    issue_count: observedIssueCount,
    issues_truncated: observedIssueCount > bounded.length,
  };
}

interface ValidationIssueSink {
  push(...issues: AgentWorkReceiptValidationIssue[]): number;
}

class BoundedValidationIssueCollector implements ValidationIssueSink {
  readonly issues: AgentWorkReceiptValidationIssue[] = [];
  issueCount = 0;

  push(...issues: AgentWorkReceiptValidationIssue[]): number {
    for (const issue of issues) {
      this.issueCount += 1;
      if (this.issues.length < AGENT_WORK_RECEIPT_MAX_VALIDATION_ISSUES) {
        this.issues.push(issue);
      }
    }
    return this.issueCount;
  }
}

function semanticIssue(
  path: string,
  code: string,
  message: string
): AgentWorkReceiptValidationIssue {
  return { path, code: `semantic.${code}`, message };
}

function inputStructureIssue(
  value: unknown
): AgentWorkReceiptValidationIssue | null {
  const ancestors = new WeakSet<object>();
  let nodes = 0;

  function visit(
    current: unknown,
    depth: number,
    path: string
  ): AgentWorkReceiptValidationIssue | null {
    nodes += 1;
    if (nodes > AGENT_WORK_RECEIPT_MAX_INPUT_NODES) {
      return {
        path,
        code: 'input.structure_limit',
        message: `Receipt exceeds the ${AGENT_WORK_RECEIPT_MAX_INPUT_NODES}-node validation limit.`,
      };
    }
    if (typeof current === 'string') {
      if (hasUnpairedUtf16Surrogate(current)) {
        return {
          path,
          code: 'input.invalid_unicode',
          message:
            'Receipt strings must contain only Unicode scalar values; unpaired UTF-16 surrogates are not allowed.',
        };
      }
      return null;
    }
    if (current === null || typeof current !== 'object') return null;
    if (depth >= AGENT_WORK_RECEIPT_MAX_INPUT_DEPTH) {
      return {
        path,
        code: 'input.structure_limit',
        message: `Receipt nesting exceeds the ${AGENT_WORK_RECEIPT_MAX_INPUT_DEPTH}-level validation limit.`,
      };
    }
    if (ancestors.has(current)) {
      return {
        path,
        code: 'input.circular_reference',
        message:
          'Receipt values must be JSON and cannot contain circular references.',
      };
    }
    ancestors.add(current);
    const entries = Array.isArray(current)
      ? current.map((item, index) => [index, item] as const)
      : Object.entries(current as Record<string, unknown>);
    for (const [key, item] of entries) {
      if (typeof key === 'string' && hasUnpairedUtf16Surrogate(key)) {
        return {
          path: appendJsonPointer(path, key),
          code: 'input.invalid_unicode',
          message:
            'Receipt object member names must contain only Unicode scalar values; unpaired UTF-16 surrogates are not allowed.',
        };
      }
      const issue = visit(item, depth + 1, appendJsonPointer(path, key));
      if (issue) {
        ancestors.delete(current);
        return issue;
      }
    }
    ancestors.delete(current);
    return null;
  }

  return visit(value, 0, '');
}

function addDuplicateIdIssues(
  items: readonly { id: string }[],
  collectionPath: string,
  issues: ValidationIssueSink
): void {
  const firstIndexById = new Map<string, number>();
  items.forEach((item, index) => {
    const firstIndex = firstIndexById.get(item.id);
    if (firstIndex === undefined) {
      firstIndexById.set(item.id, index);
      return;
    }
    issues.push(
      semanticIssue(
        `${collectionPath}/${index}/id`,
        'duplicate_id',
        `Identifier duplicates ${collectionPath}/${firstIndex}/id.`
      )
    );
  });
}

function addEvidenceReferenceIssues(
  evidenceIds: readonly string[] | undefined,
  collectionPath: string,
  knownEvidenceIds: ReadonlySet<string>,
  issues: ValidationIssueSink
): void {
  evidenceIds?.forEach((evidenceId, index) => {
    if (!knownEvidenceIds.has(evidenceId)) {
      issues.push(
        semanticIssue(
          `${collectionPath}/${index}`,
          'unknown_evidence_id',
          'Referenced evidence id is not present in /evidence.'
        )
      );
    }
  });
}

function addTimeOrderIssue(
  start: string | undefined,
  end: string | undefined,
  endPath: string,
  code: string,
  message: string,
  issues: ValidationIssueSink
): void {
  if (
    start &&
    end &&
    rfc3339TimestampToEpoch(end) < rfc3339TimestampToEpoch(start)
  ) {
    issues.push(semanticIssue(endPath, code, message));
  }
}

const RFC3339_TIMESTAMP_PARTS =
  /^(\d{4}-\d{2}-\d{2})[tT\s](\d{2}):(\d{2}):(\d{2})(\.\d+)?(z|[+-]\d{2}(?::?\d{2})?)$/i;

function rfc3339TimestampToEpoch(value: string): number {
  const match = RFC3339_TIMESTAMP_PARTS.exec(value);
  if (!match) return Number.NaN;

  const leapSecond = match[4] === '60';
  const second = leapSecond ? '59' : match[4];
  const rawOffset = match[6];
  const offset =
    rawOffset.toLowerCase() === 'z'
      ? 'Z'
      : rawOffset.length === 3
      ? `${rawOffset}:00`
      : rawOffset.includes(':')
      ? rawOffset
      : `${rawOffset.slice(0, 3)}:${rawOffset.slice(3)}`;
  const normalized = `${match[1]}T${match[2]}:${match[3]}:${second}${
    match[5] ?? ''
  }${offset}`;
  const epoch = Date.parse(normalized);
  return leapSecond && Number.isFinite(epoch) ? epoch + 1_000 : epoch;
}

function validateSemantics(
  receipt: AgentWorkReceipt
): BoundedValidationIssueCollector {
  const issues = new BoundedValidationIssueCollector();

  addDuplicateIdIssues(receipt.actions, '/actions', issues);
  addDuplicateIdIssues(receipt.artifacts, '/artifacts', issues);
  addDuplicateIdIssues(receipt.evidence, '/evidence', issues);
  addDuplicateIdIssues(
    receipt.human_interventions,
    '/human_interventions',
    issues
  );
  addDuplicateIdIssues(
    receipt.verification.checks,
    '/verification/checks',
    issues
  );

  const knownEvidenceIds = new Set(receipt.evidence.map(({ id }) => id));
  addEvidenceReferenceIssues(
    receipt.verification.evidence_ids,
    '/verification/evidence_ids',
    knownEvidenceIds,
    issues
  );
  receipt.verification.checks.forEach((check, index) => {
    addEvidenceReferenceIssues(
      check.evidence_ids,
      `/verification/checks/${index}/evidence_ids`,
      knownEvidenceIds,
      issues
    );
  });
  receipt.outcome.metrics?.forEach((metric, index) => {
    addEvidenceReferenceIssues(
      metric.evidence_ids,
      `/outcome/metrics/${index}/evidence_ids`,
      knownEvidenceIds,
      issues
    );
  });
  addEvidenceReferenceIssues(
    receipt.outcome.acceptance?.evidence_ids,
    '/outcome/acceptance/evidence_ids',
    knownEvidenceIds,
    issues
  );
  receipt.human_interventions.forEach((intervention, index) => {
    addEvidenceReferenceIssues(
      intervention.evidence_ids,
      `/human_interventions/${index}/evidence_ids`,
      knownEvidenceIds,
      issues
    );
  });

  addTimeOrderIssue(
    receipt.timestamps.started_at,
    receipt.timestamps.completed_at,
    '/timestamps/completed_at',
    'time_order',
    'Receipt completion must not precede receipt start.',
    issues
  );
  addTimeOrderIssue(
    receipt.timestamps.completed_at,
    receipt.timestamps.issued_at,
    '/timestamps/issued_at',
    'time_order',
    'Receipt issuance must not precede receipt completion.',
    issues
  );
  addTimeOrderIssue(
    receipt.authority.valid_from,
    receipt.authority.valid_until,
    '/authority/valid_until',
    'time_order',
    'Authority expiration must not precede authority start.',
    issues
  );

  receipt.actions.forEach((action, index) => {
    addTimeOrderIssue(
      action.started_at,
      action.completed_at,
      `/actions/${index}/completed_at`,
      'time_order',
      'Action completion must not precede action start.',
      issues
    );

    if (TERMINAL_ACTION_STATUSES.has(action.status) && !action.completed_at) {
      issues.push(
        semanticIssue(
          `/actions/${index}/completed_at`,
          'terminal_action_timestamp',
          'A terminal action must record completed_at.'
        )
      );
    }
  });

  if (receipt.verification.status !== 'unverified') {
    if (!receipt.verification.verifier) {
      issues.push(
        semanticIssue(
          '/verification/verifier',
          'verified_without_verifier',
          'A verification verdict must identify its verifier.'
        )
      );
    }
    if (!receipt.verification.verified_at) {
      issues.push(
        semanticIssue(
          '/verification/verified_at',
          'verified_without_timestamp',
          'A verification verdict must record verified_at.'
        )
      );
    }
    if (receipt.verification.checks.length === 0) {
      issues.push(
        semanticIssue(
          '/verification/checks',
          'verified_without_checks',
          'A verification verdict must contain at least one check.'
        )
      );
    }
  }

  if (
    receipt.verification.status === 'passed' &&
    receipt.verification.checks.some(({ status }) => status !== 'passed')
  ) {
    issues.push(
      semanticIssue(
        '/verification/status',
        'inconsistent_verification_status',
        'Passed verification cannot contain a non-passing check.'
      )
    );
  }
  if (
    receipt.verification.status === 'failed' &&
    !receipt.verification.checks.some(({ status }) => status === 'failed')
  ) {
    issues.push(
      semanticIssue(
        '/verification/status',
        'inconsistent_verification_status',
        'Failed verification must contain at least one failed check.'
      )
    );
  }

  if (
    receipt.authority.mode === 'none' &&
    receipt.authority.status === 'granted'
  ) {
    issues.push(
      semanticIssue(
        '/authority/status',
        'inconsistent_authority',
        'Authority mode none cannot have granted status.'
      )
    );
  }

  return issues;
}

export function validateAgentWorkReceipt(
  value: unknown
): AgentWorkReceiptValidationResult {
  let structureIssue: AgentWorkReceiptValidationIssue | null;
  try {
    structureIssue = inputStructureIssue(value);
  } catch {
    structureIssue = {
      path: '',
      code: 'input.validation_failed',
      message: 'Receipt could not be safely evaluated by the v0.1 validator.',
    };
  }
  if (structureIssue) return validationFailure([structureIssue]);

  let schemaValid: boolean;
  try {
    schemaValid = validateSchema(value);
  } catch {
    return validationFailure([
      {
        path: '',
        code: 'input.validation_failed',
        message: 'Receipt could not be safely evaluated by the v0.1 validator.',
      },
    ]);
  }
  if (!schemaValid) {
    return validationFailure((validateSchema.errors ?? []).map(schemaIssue));
  }

  const receipt = value as AgentWorkReceipt;
  const semanticIssues = validateSemantics(receipt);
  if (semanticIssues.issueCount > 0) {
    return validationFailure(semanticIssues.issues, semanticIssues.issueCount);
  }

  return { ok: true, receipt };
}

export function formatAgentWorkReceiptIssues(
  issues: readonly AgentWorkReceiptValidationIssue[]
): string {
  return deterministicIssues(issues)
    .map(({ path, code, message }) => `${path || '/'} [${code}] ${message}`)
    .join('\n');
}

export class AgentWorkReceiptValidationError extends TypeError {
  readonly issues: readonly AgentWorkReceiptValidationIssue[];
  readonly issue_count: number;
  readonly issues_truncated: boolean;

  constructor(
    issues: readonly AgentWorkReceiptValidationIssue[],
    options?: { issue_count?: number; issues_truncated?: boolean }
  ) {
    const deterministic = deterministicIssues(issues).slice(
      0,
      AGENT_WORK_RECEIPT_MAX_VALIDATION_ISSUES
    );
    const issueCount = Math.max(
      options?.issue_count ?? deterministic.length,
      0
    );
    const issuesTruncated =
      options?.issues_truncated ?? issueCount > deterministic.length;
    super(
      `Invalid Agent Work Receipt v0.1:\n${formatAgentWorkReceiptIssues(
        deterministic
      )}${
        issuesTruncated
          ? `\n${
              issueCount - deterministic.length
            } additional issue(s) omitted.`
          : ''
      }`
    );
    this.name = 'AgentWorkReceiptValidationError';
    this.issues = deterministic;
    this.issue_count = issueCount;
    this.issues_truncated = issuesTruncated;
  }
}

export function parseAgentWorkReceipt(value: unknown): AgentWorkReceipt {
  const result = validateAgentWorkReceipt(value);
  if (!result.ok) {
    throw new AgentWorkReceiptValidationError(result.issues, {
      issue_count: result.issue_count,
      issues_truncated: result.issues_truncated,
    });
  }
  return result.receipt;
}
