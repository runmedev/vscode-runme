---
runme:
  id: 01HF7VQMH8ESX1EFV4QCBTXB1Y
  version: v3
---

# Contributing to `vscode-runme`

**Thank you for your interest in `vscode-runme`. Your contributions are highly welcome.**

[![](https://badgen.net/badge/Complete/Onboarding/5B3ADF?icon=https://runme.dev/img/logo.svg)](https://runme.dev/api/runme?repository=git%40github.com%3Astateful%2Fvscode-runme.git&fileToOpen=CONTRIBUTING.md)

There are multiple ways of getting involved:

- [Report a bug](#report-a-bug)
- [Suggest a feature](#suggest-a-feature)
- [Contribute code](#contribute-code)

Below are a few guidelines we would like you to follow.
If you need help, please reach out to us by opening an issue.

## Report a bug

Reporting bugs is one of the best ways to contribute. Before creating a bug report, please check that an [issue](/issues) reporting the same problem does not already exist. If there is such an issue, you may add your information as a comment.

To report a new bug you should open an issue that summarizes the bug and set the label to "bug".

If you want to provide a fix along with your bug report: That is great! In this case please send us a pull request as described in section [Contribute Code](#contribute-code).

## Suggest a feature

To request a new feature you should open an [issue](../../issues/new) and summarize the desired functionality and its use case. Set the issue label to "feature".

## Contribute code

This is an outline of what the workflow for code contributions looks like

- Check the list of open [issues](../../issues). Either assign an existing issue to yourself, or
   create a new one that you would like work on and discuss your ideas and use cases.

It is always best to discuss your plans beforehand, to ensure that your contribution is in line with our goals.

- Fork the repository on GitHub
- Create a topic branch from where you want to base your work. This is usually master.
- Open a new pull request, label it `work in progress` and outline what you will be contributing
- Make commits of logical units.
- Make sure you sign-off on your commits `git commit -s -m "adding X to change Y"`
- Write good commit messages (see below).
- Push your changes to a topic branch in your fork of the repository.
- As you push your changes, update the pull request with new infomation and tasks as you complete them
- Project maintainers might comment on your work as you progress
- When you are done, remove the `work in progess` label and ping the maintainers for a review
- Your pull request must receive a :thumbsup: from two [maintainers](MAINTAINERS)

### Prerequisites

To build and work on this project you need to install:

- [Node.js](https://nodejs.org/en/) (v18 or later)
- [NPM](https://www.npmjs.com/package/npm) (latest)

### Check out code

To get the code base, have [git](https://git-scm.com/downloads) installed and run:

```sh {"id":"01HF7VQMH8ESX1EFV4NQ54N42A"}
git clone git@github.com:runmedev/vscode-runme.git
cd vscode-runme
nvm install
```

optionally install jq and the GitHub CLI to streamline downloading binaries:

```sh {"id":"01HF7VQMH8ESX1EFV4NTQPB38T"}
# macOS
$ brew install gh jq
# other platforms: https://github.com/cli/cli#installation
```

the recommended extensions are actually strongly encouraged (otherwise your watcher will hang) - easily install them:

```sh {"id":"01HF7VQMH8ESX1EFV4NXY8HSFJ"}
$ jq -r ".recommendations[]" .vscode/extensions.json \
    | xargs -n 1 code --force --install-extension
```

make sure to configure your local npm to pull from Buf's registry (for GRPC dependencies)

```sh {"id":"01HF7VQMH8ESX1EFV4P0ZCRR37","name":"configureNPM"}
$ npm config set @buf:registry https://buf.build/gen/npm/v1
```

then ensure to install all project dependencies. Note GitHub token is required to auto-dowload the latest `runme` binary. The branch ref name is optional, if it's not `main` pre-release binaries are being considered.

```sh {"id":"01HF7VQMH8ESX1EFV4P491H696","name":"setup","promptEnv":"false"}
$ export GITHUB_REF_NAME=$(git branch --show-current)
$ export GITHUB_TOKEN=$(gh auth token)
$ export EXTENSION_BASENAME=$(node -p 'let p = process.cwd().split("/").pop().split("-"); p[p.length-1]')
$ cp -f "assets/$EXTENSION_BASENAME-icon.gif" "assets/icon.gif"
$ cp -f "assets/$EXTENSION_BASENAME-logo-open-dark.svg" "assets/logo-open-dark.svg"
$ cp -f "assets/$EXTENSION_BASENAME-logo-open-light.svg" "assets/logo-open-light.svg"
$ cp -f "assets/$EXTENSION_BASENAME-logo-sidebar.svg" "assets/logo-sidebar.svg"
$ NODE_OPTIONS='' npm install --include=dev
```

### Dev against Project

Make sure to install all recommended extensions please:

```sh {"id":"01HF7VQMH8ESX1EFV4PAM5E73C","interactive":"false","mimeType":"text/plain"}
cat .vscode/extensions.json | grep -v '\/\/' | jq -r ".recommendations[]" | xargs code --install-extension
```

Then just run the watcher and you're off to the races.

```sh {"background":"true","id":"01HF7VQMH8ESX1EFV4PD922S8P","name":"npm-watch"}
export NODE_OPTIONS="--import=./specifier-register.mjs --max-old-space-size=8192"
npm run watch
```

You can also run the extension in the Extension Development Host, which is a separate VS Code instance, by pressing `F5` or `Ctrl+Shift+D` and then selecting `Run Extension` from the dropdown.

If you want to run the extension against a specific runme kernel binary, you can set this option in .vscode/settings.json:

```sh {"id":"01HT61TNMTK9GB0K8GQFSG43T9"}
{
  "runme.server.binaryPath": "path/to/bin",
}
```

### Upgrade kernel dependencies

To upgrade the kernel gRPC dependencies, you can run the following command. Be sure to release the `runme` kernel binary before a stable merge/release.

```sh {"background":"false","id":"01JAQYD2R3KN63QZ7EC2T2AB58"}
npm install -s "@buf/stateful_runme.community_timostamm-protobuf-ts@latest"
```

### Debug Project

To run the extension in a new Extension Development Host window of VS Code open [src/extension/extension.ts](src/extension/extension.ts) inside VSCode, press `F5` or `Ctrl+Shift+D` and then select `Run Extension` from the dropdown.

### Build Project

To compile all extension files, run:

```sh {"id":"01HF7VQMH8ESX1EFV4PDNTDPTS","name":"build","promptEnv":"no"}
export NODE_OPTIONS="--import=./specifier-register.mjs --max-old-space-size=8192"
npm run build
```

And then package the extension into a .vsix file:

```sh {"id":"01J04FQ8WSEVTDVS05VPZMKAYJ","name":"bundle","promptEnv":"no"}
export NODE_OPTIONS="--import=./specifier-register.mjs --max-old-space-size=8192"
npm run bundle
```

### Test Project

The Runme project has several test stages that you can run individually or as a whole:

```sh {"id":"01HF7VQMH8ESX1EFV4PFZ87Q58","name":"test","promptEnv":"no"}
export NODE_OPTIONS="--import=./specifier-register.mjs --max-old-space-size=8192"
npx runme run test:format test:lint test:unit test:e2e
```

```sh {"id":"01J5VPD3TXY1EAZDCXNHN60S77","promptEnv":"never"}
export NODE_OPTIONS="--import=./specifier-register.mjs --max-old-space-size=8192"
npx runme run test:format test:lint test:unit
```

When testing in CI environment, run:

```sh {"id":"01HF7VQMH8ESX1EFV4PGJBDGG0","name":"test:ci","promptEnv":"no"}
export NODE_OPTIONS="--import=./specifier-register.mjs --max-old-space-size=8192"
npx runme run test:format test:lint test:unit test:e2e:ci
```

#### Code Style Checks

We use [Prettier](https://prettier.io/) to keep the code style consistent:

```sh {"id":"01HF7VQMH8ESX1EFV4PKWHPQG6","name":"test:format"}
npx prettier --check .
```

You can fix any formatting errors via:

```sh {"id":"01HF7VQMH8ESX1EFV4PKXKKCZ2","name":"test:format:fix"}
npx prettier --write .
```

#### Linting

We use [Eslint](https://eslint.org/) for static code analysis:

```sh {"id":"01HF7VQMH8ESX1EFV4PN78YHJV","name":"test:lint"}
npx eslint src tests --ext ts
```

You can fix any linting errors via:

```sh {"id":"01HF7VQMH8ESX1EFV4PQ1YA4G5","name":"test:lint:fix"}
npx eslint src tests --ext ts --fix
```

#### Unit Testing

We use [Vitest](https://vitest.dev/) for running unit tests via:

In case you experience a "Cannot find module '@buf/stateful'" error, it's probably caused because of a nvm cache issue, you can try clearing removing node_modules and reinstalling the dependencies. In case the issue persists, do a fresh clone of the repository. The issue is probably caused by nvm caching the wrong version of the package.

```sh {"id":"01HF7VQMH8ESX1EFV4PT2KN303","name":"test:unit","promptEnv":"no"}
export NODE_OPTIONS="--import=./specifier-register.mjs --max-old-space-size=8192"
npx vitest -c ./vitest.conf.ts --run
```

The test coverage report is easy to access at:

```sh {"id":"01HJVVP86RWEMH7QM80EPK266B","name":"test:report"}
open coverage/lcov-report/index.html
```

#### E2E Testing

We use WebdriverIO to run e2e tests on the VS Code extension:

```sh {"id":"01HF7VQMH8ESX1EFV4PX19FXW0","name":"test:e2e","promptEnv":"never"}
export NODE_OPTIONS="--import=./specifier-register.mjs --max-old-space-size=8192"
npx wdio run ./tests/e2e/wdio.conf.ts
```

#### E2E Testing in CI

The process for testing in CI is a bit more complicated as we try to test closer to the real environment the extension will be executed in. If a user uses Runme, the extension will be shipped with no `node_modules`. Everything is bundled through Webpack including dependencies. Now this can become problematic because if we miss to add the dependency to the `package.json`, Webpack creates a production bundle that won't include that dependency and will fail in the users environment.

```sh {"interactive":"true","name":"test:pipeline","terminalRows":"41"}
runme run UnitTests GhaIntegrationTests
```

Therefore to test in a closer production environment, run:

```sh {"id":"01HF7VQMH8ESX1EFV4PYWC0M3X","name":"test:e2e:ci"}
export NODE_OPTIONS="--import=./specifier-register.mjs --max-old-space-size=8192"
# run reconcile command when previous commands pass or fail
npx runme run test:e2e:ci:setup test:e2e:ci:run; npx runme run test:e2e:ci:reconcile
```

To ensure we run the test close to a real world scenario, e.g. the extension is installed on someones system, we created a process that would rename the `node_modules` directory to ensure the extension is not depending on any dependencies that won't be shipped in a production environment:

```sh {"id":"01HF7VQMH8ESX1EFV4Q0412315","name":"test:e2e:ci:setup"}
mv ./node_modules/ ./.node_modules
# we need to restore Runme to keep running the pipeline
# first make sure we re-install all node deps
mv ./package.json ./.package.json
mv ./package-lock.json ./.package-lock.json
# then install runme again
RUNME_DOWNLOAD_ON_INSTALL=1 NODE_OPTIONS='' npm i runme || true
# restore package.json to allow testing the extension
mv ./.package.json ./package.json
```

For running e2e tests we use a seperate `package.json` which dependencies need to be installed prior.

Then we can run the e2e tests via:

```sh {"id":"01HF7VQMH8ESX1EFV4Q3XXMMX7","name":"test:e2e:ci:run"}
cd ./tests/e2e/
NODE_OPTIONS='' npm ci
npx wdio run ./wdio.conf.ts
```

At the end we reconcile our dev environment by moving all files back to their original place:

```sh {"id":"01HF7VQMH8ESX1EFV4Q5KEQM7Y","name":"test:e2e:ci:reconcile"}
[ -d "./.node_modules/" ] && \
  rm -fr ./node_modules && \
  mv ./.node_modules/ ./node_modules && \
  mv ./.package-lock.json ./package-lock.json
echo "Running test:e2e:reconcile ✅"
```

If you cancel the running test at any time, make sure to run this command before continuing development.

### Commit messages

Your commit messages ideally can answer two questions: what changed and why. The subject line should feature the “what” and the body of the commit should describe the “why”.

When creating a pull request, its description should reference the corresponding issue id.

## Release Project

You can use following Github Actions workflow to release both edge (pre-release) and stable versions of the Runme's VS Code extension. This will package, test, and upon success push a new build of the extension to Microsoft's VS Code marketplace as well as OpenVSX.

```sh {"id":"01HF7VQMH8ESX1EFV4Q8N8Z85Z"}
https://github.com/runmedev/vscode-runme/actions/workflows/release.yml
```

Ensure you pick the correct release type by following the [semantic versioning](https://semver.org/) principle.

---

**Have fun, and happy hacking!**

Thanks for your contributions!
