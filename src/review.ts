/**
 * org.orgx.review/v1 — the review extension.
 *
 * Lives at `receipt.extensions['org.orgx.review/v1']`. It is additive: the
 * core v0.2 receipt is unchanged and a host that does not know the namespace
 * ignores it. It carries what a reviewer needs to approve or reject work that
 * the core cannot express — where each criterion came from (with the quoted
 * line), whether that source still agrees, four kinds of proof per criterion,
 * the episodes of the work tied to commits, and which layers of the record
 * are present.
 */
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';

import reviewSchemaJson from '../schema/extensions/org.orgx.review.v1.schema.json' with {
  type: 'json',
};
import type {
  AgentWorkReceipt,
  AgentWorkReceiptValidationIssue,
  JsonObject,
} from './types.ts';

export const ORGX_REVIEW_EXTENSION_KEY = 'org.orgx.review/v1' as const;
export const ORGX_REVIEW_EXTENSION_SCHEMA_ID =
  'https://useorgx.com/schemas/agent-work-receipt/extensions/org.orgx.review/v1/schema.json';

export type OrgxReviewSourceType =
  | 'chat'
  | 'doc'
  | 'spec'
  | 'ticket'
  | 'design'
  | 'api'
  | 'pr'
  | 'artifact'
  | 'skill'
  | 'other';

export interface OrgxReviewSource {
  id: string;
  type: OrgxReviewSourceType;
  title: string;
  where?: string;
  href?: string;
  note?: string;
  digest?: string;
}

export interface OrgxReviewSourceRef {
  source_id: string;
  at?: string;
  quote?: string;
  href?: string;
}

export type OrgxReviewSourceCheck = 'unchecked' | 'confirmed' | 'wrong';
export type OrgxReviewLensStatus = 'pass' | 'partial' | 'fail' | 'none' | 'na';
export type OrgxReviewLensKey = 'judged' | 'measured' | 'observed' | 'outcome';

export interface OrgxReviewLens {
  status: OrgxReviewLensStatus;
  note?: string;
  evidence_ids?: readonly string[];
  href?: string;
}

export type OrgxReviewLenses = Record<OrgxReviewLensKey, OrgxReviewLens>;

export interface OrgxReviewCriterion {
  criterion_id: string;
  group?: string;
  short?: string;
  source_refs: readonly OrgxReviewSourceRef[];
  source_check: OrgxReviewSourceCheck;
  source_note?: string;
  lenses: OrgxReviewLenses;
  episode_ids?: readonly string[];
}

export type OrgxReviewEpisodeKind =
  | 'ask'
  | 'steer'
  | 'change'
  | 'retry'
  | 'experiment'
  | 'check'
  | 'commit';

export interface OrgxReviewCommitRef {
  sha: string;
  message?: string;
  href?: string;
}

export interface OrgxReviewEpisode {
  id: string;
  kind: OrgxReviewEpisodeKind;
  at: string;
  title: string;
  why?: string;
  criterion_ids?: readonly string[];
  commit?: OrgxReviewCommitRef;
  action_ids?: readonly string[];
  evidence_ids?: readonly string[];
  trajectory_id?: string;
  thread?: string;
  confidence?: number;
}

export type OrgxReviewLayerStatus = 'full' | 'part' | 'missing';
export type OrgxReviewLayerKey =
  | 'inputs'
  | 'sources'
  | 'transcript'
  | 'judged'
  | 'measured'
  | 'observed'
  | 'outcome';

export interface OrgxReviewLayer {
  status: OrgxReviewLayerStatus;
  note: string;
  how?: string;
}

export type OrgxReviewLayers = Record<OrgxReviewLayerKey, OrgxReviewLayer>;

export interface OrgxReviewInput {
  who: string;
  type: OrgxReviewSourceType;
  text: string;
  at?: string;
  quality?: OrgxReviewLayerStatus;
}

export interface OrgxReviewUtterance {
  who: 'human' | 'agent' | 'system';
  text: string;
  at?: string;
  episode_id?: string;
}

export interface OrgxReviewReading {
  label: string;
  value: string;
}

export type OrgxReviewDomain = 'code' | 'design' | 'content' | 'ops' | 'data' | 'research' | 'generic';
export type OrgxReviewSubjectType =
  | 'pull_request' | 'commit' | 'design' | 'document' | 'brief' | 'campaign' | 'dataset' | 'model' | 'deployment' | 'incident' | 'ticket' | 'artifact' | 'other';
export interface OrgxReviewSubject {
  type: OrgxReviewSubjectType;
  title: string;
  href?: string;
  system?: string;
  id?: string;
}

export interface OrgxReviewExtension {
  version: typeof ORGX_REVIEW_EXTENSION_KEY;
  /** Sets the plain words for the lenses; generic when omitted. */
  domain?: OrgxReviewDomain;
  /** What the receipt is about, for cross-domain lists. */
  subject?: OrgxReviewSubject;
  sources: readonly OrgxReviewSource[];
  criteria: readonly OrgxReviewCriterion[];
  episodes: readonly OrgxReviewEpisode[];
  layers: OrgxReviewLayers;
  inputs?: readonly OrgxReviewInput[];
  conversation?: readonly OrgxReviewUtterance[];
  readings?: readonly OrgxReviewReading[];
  work?: string;
  metadata?: JsonObject;
}

export const ORGX_REVIEW_LENS_KEYS: readonly OrgxReviewLensKey[] = [
  'judged',
  'measured',
  'observed',
  'outcome',
];
export const ORGX_REVIEW_LAYER_KEYS: readonly OrgxReviewLayerKey[] = [
  'inputs',
  'sources',
  'transcript',
  'judged',
  'measured',
  'observed',
  'outcome',
];

const ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  strict: true,
  validateFormats: true,
});
addFormatsModule.default(ajv, {
  mode: 'full',
  formats: ['date-time', 'uri-reference'],
  keywords: false,
});

export const orgxReviewExtensionSchema = reviewSchemaJson as Record<string, unknown>;
if (orgxReviewExtensionSchema.$id !== ORGX_REVIEW_EXTENSION_SCHEMA_ID) {
  throw new Error('org.orgx.review/v1 schema id does not match the SDK.');
}
const validateReviewSchema = ajv.compile<OrgxReviewExtension>(orgxReviewExtensionSchema);

const BASE_PATH = `/extensions/${ORGX_REVIEW_EXTENSION_KEY.replace(/~/g, '~0').replace(/\//g, '~1')}`;

const toPointer = (instancePath: string) =>
  `${BASE_PATH}${instancePath}`;

function schemaIssue(error: {
  instancePath: string;
  keyword: string;
  message?: string;
  params?: Record<string, unknown>;
}): AgentWorkReceiptValidationIssue {
  const unexpected =
    error.keyword === 'additionalProperties'
      ? `/${String(error.params?.additionalProperty ?? '')}`
      : '';
  return {
    path: toPointer(`${error.instancePath}${unexpected}`),
    code:
      error.keyword === 'additionalProperties'
        ? 'schema.additional_property'
        : `schema.${error.keyword}`,
    message: error.message ?? 'Schema violation.',
  };
}

export type OrgxReviewExtensionValidationResult =
  | { ok: true; review: OrgxReviewExtension }
  | { ok: false; issues: readonly AgentWorkReceiptValidationIssue[] };

/** Returns the review extension if the receipt carries one, else null. Does not validate. */
export function getOrgxReviewExtension(
  receipt: Pick<AgentWorkReceipt, 'extensions'>
): OrgxReviewExtension | null {
  const value = receipt.extensions?.[ORGX_REVIEW_EXTENSION_KEY];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as unknown as OrgxReviewExtension;
}

/**
 * Validate `receipt.extensions['org.orgx.review/v1']` against its schema and
 * against the receipt it sits in: every criterion_id must be declared in
 * intent.criteria, every source_id in sources, every evidence id in evidence,
 * every action id in actions, every trajectory_id in trajectory, every
 * episode id referenced by a criterion must exist, and ids must be unique.
 *
 * The receipt itself is assumed to have passed `validateAgentWorkReceipt`.
 * A receipt without the extension is valid (ok with `review: null` is not a
 * state; callers check `getOrgxReviewExtension` first).
 */
export function validateOrgxReviewExtension(
  receipt: AgentWorkReceipt
): OrgxReviewExtensionValidationResult {
  const review = getOrgxReviewExtension(receipt);
  if (!review) {
    return {
      ok: false,
      issues: [
        {
          path: BASE_PATH,
          code: 'review.missing',
          message: `Receipt has no ${ORGX_REVIEW_EXTENSION_KEY} extension.`,
        },
      ],
    };
  }
  if (!validateReviewSchema(review)) {
    return { ok: false, issues: (validateReviewSchema.errors ?? []).map(schemaIssue) };
  }

  const issues: AgentWorkReceiptValidationIssue[] = [];
  const push = (path: string, code: string, message: string) =>
    issues.push({ path: toPointer(path), code: `review.${code}`, message });

  const criterionIds = new Set((receipt.intent.criteria ?? []).map((c) => c.id));
  const evidenceIds = new Set(receipt.evidence.map((e) => e.id));
  const actionIds = new Set(receipt.actions.map((a) => a.id));
  const trajectoryIds = new Set((receipt.trajectory ?? []).map((t) => t.id));
  const sourceIds = new Set<string>();
  review.sources.forEach((s, i) => {
    if (sourceIds.has(s.id)) push(`/sources/${i}/id`, 'duplicate_id', `Duplicate source id "${s.id}".`);
    sourceIds.add(s.id);
  });
  const episodeIds = new Set<string>();
  review.episodes.forEach((e, i) => {
    if (episodeIds.has(e.id)) push(`/episodes/${i}/id`, 'duplicate_id', `Duplicate episode id "${e.id}".`);
    episodeIds.add(e.id);
    (e.criterion_ids ?? []).forEach((id, j) => {
      if (!criterionIds.has(id)) push(`/episodes/${i}/criterion_ids/${j}`, 'unknown_criterion_id', `Episode names undeclared criterion "${id}".`);
    });
    (e.evidence_ids ?? []).forEach((id, j) => {
      if (!evidenceIds.has(id)) push(`/episodes/${i}/evidence_ids/${j}`, 'unknown_evidence_id', `Episode names unknown evidence "${id}".`);
    });
    (e.action_ids ?? []).forEach((id, j) => {
      if (!actionIds.has(id)) push(`/episodes/${i}/action_ids/${j}`, 'unknown_action_id', `Episode names unknown action "${id}".`);
    });
    if (e.trajectory_id && !trajectoryIds.has(e.trajectory_id)) {
      push(`/episodes/${i}/trajectory_id`, 'unknown_trajectory_id', `Episode names unknown trajectory step "${e.trajectory_id}".`);
    }
    if (e.kind === 'commit' && !e.commit) {
      push(`/episodes/${i}/commit`, 'commit_without_sha', 'A commit episode must carry the commit it made.');
    }
  });
  const seenCriteria = new Set<string>();
  review.criteria.forEach((c, i) => {
    if (!criterionIds.has(c.criterion_id)) push(`/criteria/${i}/criterion_id`, 'unknown_criterion_id', `Review names undeclared criterion "${c.criterion_id}".`);
    if (seenCriteria.has(c.criterion_id)) push(`/criteria/${i}/criterion_id`, 'duplicate_criterion', `Criterion "${c.criterion_id}" is reviewed twice.`);
    seenCriteria.add(c.criterion_id);
    c.source_refs.forEach((r, j) => {
      if (!sourceIds.has(r.source_id)) push(`/criteria/${i}/source_refs/${j}/source_id`, 'unknown_source_id', `Criterion cites unknown source "${r.source_id}".`);
    });
    if (c.source_check === 'wrong' && !c.source_refs.some((r) => r.quote)) {
      push(`/criteria/${i}/source_check`, 'wrong_without_quote', 'A criterion marked off-source must quote the line it contradicts.');
    }
    if (c.source_check === 'confirmed' && c.source_refs.length === 0) {
      push(`/criteria/${i}/source_check`, 'confirmed_without_source', 'A criterion cannot be confirmed against no source.');
    }
    ORGX_REVIEW_LENS_KEYS.forEach((k) => {
      (c.lenses[k].evidence_ids ?? []).forEach((id, j) => {
        if (!evidenceIds.has(id)) push(`/criteria/${i}/lenses/${k}/evidence_ids/${j}`, 'unknown_evidence_id', `Lens names unknown evidence "${id}".`);
      });
    });
    (c.episode_ids ?? []).forEach((id, j) => {
      if (!episodeIds.has(id)) push(`/criteria/${i}/episode_ids/${j}`, 'unknown_episode_id', `Criterion names unknown episode "${id}".`);
    });
  });
  (review.conversation ?? []).forEach((u, i) => {
    if (u.episode_id && !episodeIds.has(u.episode_id)) push(`/conversation/${i}/episode_id`, 'unknown_episode_id', `Message names unknown episode "${u.episode_id}".`);
  });

  if (issues.length) {
    issues.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code));
    return { ok: false, issues };
  }
  return { ok: true, review };
}
