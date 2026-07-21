export const AGENT_WORK_RECEIPT_SCHEMA_VERSION =
  'agent-work-receipt/v0.1' as const;

export const AGENT_WORK_RECEIPT_SCHEMA_ID =
  'https://useorgx.com/schemas/agent-work-receipt/v0.1/schema.json' as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

/**
 * Opaque reference to a record owned by any external system. Neither the id nor
 * the system is required to be an OrgX identifier.
 */
export interface AgentWorkExternalReference {
  system: string;
  type: string;
  id: string;
  uri?: string;
  version?: string;
  digest?: AgentWorkDigest;
  metadata?: JsonObject;
}

export interface AgentWorkDigest {
  algorithm: string;
  value: string;
  encoding?: 'hex' | 'base64' | 'base64url';
}

export interface AgentWorkContentDigest extends AgentWorkDigest {
  algorithm: 'sha-256' | 'sha256';
}

export interface AgentWorkRuntime {
  name: string;
  version?: string;
}

export interface AgentWorkModel {
  provider: string;
  name: string;
  version?: string;
}

export interface AgentWorkActor {
  type: 'agent' | 'service' | 'human' | 'team' | 'system' | 'other';
  id: string;
  display_name?: string;
  runtime?: AgentWorkRuntime;
  model?: AgentWorkModel;
  external_refs?: readonly AgentWorkExternalReference[];
  metadata?: JsonObject;
}

export interface AgentWorkIntent {
  summary: string;
  objective?: string;
  acceptance_criteria?: readonly string[];
  constraints?: readonly string[];
  request_ref?: AgentWorkExternalReference;
  metadata?: JsonObject;
}

export interface AgentWorkMoneyLimit {
  currency: string;
  amount: number;
}

export interface AgentWorkAuthorityScope {
  actions: readonly string[];
  resources: readonly AgentWorkExternalReference[];
  systems?: readonly string[];
  spend_limit?: AgentWorkMoneyLimit;
}

export interface AgentWorkApproval {
  status: 'requested' | 'granted' | 'denied' | 'revoked' | 'expired';
  approver: AgentWorkActor;
  scope?: string;
  occurred_at: string;
  ref?: AgentWorkExternalReference;
}

export interface AgentWorkAuthority {
  mode: 'explicit' | 'delegated' | 'inherited' | 'policy' | 'none' | 'unknown';
  status: 'granted' | 'restricted' | 'denied' | 'expired' | 'unknown';
  scope: AgentWorkAuthorityScope;
  delegated_by?: AgentWorkActor;
  authorization_ref?: AgentWorkExternalReference;
  approvals?: readonly AgentWorkApproval[];
  constraints?: readonly string[];
  valid_from?: string;
  valid_until?: string;
  metadata?: JsonObject;
}

export interface AgentWorkAction {
  id: string;
  type: string;
  summary: string;
  status:
    | 'planned'
    | 'running'
    | 'completed'
    | 'failed'
    | 'skipped'
    | 'blocked';
  system?: string;
  tool_ref?: AgentWorkExternalReference;
  target_refs?: readonly AgentWorkExternalReference[];
  input_refs?: readonly AgentWorkExternalReference[];
  output_refs?: readonly AgentWorkExternalReference[];
  started_at?: string;
  completed_at?: string;
  error?: string;
  metadata?: JsonObject;
}

export interface AgentWorkArtifact {
  id: string;
  kind: string;
  name: string;
  ref: AgentWorkExternalReference;
  role?: 'input' | 'intermediate' | 'output' | 'log' | 'report' | 'other';
  media_type?: string;
  digest?: AgentWorkDigest;
  size_bytes?: number;
  created_at?: string;
  metadata?: JsonObject;
}

export interface AgentWorkEvidence {
  id: string;
  kind: string;
  summary: string;
  ref?: AgentWorkExternalReference;
  digest?: AgentWorkDigest;
  observed_at: string;
  excerpt?: string;
  supports?: readonly string[];
  metadata?: JsonObject;
}

export interface AgentWorkOutcomeMetric {
  name: string;
  value: number;
  unit: string;
  baseline?: number;
  target?: number;
  observed_at?: string;
  evidence_ids?: readonly string[];
}

export interface AgentWorkAcceptance {
  status: 'pending' | 'accepted' | 'rejected' | 'changes_requested';
  actor?: AgentWorkActor;
  occurred_at?: string;
  evidence_ids?: readonly string[];
  notes?: string;
}

export interface AgentWorkOutcome {
  status:
    | 'succeeded'
    | 'partially_succeeded'
    | 'failed'
    | 'blocked'
    | 'cancelled'
    | 'unknown';
  summary: string;
  observed_effects?: readonly string[];
  metrics?: readonly AgentWorkOutcomeMetric[];
  acceptance?: AgentWorkAcceptance;
  metadata?: JsonObject;
}

export interface AgentWorkVerificationCheck {
  id: string;
  name: string;
  status: 'passed' | 'failed' | 'skipped' | 'inconclusive';
  method?: string;
  evidence_ids: readonly string[];
  details?: string;
}

export interface AgentWorkVerification {
  status: 'unverified' | 'passed' | 'failed' | 'partial' | 'inconclusive';
  method: string;
  verifier?: AgentWorkActor;
  checks: readonly AgentWorkVerificationCheck[];
  evidence_ids: readonly string[];
  verified_at?: string;
  notes?: string;
  metadata?: JsonObject;
}

export interface AgentWorkCostComponent {
  category: string;
  amount: number;
  description?: string;
}

export interface AgentWorkUsage {
  name: string;
  quantity: number;
  unit: string;
  cost?: number;
}

export interface AgentWorkCost {
  currency: string;
  total: number;
  components?: readonly AgentWorkCostComponent[];
  usage?: readonly AgentWorkUsage[];
  human_minutes?: number;
  estimated?: boolean;
  metadata?: JsonObject;
}

export interface AgentWorkLineageEdge {
  relationship: string;
  ref: AgentWorkExternalReference;
}

export interface AgentWorkLineage {
  run_ref?: AgentWorkExternalReference;
  parent_receipt_refs: readonly AgentWorkExternalReference[];
  references: readonly AgentWorkLineageEdge[];
  trace_id?: string;
  span_id?: string;
  metadata?: JsonObject;
}

export interface AgentWorkHumanIntervention {
  id: string;
  kind:
    | 'approval'
    | 'correction'
    | 'input'
    | 'execution'
    | 'escalation'
    | 'override'
    | 'review'
    | 'other';
  actor: AgentWorkActor;
  summary: string;
  occurred_at: string;
  duration_minutes?: number;
  evidence_ids?: readonly string[];
  refs?: readonly AgentWorkExternalReference[];
  metadata?: JsonObject;
}

export interface AgentWorkTimestamps {
  started_at: string;
  completed_at: string;
  issued_at: string;
  observed_at?: string;
  duration_ms?: number;
}

export interface AgentWorkSignature {
  algorithm: 'ed25519';
  encoding: 'base64url';
  value: string;
  key_id: string;
  signer?: AgentWorkActor;
  signed_at?: string;
}

export interface AgentWorkIntegrity {
  content_hash: AgentWorkContentDigest;
  signatures?: readonly AgentWorkSignature[];
}

export interface AgentWorkReceipt {
  schema_version: typeof AGENT_WORK_RECEIPT_SCHEMA_VERSION;
  receipt_id: string;
  intent: AgentWorkIntent;
  actor: AgentWorkActor;
  authority: AgentWorkAuthority;
  actions: readonly AgentWorkAction[];
  artifacts: readonly AgentWorkArtifact[];
  evidence: readonly AgentWorkEvidence[];
  outcome: AgentWorkOutcome;
  verification: AgentWorkVerification;
  cost: AgentWorkCost;
  lineage: AgentWorkLineage;
  human_interventions: readonly AgentWorkHumanIntervention[];
  timestamps: AgentWorkTimestamps;
  integrity?: AgentWorkIntegrity;
  extensions?: JsonObject;
}

export interface AgentWorkReceiptValidationIssue {
  /** RFC 6901 JSON Pointer. Root is represented as an empty string. */
  path: string;
  code: string;
  message: string;
}

export type AgentWorkReceiptValidationResult =
  | { ok: true; receipt: AgentWorkReceipt }
  | {
      ok: false;
      /** Deterministic, bounded issue list suitable for direct display. */
      issues: readonly AgentWorkReceiptValidationIssue[];
      /** Total unique issues observed before response bounding. */
      issue_count: number;
      /** Whether `issues` omits any of the observed issues. */
      issues_truncated: boolean;
    };
