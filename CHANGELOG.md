# Changelog

## 0.1.1 - 2026-09-24

- Add a crosswalk from Agent Work Receipt fields to agent behavior specs
  (`docs/agent-behavior-spec-crosswalk.md`) and a behavior-spec conformance
  fixture (`fixtures/braintrust-behavior-spec.json`) covered by the
  conformance suite.
- Publish through npm trusted publishing only; the workflow holds no
  long-lived npm token.

## 0.1.0 - 2026-07-21

- Define the account-free Agent Work Receipt v0.1 schema and TypeScript types.
- Add deterministic validation with bounded semantic checks.
- Define RFC 8785 canonicalization and SHA-256 content integrity.
- Define the domain-separated Ed25519 signature profile.
- Publish Codex, Claude Code, and OpenClaw fixtures plus cross-language
  canonicalization, digest, signature, and tamper vectors.
- Keep content equality, cryptographic verification, and signer trust as
  independent result states.
