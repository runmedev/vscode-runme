---
cwd: ..
runme:
  id: 01K9VQABQD8DADW6JH91KBRJ20
  version: v3
shell: dagger shell
terminalRows: 30
---

# Release the Runme VS Code extension (via Dagger)

This notebook is the executable release contract for the Runme VS Code
extension. GitHub Actions supplies the tag, identity, permissions, and secrets;
the named Dagger artifacts below validate, build, test, and publish the release.

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

Initialize the `VscodeRunme` Dagger module using the local source code. The
capitalized cell name is the release graph's source noun; the piped Dagger
functions below are its verbs.

```sh {"name":"VscodeRunme"}
### Exported in runme.dev as VscodeRunme
. --source .
```

`ReleaseArtifacts` is the immutable directory containing all six VSIX files.
It validates the tag against the source versions, resolves one stable Runme
kernel release, and builds Linux, macOS, and Windows packages for x64 and arm64.
With no arguments it uses the source package version, the latest stable kernel,
anonymous GitHub API access, and no production telemetry credentials. For a
local edge build, its numeric manifest version defaults to the tag's `X.Y.Z`
core; the GHA noun below supplies the tagged-commit timestamp used in production.

```sh {"name":"ReleaseArtifacts","terminalRows":"30"}
### Exported in runme.dev as ReleaseArtifacts
VscodeRunme | release-artifacts
```

`ReleaseDistribution` materializes that directory without publishing it. Run
`runme run ReleaseDistribution` locally to export the VSIX files.

```sh {"name":"ReleaseDistribution","terminalRows":"30"}
### Exported in runme.dev as ReleaseDistribution
ReleaseArtifacts | export "./dist/release"
```

`ReleaseCandidate` is the local confidence boundary. It builds the same six
artifacts and completes the unit and integration tests, but has no publication
credentials and performs no external writes. Its optional arguments inherit the
same local-friendly defaults as `ReleaseArtifacts`. Run
`runme run ReleaseCandidate` to prove everything up to publication.

```sh {"name":"ReleaseCandidate","terminalRows":"50"}
### Exported in runme.dev as ReleaseCandidate
VscodeRunme | release-candidate | sync
```

`GhaReleaseCandidate` is the GitHub Actions adapter for that same candidate. It
overrides the local defaults with the pushed tag, immutable commit timestamp,
authenticated API access, production telemetry, and test credentials.

```sh {"name":"GhaReleaseCandidate","terminalRows":"50"}
### Exported in runme.dev as GhaReleaseCandidate
VscodeRunme |
  release-candidate \
    --tag "$RELEASE_TAG" \
    --commit-timestamp "$RELEASE_TIMESTAMP" \
    --github-token env://GITHUB_TOKEN \
    --instrumentation-key env://INSTRUMENTATION_KEY \
    --connection-string env://CONNECTION_STR \
    --runme-test-token env://RUNME_TEST_TOKEN
```

`PublishRelease` is the publication noun. It consumes the tested candidate, adds
workload identity and registry credentials, publishes all six targets to the
Visual Studio Marketplace, publishes stable targets to Open VSX, and creates or
verifies the GitHub Release and its assets.

```sh {"name":"PublishRelease","terminalRows":"50"}
### Exported in runme.dev as PublishRelease
VscodeRunme |
  publish-release $(GhaReleaseCandidate) \
    --tag "$RELEASE_TAG" \
    --repository "$GITHUB_REPOSITORY" \
    --github-token env://GITHUB_TOKEN \
    --oidc-request-url "$ACTIONS_ID_TOKEN_REQUEST_URL" \
    --oidc-request-token env://ACTIONS_ID_TOKEN_REQUEST_TOKEN \
    --open-vsx-token env://OPEN_VSX_TOKEN |
  stdout
```

Stable and edge package transformations happen only in Dagger's immutable source
directory. They are never written back to the checkout. Edge tags retain their
SemVer release identity while the extension manifest receives the numeric
version required by the Marketplace. That numeric version is derived from the
tagged commit timestamp, making retries deterministic and preserving the
existing monotonic version scheme.

## GitHub Actions workflow

`GhaRelease` is the thin GitHub Actions adapter called by
`.github/workflows/release.yml`. It verifies that the tagged commit belongs to
`main`, derives the immutable commit timestamp required by edge releases, and
asks Runme to evaluate the Dagger-native `PublishRelease` graph.

```sh {"interpreter":"bash","name":"GhaRelease","promptEnv":"never","terminalRows":"50"}
set -euo pipefail

tag_commit=$(git rev-list -n 1 "$RELEASE_TAG")
git merge-base --is-ancestor "$tag_commit" origin/main
RELEASE_TIMESTAMP=$(git show -s --format=%ct "$tag_commit") runme run PublishRelease
```

## Operator flow

1. Land the intended version change on `main` through a pull request.
2. Confirm the `package.json` and `package-lock.json` versions match.
3. Create one annotated bare tag on that commit.
4. Push only the tag.
5. Verify the GitHub Actions run, six Marketplace targets, GitHub Release, and,
   for stable releases, Open VSX.

Historical dual tags remain untouched. New releases use only the bare tag family.
