# Dagger module

The repository's TypeScript Dagger module lives in `dagger/src`, with its engine, SDK, source, and module dependencies declared in [`dagger.json`](../dagger.json).

## Local development

After a fresh checkout, or after changing `dagger.json` or the Dagger version, regenerate the ignored TypeScript SDK bindings through the named target in [`CONTRIBUTING.md`](../CONTRIBUTING.md):

```bash
runme run dagger:develop
```

This runs:

```bash
dagger develop --compat=skip
```

The generated `dagger/sdk` directory provides editor types and autocomplete. Do not commit it.

List the module's available functions with:

```bash
dagger functions
```

## Build pipeline

The executable build and test graph is documented in [`BUILD.md`](BUILD.md). It links the Runme Dagger dependency, builds the extension, and exposes the Runme targets used locally and in CI.

## Release pipeline

The tag-driven release graph is documented in [`RELEASE.md`](RELEASE.md). It
defines the canonical tag contract, builds the six platform-specific artifacts,
gates publication on the production tests, and publishes through Dagger while
GitHub Actions supplies identity and secrets.

### Build environment image

The module starts from `ghcr.io/runmedev/vscode-runme-build-env`, which contains the static operating-system dependencies needed to build and test the extension. [The image workflow](../.github/workflows/build-env-image.yml) builds it for AMD64 and ARM64 from [`docker/vscode-runme-build-env.Dockerfile`](../docker/vscode-runme-build-env.Dockerfile).

The Dockerfile pins the upstream Runme build environment by digest. Dependabot proposes upstream digest changes, and merging one rebuilds the `vscode-runme` image on `main`. The workflow publishes both `latest` and an immutable commit tag and reports the resulting manifest digest in its summary.

After an image update, replace the Dagger module's image reference with the published commit tag and manifest digest, then materialize the base container and run the build and test pipeline before merging the reference change. Keeping the consumed image immutable makes the Dagger cache and rollback behavior deterministic.
