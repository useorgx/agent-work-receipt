# Releasing

The public GitHub repository, npm package metadata, release tag, and workflow
must all describe the same source. A local build or successful workflow is not
a published release.

## Release gate

1. Confirm `main` is clean and CI passes on Node.js 20.10.0, 22, and 24.
2. Run `npm ci`, `npm run typecheck`, `npm test`, and `npm pack --dry-run`.
3. Confirm `package.json` version and the intended `v<version>` tag match.
4. Confirm the repository URL is exactly
   `https://github.com/useorgx/agent-work-receipt`.
5. Create and push the signed or annotated release tag.
6. Verify the workflow published the expected version, then independently run
   `npm view @useorgx/agent-work-receipt@<version> version dist.integrity`.
7. Install the registry artifact in a clean directory and reproduce the Codex
   fixture digest before calling the release registry-proven.

## Initial publication only

npm cannot configure a trusted publisher until the package exists. For v0.1.0,
add a short-lived granular npm automation token as the repository secret
`NPM_TOKEN`, restricted to `@useorgx/agent-work-receipt`. Run `publish.yml` from
the `v0.1.0` tag; the workflow requests a GitHub provenance attestation.

After v0.1.0 is visible on npm:

1. Configure the package's npm trusted publisher for organization `useorgx`,
   repository `agent-work-receipt`, and workflow `publish.yml`.
2. Delete the `NPM_TOKEN` repository secret and revoke the bootstrap token.
3. Run a dry release on an unchanged version and confirm npm rejects the
   duplicate while the workflow authenticates through OIDC.
4. Future tag releases use the same workflow without a long-lived token.

References: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)
and [npm provenance statements](https://docs.npmjs.com/generating-provenance-statements/).
