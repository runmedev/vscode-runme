---
cwd: ..
runme:
  id: 01HTNVRGFMWZERW6S2CZZ9E990
  version: v3
shell: dagger shell
terminalRows: 16
---

## List available functions

```sh {"excludeFromRunAll":"true","id":"01HTNVRK3AJ2AT8M24TA996RCJ","terminalRows":"15"}
. | .help
```

## Build Kernel Binary

```sh {"id":"01HTQBSZTS5M1HP3GGP4T99PT0","name":"KernelBinary"}
### Exported in runme.dev as KernelBinary
github.com/purpleclay/daggerverse/golang $(git https://github.com/stateful/runme | tag v3.12.2 | tree) |
  build |
  file runme
```

## Build Extension

```sh {"name":"Presetup"}
### Exported in runme.dev as Presetup
git https://github.com/runmedev/vscode-runme |
  head |
  tree |
  file dagger/scripts/presetup.sh
```

```sh {"id":"01HTNZBARHB97RPQPCVQZ7PNRN","name":"Extension"}
### Exported in runme.dev as Extension
github.com/runmedev/vscode-runme |
  with-remote github.com/runmedev/vscode-runme main |
  with-container $(KernelBinary) $(Presetup) |
  build-extension GITHUB_TOKEN |
  export extension.vsix
```
