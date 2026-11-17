# npm releases

The GitHub Actions workflow is `.github/workflows/publish.yml`.

| Branch | npm tag | Published version |
| --- | --- | --- |
| `release/canary` | `canary` | Stable base plus `-canary.<timestamp>.<commit>` |
| `release/latest` | `latest` | Exact stable `package.json` version |

Use a stable base such as `0.1.0` in `package.json`. Bump it before each new stable
release. Canary publishing never moves `latest`. Publishing invokes `needle-publish-helper@next` directly in CI, and successful publications create a `release/<published-version>`
git tag. Runs on the same branch are serialized rather than canceled.

Each push to a release branch runs the package guard tests, builds both browser
bundles, checks the actual npm package contents, and then publishes. Runtime code
has no npm dependencies; package verification requires both entrypoints, TypeScript
declarations, README, and third-party license notices, and rejects unrelated files.
The package's existing license is unchanged.

## One-time npm setup

Configure npm trusted publishing for `@needle-tools/image-3d`:

- GitHub owner: `needle-tools`
- Repository: `image-3d`
- Workflow filename: `publish.yml`
- GitHub environment: leave blank (the workflow has no environment restriction)

The workflow uses Node 24 and OIDC, with no npm token secret. The package must
already exist before its trusted publisher can be configured. If it does not,
an authorized package owner needs to perform the initial publication separately.
This prepared workflow does not create the package, change trusted publishers,
configure remote variables/secrets, or create release branches.

## Review without publishing

```sh
npm run test:release
npm run build
npm run check:package
```

`check:package` uses `npm pack --dry-run --ignore-scripts` on the built files.
The two helper commands and their version/tag flags are written directly in the
workflow. There is no local publishing wrapper.

Publishing is triggered only by pushes to the two release branches. Each branch
has its own direct helper command in the workflow; there is no manual publish or
dry-run switch. Use the local package checks above to review before pushing.

Install a published channel with:

```sh
npm install @needle-tools/image-3d@canary
npm install @needle-tools/image-3d@latest
```
