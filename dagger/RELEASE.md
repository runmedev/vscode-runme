---
cwd: ..
runme:
  id: 01K9VQABQD8DADW6JH91KBRJ20
  version: v3
terminalRows: 30
---

# Release the Runme VS Code extension with Dagger

This notebook is the executable release contract for the Runme VS Code
extension. GitHub Actions supplies the tag, identity, permissions, and secrets;
the repository's Dagger module validates, builds, tests, and publishes the
release.

## Tag contract

Create one annotated, unprefixed SemVer tag on a versioned commit on `main`:

- Stable: `3.18.0`
- Edge: `3.18.1-edge.0`

The tag must match the versions in `package.json` and the root package in
`package-lock.json`. Do not create a parallel `v3.18.0` tag.

The release workflow never calculates a new semantic version, commits, creates
tags, or pushes `main`. Those source changes land through the normal pull request
flow before tagging.

## Release graph

The Dagger module:

1. Validates the canonical tag and source versions.
2. Resolves the latest stable Runme kernel through the pinned Runme Dagger
   dependency.
3. Builds VSIX files for Linux, macOS, and Windows on x64 and arm64.
4. Runs the existing production unit and integration tests.
5. Publishes all six artifacts to the Visual Studio Marketplace with GitHub
   Actions OIDC.
6. Publishes stable artifacts to Open VSX.
7. Creates or verifies the GitHub Release and its artifacts.

Stable and edge package transformations happen only in Dagger's immutable source
directory. They are never written back to the checkout. Edge tags retain their
SemVer release identity while the extension manifest receives the numeric
version required by the Marketplace. That numeric version is derived from the
tagged commit timestamp, making retries deterministic and preserving the
existing monotonic version scheme.

## Build artifacts without publishing

Set `RELEASE_TAG` to a canonical tag that exists in the checkout. The production
secrets are passed as Dagger secret handles and do not enter command arguments or
exported artifacts.

```sh {"interpreter":"bash","name":"release:artifacts","promptEnv":"never","terminalRows":"30"}
set -euo pipefail
: "${RELEASE_TAG:?set RELEASE_TAG to a canonical release tag}"
test "$(git cat-file -t "${RELEASE_TAG}")" = tag
test "$(git rev-list -n 1 "${RELEASE_TAG}")" = "$(git rev-parse HEAD)"
release_timestamp=$(git show -s --format=%ct "${RELEASE_TAG}^{commit}")

dagger call --source . release-artifacts \
  --tag "${RELEASE_TAG}" \
  --commit-timestamp "${release_timestamp}" \
  --github-token env://GITHUB_TOKEN \
  --instrumentation-key env://INSTRUMENTATION_KEY \
  --connection-string env://CONNECTION_STR \
  export --path "./dist/release/${RELEASE_TAG}"
```

## Publish from GitHub Actions

This is the sole publishing entry point called by `.github/workflows/release.yml`.
It refuses to run outside GitHub Actions. Artifact construction and tests finish
before the first external publication command executes.

```sh {"interpreter":"bash","name":"release:pipeline","promptEnv":"never","terminalRows":"50"}
set -euo pipefail
: "${GITHUB_ACTIONS:?release:pipeline only runs in GitHub Actions}"
: "${RELEASE_TAG:?release tag is required}"
: "${GITHUB_REPOSITORY:?GitHub repository is required}"
: "${ACTIONS_ID_TOKEN_REQUEST_URL:?Marketplace OIDC request URL is required}"

test "$(git cat-file -t "${RELEASE_TAG}")" = tag
tag_commit=$(git rev-list -n 1 "${RELEASE_TAG}")
test "${tag_commit}" = "$(git rev-parse HEAD)"
git merge-base --is-ancestor "${tag_commit}" origin/main
release_timestamp=$(git show -s --format=%ct "${RELEASE_TAG}^{commit}")

dagger call --source . release \
  --tag "${RELEASE_TAG}" \
  --commit-timestamp "${release_timestamp}" \
  --repository "${GITHUB_REPOSITORY}" \
  --github-token env://GITHUB_TOKEN \
  --instrumentation-key env://INSTRUMENTATION_KEY \
  --connection-string env://CONNECTION_STR \
  --runme-test-token env://RUNME_TEST_TOKEN \
  --oidc-request-url "${ACTIONS_ID_TOKEN_REQUEST_URL}" \
  --oidc-request-token env://ACTIONS_ID_TOKEN_REQUEST_TOKEN \
  --open-vsx-token env://OPEN_VSX_TOKEN \
  stdout
```

## Operator flow

1. Land the intended version change on `main` through a pull request.
2. Confirm the `package.json` and `package-lock.json` versions match.
3. Create one annotated bare tag on that commit.
4. Push only the tag.
5. Verify the GitHub Actions run, six Marketplace targets, GitHub Release, and,
   for stable releases, Open VSX.

Historical dual tags remain untouched. New releases use only the bare tag family.
