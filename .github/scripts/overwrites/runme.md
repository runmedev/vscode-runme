---
cwd: ../../..
---

# Settings Overwrites

Remove panels mostly relevant for development.

```sh {"id":"01J7EZNXTG43WAYRWPFX7MHN7F","interactive":"false","name":"deactivate-panels"}
npm pkg delete "contributes.views.runme[1]" # remove chat
npm pkg delete "contributes.views.runme[1]" # remove search
npm pkg delete "contributes.terminal"
git diff package.json
```

Deactivate smart env store and remove panels.

```sh {"id":"01J7EZQJX1843SKQCRC7P8BHYV","interactive":"false","name":"deactivate-smartenv"}
npm pkg delete "contributes.views[runme-notebook]"
npm pkg delete "contributes.viewsContainers.panel"
npm pkg set "contributes.configuration[0].properties[runme.experiments.smartEnvStore].default=false" --json
git diff package.json
```

Enable smart env store for edge/pre-release.

```sh {"id":"01J7F152F569Z9QXZZEV0CW1Z6","interactive":"false","name":"activate-smartenv"}
npm pkg set "contributes.configuration[0].properties[runme.experiments.smartEnvStore].default=true" --json
git diff package.json
```

### Reset

```sh {"excludeFromRunAll":"true","id":"01J7EZQSG262FMGJAYG1W6Z3EQ"}
git checkout -f package.json
git diff package.json
```
