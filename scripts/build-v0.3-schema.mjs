// Agent Work Receipt v0.3 is v0.2 plus optional, additive fields. It is derived from the generated v0.2 schema by this
// script so the shared parts cannot drift: run `npm run build:schema` (which runs the v0.2 script first) after changing
// v0.1 or v0.2.
//
// What v0.3 adds, each so a reader can tell how strongly a receipt's claims are backed:
//   outcome.claim_level                 the strongest claim the receipt makes, on an ordered ladder
//                                       asserted < executed < observed < checked < accepted < outcome_observed
//   outcome.effects[]                   structured effects, each with a coverage and the evidence that shows it
//   action.coverage / effect.coverage   enforced | observed_only | outside_coverage
//   verification_check.verifier         verifier lineage: identity, model family, evidence source
//   intent.consequential                false only when the producer declares the work inconsequential
//   model.family                        model family, so actor and verifier families can be compared
//   lineage.trace_commitments[]         SHA-256 Merkle roots over trace spans, by reference (no raw spans)
//   signature.attests (v0.3.1)          ingested | observed: what a signature attests, as a protected header
import fs from 'node:fs';

const v02 = JSON.parse(fs.readFileSync(new URL('../schema/agent-work-receipt.v0.2.schema.json', import.meta.url), 'utf8'));
const s = structuredClone(v02);
const d = s.$defs;
const ref = (name) => ({ $ref: `#/$defs/${name}` });
const ids = { type: 'array', maxItems: 1000, items: ref('id') };

s.$id = 'https://useorgx.com/schemas/agent-work-receipt/v0.3/schema.json';
s.title = 'Agent Work Receipt v0.3';
s.description = `${v02.description.replace(/ v0\.2 adds .*$/u, '')} v0.2 adds optional fields for identified acceptance criteria and their results, expected outcome ranges, per-field provenance, the trajectory of the work, and the workstream it belongs to. v0.3 adds an ordered claim level, per-action and per-effect coverage, verifier lineage on checks, and trace commitments. Every v0.1 and v0.2 field keeps its meaning.`;
s.properties.schema_version = { const: 'agent-work-receipt/v0.3', description: 'Stable contract version. A v0.3 receipt differs from v0.2 only by the optional fields v0.3 defines.' };

d.claim_level = {
  type: 'string',
  enum: ['asserted', 'executed', 'observed', 'checked', 'accepted', 'outcome_observed'],
  description: 'Ordered from weakest to strongest: asserted < executed < observed < checked < accepted < outcome_observed. Claiming a level claims every level below it, and the validator requires the supporting fields of every level up to and including the claimed one.',
};
d.coverage = {
  type: 'string',
  enum: ['enforced', 'observed_only', 'outside_coverage'],
  description: 'enforced: passed through a control point that could have blocked it and recorded it; observed_only: recorded by a system other than the actor that could not block it; outside_coverage: known only from the actor\'s own report.',
};
d.effect = {
  type: 'object', additionalProperties: false, required: ['id', 'summary', 'coverage', 'evidence_ids'],
  description: 'One change the work made in the world, with how it is known.',
  properties: {
    id: ref('id'),
    summary: ref('long_string'),
    coverage: ref('coverage'),
    target_ref: ref('external_reference'),
    action_ids: { ...ids, description: 'The actions that caused this effect.' },
    evidence_ids: ids,
    observed_at: { type: 'string', format: 'date-time' },
  },
};
d.check_verifier = {
  type: 'object', additionalProperties: false, required: ['actor', 'evidence_source'],
  description: 'Who or what produced this check verdict, and where its evidence came from.',
  properties: {
    actor: { ...ref('actor'), description: 'Verifier identity. Compared by type and id with the receipt actor.' },
    model_family: { ...ref('short_string'), description: 'Model family when the verifier is or uses a model, for example claude, gpt, gemini, llama.' },
    evidence_source: {
      type: 'string',
      enum: ['system_of_record', 'independent_execution', 'actor_supplied', 'human_judgment', 'other'],
      description: 'system_of_record: read directly from the system that holds the result (CI, VCS, production); independent_execution: the verifier re-ran or re-derived it; actor_supplied: logs or artifacts handed over by the actor; human_judgment: a person looked; other.',
    },
  },
};
d.trace_commitment = {
  type: 'object', additionalProperties: false, required: ['trace_id', 'algorithm', 'root'],
  description: 'A commitment to the spans of one trace by hash, without carrying the spans. See docs/v0.3.md for the awr-trace-merkle/v1 construction.',
  properties: {
    trace_id: ref('id'),
    algorithm: { const: 'sha256' },
    root: { type: 'string', pattern: '^[0-9a-f]{64}$', description: 'Lowercase hex SHA-256 Merkle root.' },
    construction: { const: 'awr-trace-merkle/v1', description: 'How root was computed. Absent means awr-trace-merkle/v1.' },
    leaf_count: { type: 'integer', minimum: 0, maximum: 9007199254740991, description: 'Number of spans committed to.' },
    trace_ref: { ...ref('external_reference'), description: 'Where the committed spans can be fetched, in the producer namespace.' },
    committed_at: { type: 'string', format: 'date-time' },
  },
};

d.intent.properties.consequential = { type: 'boolean', description: 'Defaults to true. Set false only for work whose effects are trivially reversible and harmless; then a self-check can support the checked claim level.' };
d.model.properties.family = { ...ref('short_string'), description: 'Model family, for example claude, gpt, gemini, llama.' };
d.action.properties.coverage = ref('coverage');
d.outcome.properties.claim_level = ref('claim_level');
d.outcome.properties.effects = { type: 'array', maxItems: 1000, items: ref('effect') };
d.verification_check.properties.verifier = ref('check_verifier');
d.signature.properties.attests = {
  type: 'string',
  enum: ['ingested', 'observed'],
  description: 'Protected: part of the signed payload. ingested: the signer received exactly these bytes (custody and integrity), not an endorsement of claim level, coverage, verification, or acceptance. observed: the signer itself observed or recorded the facts the receipt states. Absent: no statement.',
};
d.lineage.properties.trace_commitments = { type: 'array', maxItems: 100, items: ref('trace_commitment') };

fs.writeFileSync(new URL('../schema/agent-work-receipt.v0.3.schema.json', import.meta.url), JSON.stringify(s, null, 2) + '\n');
console.log('wrote schema/agent-work-receipt.v0.3.schema.json');
