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
