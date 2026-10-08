# The review extension: `org.orgx.review/v1`

A receipt tells you what an agent did. A reviewer needs one more layer to say
**approve** or **send back**: where each criterion came from and whether that
source still agrees, what kind of proof backs it, and how the work unfolded.
The v0.2 core deliberately stays small, so this layer rides in
`extensions['org.orgx.review/v1']`. It is additive. A host that does not know
the namespace ignores it; the core receipt validates exactly as before.

Schema: `schema/extensions/org.orgx.review.v1.schema.json`
(`$id` `https://useorgx.com/schemas/agent-work-receipt/extensions/org.orgx.review/v1/schema.json`).
Fixture: `fixtures/hatch-2216-review.v0.2.json`.

## What it carries

| Field | What it answers |
|---|---|
| `sources[]` | The documents, tickets, chat messages, PRs, artifacts and skills the criteria were read from. Each has a type, a title, a location and a link. |
| `criteria[]` | One entry per `intent.criteria[].id`. `source_refs` say where the criterion was read from, with the source's own words in `quote`. `source_check` says whether the source still agrees: `confirmed`, `unchecked`, or `wrong` (the quote then shows what the source actually says). `lenses` are four independent kinds of proof. `group` and `short` keep a long list readable. |
| `lenses` | `judged`: reviewed against the codebase, skills and good practice. `measured`: tests or commands that ran. `observed`: attached output, screenshot or log. `outcome`: a signal after release. Each is `pass`, `partial`, `fail`, `none` or `na`, with a note and `evidence_ids` into the receipt's evidence. |
| `episodes[]` | The moments of the work: `ask`, `steer`, `change`, `retry`, `experiment`, `check`, `commit`. Ids are content-derived and stable across re-extraction (never a positional `T3`). Each ties to criteria, evidence, actions, a trajectory step and, for commits, the sha. |
| `layers` | Which layers of the record exist: `inputs`, `sources`, `transcript`, and the four proof lenses. Each is `full`, `part` or `missing`, with a note and, when missing, `how` to fill it. An empty layer is a fact about the record, not a judgment of the work. |
| `inputs[]`, `conversation[]` | What was asked, by whom, and the transcript when one was captured. |
| `domain`, `subject` | The kind of work (`code`, `design`, `content`, `ops`, `data`, `research`, `generic`) and what the receipt is about (a pull request, a design file, a brief, a deployment). The lens keys never change; the domain only sets the plain words a reviewer sees for them, so one review surface serves every artifact type. |
| `readings[]` | Independent readings of the same run, for example the rule-based outcome next to the criterion-judged one. |

## Rules

`validateOrgxReviewExtension(receipt)` checks the payload against the schema
and then ties it to the receipt it sits in:

- every `criteria[].criterion_id` names an entry in `intent.criteria`, once
- every `source_refs[].source_id` names an entry in `sources`
- every `evidence_ids` entry (lenses and episodes) names `receipt.evidence`
- every `episodes[].action_ids` entry names `receipt.actions`
- every `episodes[].trajectory_id` names `receipt.trajectory`
- every `episode_ids` entry names `episodes`
- episode and source ids are unique
- a `source_check` of `wrong` needs a `quote` to show what the source says
- a `source_check` of `confirmed` needs at least one source
- a `commit` episode carries its sha

Issue codes are prefixed `review.` (or `schema.` for the schema stage) and
paths are JSON Pointers rooted at the receipt, so they sit next to core issues
without ambiguity.

## Honest use

The same guidance as `docs/v0.2.md` applies. Say `none` when there is no proof
of a kind; do not infer a `pass`. Say `unchecked` when nobody compared a
criterion to its source. Leave `transcript` as `missing` when the client did
not export one. A reviewer trusts the record because its gaps are visible.

## Producers

- **OrgX Trail** (`@useorgx/trail` ≥ 0.7) emits the extension from a chat
  transcript: criteria quoted from the person's ask with their location,
  lenses mapped from evidence kinds, episodes with stable ids, commits from
  the shell history.
- **OrgX skill-guided runs** emit it from the frozen criteria plan and the
  recorded checks.
- **OrgX** (`useorgx.com`) reads it to render the Work Receipt Review, and
  derives a reduced version from a receipt that lacks it.
