# npm release publishing - READY FOR REVIEW

- `.github/workflows/publish.yml` runs the helper directly, with separate readable
  steps for release/canary and release/latest. Uses needle-publish-helper@next per
  user preference; no local publisher wrapper or release-plan commands.
- Canary sets only canary, with version tag/time/hash. Latest sets only latest,
  using the stable manifest version. Pushes to the two release branches publish directly and create
  release/<version> git tags. No manual publish or dry-run switch.
- Node 24, OIDC, only release branch refs, serialized runs. No npm token secret.
- `scripts/check-package.mjs` and `tests/release.test.mjs` retain package-content,
  dependency, public-manifest and stable-version guards. Runtime code and existing
  README/runtime work are unchanged.
- `package.json` removes private publication block and adds package check commands.
- `docs/publishing.md` and README describe channels, package checks and OIDC setup.

Validation: runtime build and npm pack dry-run passed; package contains 8 files,
with both browser bundles, declarations, README and third-party notices, and no
runtime dependencies. Focused package guard tests pass. The requested next dist-tag
was verified against npm. No helper invocation, npm publication, git tag, commit,
push, branch creation, trusted-publisher update, remote variable/secret mutation
or Cloud submodule pin change performed. First publication/trusted-publisher setup
remain user-managed prerequisites. No browser/GPU checks run: no renderer edits.

- Review simplification: removed the unrequested workflow_dispatch/dry_run mode
  and conditional argument expression; both helper commands now explicitly pass
  --create-tag release/. Local package validation remains available.
