# Behavior spec ↔ Agent Work Receipt crosswalk

[Behavior specs](https://www.braintrust.dev/blog/behavior-specs) (Braintrust + Basis)
define how an agent should conduct itself during long-horizon work, and evaluate each
trajectory against a spec with a `true`, `false`, or `NA` verdict.

A behavior-spec verdict answers "did the agent follow the standard?" An Agent Work
Receipt answers "what can another party rely on about this completed episode?" The two
compose: the verdict is one verification check inside the receipt, and the receipt wraps
that verdict in the context the verdict cannot see — authority, artifact identity,
evidence, cost, human intervention, and acceptance.

This document is the normative convention for carrying behavior-spec evaluations inside
Agent Work Receipt v0.1. It introduces **no new schema fields**; every mapping below uses
existing v0.1 structures. The conformance fixture is
[`fixtures/braintrust-behavior-spec.json`](../fixtures/braintrust-behavior-spec.json),
built on the `validate-rendered-deck` presentation example from the behavior-specs
announcement.

## Verdict mapping

Each evaluated behavior spec becomes one entry in `verification.checks[]`.

`NA` is not one thing. The reference judge in
[braintrustdata/agentbehavior](https://github.com/braintrustdata/agentbehavior)
distinguishes three `na_reason` values — `not_applicable`, `insufficient_evidence`,
and `behavior_not_judgeable` — and a receipt must not collapse them, because "this
spec didn't apply" and "the judge couldn't tell" are different facts for a consumer:

| Native verdict | `verification_check.status` | Notes |
| --- | --- | --- |
| `true` | `passed` | The trajectory exhibited the required behavior. |
| `false` | `failed` | The trajectory violated the spec. |
| `NA` (`not_applicable`) | `skipped` | The spec did not apply to this trajectory. |
| `NA` (`insufficient_evidence`) | `inconclusive` | The trajectory did not contain enough evidence to judge. |
| `NA` (`behavior_not_judgeable`) | `inconclusive` | The behavior could not be judged from this trajectory. |
| no valid verdict (judge timeout, refusal, malformed output) | `inconclusive` | Record the failure mode in `details`. |

Where the producer exposes an `na_reason`, carry it verbatim in `details` and in the
namespaced extension so nothing is lost in the status projection.

Conventions for the check entry:

- `id` — stable per spec, prefixed `behavior.` (for example `behavior.validate-rendered-deck`)
  so consumers can distinguish behavior checks from deterministic checks.
- `name` — human-readable, includes the spec identifier.
- `method` — states that the check is a trajectory evaluation against the referenced spec.
- `evidence_ids` — must resolve to an evidence record carrying the judge's rationale.
- `details` — a string carrying the raw verdict vocabulary and spec identity (for
  example `verdict=true spec_name=validate-rendered-deck spec_revision=9b1c2d3`), so no
  consumer has to reverse the status mapping. The structured payload belongs under a
  namespaced extension (below), not in `details`.

Aggregate `verification.status` follows normal v0.1 semantics (`passed`, `failed`,
`partial`, `inconclusive`, `unverified`) across **all** checks, behavior and otherwise —
a receipt with a passing behavior check and a failing deterministic check is `partial`
or `failed`, never `passed`.

## Pinning the spec: the `evaluated_against` lineage edge

The exact standard the trajectory was judged against is recorded under
`lineage.references[]` with the producer-defined relationship `evaluated_against`:

```json
{
  "relationship": "evaluated_against",
  "ref": {
    "system": "braintrust",
    "type": "behavior_spec",
    "id": "validate-rendered-deck",
    "version": "9b1c2d3",
    "digest": { "algorithm": "sha256", "value": "…", "encoding": "hex" }
  }
}
```

Spec identity follows the behavior-spec format itself: `ref.id` is the spec's
frontmatter `name` (its stable identifier — behavior specs define no native version
field). `ref.version` is therefore producer-owned — typically the Git commit or tag
that pinned the `BEHAVIOR.md` at judgment time — and `ref.digest` hashes the exact
`BEHAVIOR.md` bytes. That pin is the point: a verdict is only meaningful against the
exact spec text that produced it. Specs are opinions that get revised; the digest says
which opinion this episode was judged by. (The conformance fixture's digests are
well-formed synthetic values, not hashes of a retrievable document.)

The judged trajectory itself is preserved as a second lineage reference with
relationship `trace` (and `lineage.trace_id` / `span_id` where OpenTelemetry context
exists). The receipt points at the trajectory; it does not embed it.

## The judge is a verifier, not a score

The evaluating system is recorded as `verification.verifier` (an actor, typically
`type: "service"`), and its rationale is an `evidence` record referenced by the check's
`evidence_ids`. This keeps the v0.1 trust separation intact: what the producer claims,
what the judge concluded, what evidence backs the conclusion, and what a human accepted
in `outcome.acceptance` remain independently inspectable facts.

## Raw verdicts under extensions

Producers that want to carry the full evaluation payload do so under a namespaced
extension (here `dev.braintrust.behavior_specs`), per the v0.1 rule that core
interoperability must never depend on extension fields. Consumers that know nothing
about behavior specs still get a fully conformant receipt; consumers that do can recover
the native vocabulary losslessly.

## What the receipt adds around the verdict

A `true` verdict, alone, cannot tell a consumer whether the delegated authority was
still valid at delivery (`authority`), whether the delivered file is byte-for-byte the
file that was rendered (`artifacts[].digest`), what the episode cost (`cost`), where a
human intervened (`human_interventions`), or whether anyone accepted the result
(`outcome.acceptance`). Those records are what make a behavior verdict safe to act on —
to merge, pay, widen autonomy, or admit the episode into a training set.
