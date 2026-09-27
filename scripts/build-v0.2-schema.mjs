// Agent Work Receipt v0.2 is v0.1 plus optional, additive fields. It is derived from the v0.1 schema by this script so
// the two can never drift in the parts they share: run `node scripts/build-v0.2-schema.mjs` after changing v0.1.
//
// What v0.2 adds, each because a real producer (trail, reading coding-agent transcripts) had to hide it in extensions:
//   intent.criteria            acceptance criteria with ids, so a result can point at the criterion it settles
//   intent.expected_outcomes   the range of outcomes that would count, not only one sentence of intent
//   outcome.criteria_results   per-criterion met / unmet / unknown / waived, with evidence and a confidence
//   outcome.expected_results   what was observed against each expected outcome
//   verification_check.criterion_ids   which criteria a check speaks to
//   provenance                 per-field basis (observed / declared / inferred / human) and confidence
//   trajectory                 changes of course, retries, escalations, handoffs, compactions
//   lineage.workstream_ref     the larger effort this piece of work belongs to
//   lineage_edge.confidence    how sure the producer is of a link it inferred
import fs from 'node:fs';

const v01 = JSON.parse(fs.readFileSync(new URL('../schema/agent-work-receipt.v0.1.schema.json', import.meta.url), 'utf8'));
const s = structuredClone(v01);
const d = s.$defs;
const ref = (name) => ({ $ref: `#/$defs/${name}` });
const ids = { type: 'array', maxItems: 1000, items: ref('id') };
const unit = { type: 'number', minimum: 0, maximum: 1 };
const num = { type: 'number', minimum: -9007199254740991, maximum: 9007199254740991 };

s.$id = 'https://useorgx.com/schemas/agent-work-receipt/v0.2/schema.json';
s.title = 'Agent Work Receipt v0.2';
s.description = `${v01.description} v0.2 adds optional, additive fields for identified acceptance criteria and their results, expected outcome ranges, per-field provenance, the trajectory of the work, and the workstream it belongs to. Every v0.1 field keeps its meaning.`;
s.properties.schema_version = { const: 'agent-work-receipt/v0.2', description: 'Stable contract version. A v0.2 receipt differs from v0.1 only by the optional fields v0.2 defines.' };

d.confidence = { ...unit, description: 'Producer confidence in [0, 1]. Absent means the producer makes no claim; 1 means certain (observed or decided by a person).' };

d.criterion = {
  type: 'object', additionalProperties: false, required: ['id', 'text'],
  description: 'One acceptance criterion: what must be true for the work to count as done.',
  properties: {
    id: ref('id'),
    text: ref('long_string'),
    kind: { ...ref('short_string'), description: 'Producer vocabulary, for example tests, typecheck, build, pull_request, merge, deploy, publish, file, answer.' },
    required: { type: 'boolean', description: 'False for nice-to-have criteria. Defaults to true.' },
    source: { type: 'string', enum: ['requested', 'inferred', 'policy', 'agent_proposed'], description: 'Where the criterion came from: the request itself, an inference from it, a standing policy, or the agent.' },
  },
};
d.expected_outcome = {
  type: 'object', additionalProperties: false, required: ['id', 'description'],
  description: 'An outcome that would count, optionally as a measurable range.',
  properties: { id: ref('id'), description: ref('long_string'), metric: ref('short_string'), unit: ref('short_string'), min: num, max: num, target: num },
};
d.criterion_result = {
  type: 'object', additionalProperties: false, required: ['criterion_id', 'status', 'evidence_ids'],
  properties: {
    criterion_id: ref('id'),
    status: { type: 'string', enum: ['met', 'unmet', 'unknown', 'waived'] },
    evidence_ids: ids,
    confidence: ref('confidence'),
    decided_by: ref('actor'),
    notes: ref('long_string'),
  },
};
d.expected_result = {
  type: 'object', additionalProperties: false, required: ['expected_id', 'status', 'evidence_ids'],
  properties: {
    expected_id: ref('id'),
    status: { type: 'string', enum: ['within', 'outside', 'unknown'] },
    observed: { anyOf: [num, ref('long_string')] },
    evidence_ids: ids,
    confidence: ref('confidence'),
  },
};
d.provenance_entry = {
  type: 'object', additionalProperties: false, required: ['path', 'basis'],
  description: 'How one value in this receipt was established. path is an RFC 6901 JSON Pointer into the receipt.',
  properties: {
    path: { type: 'string', maxLength: 512, pattern: '^(/([^~/]|~[01])*)*$' },
    basis: { type: 'string', enum: ['observed', 'declared', 'inferred', 'human'], description: 'observed: read from the system of record; declared: stated by the agent; inferred: derived by the producer; human: decided by a person.' },
    confidence: ref('confidence'),
    method: { ...ref('short_string'), description: 'The rule set or model that produced an inferred value, with version, for example trail-rules/1.9 or model:jev-v1.' },
    by: ref('actor'),
    at: { type: 'string', format: 'date-time' },
  },
};
d.trajectory_step = {
  type: 'object', additionalProperties: false, required: ['id', 'kind', 'summary'],
  description: 'A turn in how the work went: where the approach changed and why.',
  properties: {
    id: ref('id'),
    kind: { type: 'string', enum: ['change_of_course', 'retry', 'escalation', 'handoff', 'compaction', 'pause', 'resume'] },
    summary: ref('long_string'),
    trigger: { type: 'string', enum: ['error', 'denial', 'human', 'self', 'policy', 'timeout', 'other'] },
    occurred_at: { type: 'string', format: 'date-time' },
    action_ids: ids,
    evidence_ids: ids,
    confidence: ref('confidence'),
  },
};

d.intent.properties.criteria = { type: 'array', maxItems: 1000, items: ref('criterion'), description: 'Identified acceptance criteria. When present, acceptance_criteria (if also present) is a plain-text rendering of the same list.' };
d.intent.properties.expected_outcomes = { type: 'array', maxItems: 100, items: ref('expected_outcome') };
d.outcome.properties.criteria_results = { type: 'array', maxItems: 1000, items: ref('criterion_result') };
d.outcome.properties.expected_results = { type: 'array', maxItems: 100, items: ref('expected_result') };
d.verification_check.properties.criterion_ids = ids;
d.lineage.properties.workstream_ref = { ...ref('external_reference'), description: 'The larger effort this piece of work belongs to, in the producer or host namespace.' };
d.lineage_edge.properties.confidence = ref('confidence');
d.lineage_edge.properties.relationship = { ...d.lineage_edge.properties.relationship, description: 'Producer-defined. Recommended vocabulary: produced_from, continues, retries, supersedes, depends_on, reviews, same_effort, trace.' };
s.properties.provenance = { type: 'array', maxItems: 1000, items: ref('provenance_entry') };
s.properties.trajectory = { type: 'array', maxItems: 1000, items: ref('trajectory_step') };

fs.writeFileSync(new URL('../schema/agent-work-receipt.v0.2.schema.json', import.meta.url), JSON.stringify(s, null, 2) + '\n');
console.log('wrote schema/agent-work-receipt.v0.2.schema.json');
