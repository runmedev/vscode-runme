---
cwd: ..
runme:
  id: 01JMMSSHXM7N70W4KCJ5XGEE2A
  version: v3
shell: dagger shell
terminalRows: 30
---

# Build the Runme VS Code extension (via Dagger)

Initialize the VscodeRunme Dagger module using the local source code.

```sh {"name":"VscodeRunme"}
### Exported in runme.dev as VscodeRunme
. --source .
```

## Pick pre-built Runme kernel binary

The VS Code extension wraps the Runme kernel binary (platform-specific). Let's use the host's platform.

```sh {"interpreter":"bash","promptEnv":"never","terminalRows":"3"}
direnv allow
echo "Building for $TARGET_PLATFORM"
```

If the target platform is not set, reset your Runme session. It's likely that direnv wasn't authorized yet.

The external Dagger module `github.com/runmedev/runme` is linked inside `vscode-runme` dagger.json. This makes it available as `RunmeKernel` in the current module's scope.

```sh {"terminalRows":"14"}
RunmeKernel | list-release --version latest | entries
```

The previous command will list all the available platforms per version. Let's pick the latest version matching the host's platform (i.e. `$TARGET_PLATFORM`).

```sh {"id":"01JMMSSHXM7N70W4KCHTX92MHE","name":"KernelBinary","terminalRows":"12"}
### Exported in runme.dev as KernelBinary
RunmeKernel | link-release --version latest $TARGET_PLATFORM
```

## Build the Extension

Let's tie together above's artifacts via their respective cell names to build the Runme VS Code extension.

```sh {"id":"01JMMSSHXM7N70W4KCJ1N0DVXG","name":"Extension","terminalRows":"15"}
### Exported in runme.dev as Extension
VscodeRunme | build $(KernelBinary)
```

Export the extension to a VSIX file.

```sh {"interpreter":"bash","name":"print-target","terminalRows":"3"}
echo "Exporting extension to $EXTENSION_VSIX"
```

```sh {"name":"ExtensionVsix"}
### Exported in runme.dev as ExtensionVsix
Extension | bundle | export $EXTENSION_VSIX
```

## Testing

First let's run the unit tests. They give us fast feedback.

```sh {"interpreter":"dagger shell --progress=plain","name":"UnitTests"}
### Exported in runme.dev as UnitTests
Extension | unit-test | stdout
```

Then, let's run the end-to-end tests. These require a virtual X server frame buffer which is provided by `xvfb-run` on "native" Linux. These take a good while to finish but mimic extension users closely.

```sh {"name":"IntegrationTests","terminalRows":"37"}
### Exported in runme.dev as IntegrationTests
Extension | integration-test --runme-test-token RUNME_TEST_TOKEN | stdout
```

Inside of GitHub Actions, we pass additional job information into the test suite.

```sh {"interpreter":"dagger shell --progress=plain","name":"GhaIntegrationTests"}
### Exported in runme.dev as GhaIntegrationTests
Extension |
  gha-job $GITHUB_ACTOR $BASE_OWNER $GITHUB_EVENT_NAME $FORK_OWNER |
  integration-test --runme-test-token RUNME_TEST_TOKEN | stdout
```

### Troubleshooting

It's simple to just run a specific integration test spec with the following line. Omit the "tests/e2e" directory.

```sh
Extension |
  integration-test --runme-test-token RUNME_TEST_TOKEN --spec "specs/githubAction.e2e.ts" |
  stdout
```

If they fail, you can re-run them with the `--debug` flag and grab logs and screenshots inside of `/tmp/e2e-logs`.

```sh
Extension | integration-test --debug --runme-test-token RUNME_TEST_TOKEN --spec "specs/githubAction.e2e.ts" |
  directory "logs" |
  export /tmp/e2e-logs
```

### Releases

```sh
. | list-release --version prerelease | entries
```

```sh {"name":"PreReleaseVsix"}
### Exported in runme.dev as PreReleaseVsix
. | link-release --version prerelease $TARGET_PLATFORM
```

```sh {"name":"PreReleaseIntegrationTests"}
### Exported in runme.dev as PreReleaseIntegrationTests
VscodeRunme | prebuild $(PreReleaseVsix) |
  integration-test --runme-test-token RUNME_TEST_TOKEN |
  stdout
```
