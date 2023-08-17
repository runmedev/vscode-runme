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

```sh
git clone git@github.com:stateful/vscode-runme.git
cd vscode-runme
nvm install
```

optionally install jq and the GitHub CLI to streamline downloading binaries:

```sh
# macOS
$ brew install gh jq
# other platforms: https://github.com/cli/cli#installation
```

the recommended extensions are actually strongly encouraged (otherwise your watcher will hang) - easily install them:

```sh
$ jq -r ".recommendations[]" .vscode/extensions.json \
    | xargs -n 1 code --force --install-extension
```

make sure to configure your local npm to pull from Buf's registry (for GRPC dependencies)

```sh { name=configureNPM }
$ npm config set @buf:registry https://buf.build/gen/npm/v1
```

then ensure to install all project dependencies. Note GitHub token is required to auto-dowload the latest `runme` binary. The branch ref name is optional, if it's not `main` pre-release binaries are being considered.

```sh { name=setup promptEnv=false }
$ export GITHUB_REF_NAME=$(git branch --show-current)
$ export GITHUB_TOKEN=$(gh auth token)
$ npm install --include=dev
```

Similarly a Runme WASM binary needs to be downloaded. If an error happened follow the error instructions and re-run the download, via:

```sh { interactive=true promptEnv=false }
$ export GITHUB_REF_NAME=$(git branch --show-current)
$ GITHUB_TOKEN=$(gh auth token) npm run download:wasm
$ npm run prepare-binary -- -f tar
```

### Dev against Project

Make sure to install all recommended extensions please:

```sh { interactive=false mimeType=text/plain }
cat .vscode/extensions.json | grep -v '\/\/' | jq -r ".recommendations[]" | xargs code --install-extension
```

Then just run the watcher and you're off to the races.

```sh { name=npm-watch background=true }
npm run watch
```

### Build Project

To compile all extension files, run:

```sh { name=build }
npm run build
```

### Test Project

The Runme project has several test stages that you can run individually or as a whole:

```sh { name=test }
npx runme run test:format test:lint test:unit test:e2e
```

#### Code Style Checks

We use [Prettier](https://prettier.io/) to keep the code style consistent:

```sh { name=test:format }
npx prettier --check .
```

You can fix any formatting errors via:

```sh { name=test:format:fix }
npx prettier --write .
```

#### Linting

We use [Eslint](https://eslint.org/) for static code analysis:

```sh { name=test:lint }
npx eslint src tests --ext ts
```

You can fix any linting errors via:

```sh { name=test:lint:fix }
eslint src tests --ext ts --fix
```

#### Unit Testing

We use [Vitest](https://vitest.dev/) for running unit tests via:

```sh { name=test:unit }
npx vitest -c ./vitest.conf.ts --run
```

#### E2E Testing

We use WebdriverIO to run e2e tests on the VS Code extension:

```sh { name=test:e2e }
# run reconcile command when previous commands pass or fail
npx runme run test:e2e:setup test:e2e:run || npx runme run test:e2e:reconcile
```

To ensure we run the test close to a real world scenario, e.g. the extension is installed on someones system, we created a process that would rename the `node_modules` directory to ensure the extension is not depending on any dependencies that won't be shipped in a production environment:

```sh { name=test:e2e:setup }
mv ./node_modules/ ./.node_modules
# we need to restore Runme to keep running the pipeline
# first make sure we re-install all node deps
mv ./package.json ./.package.json
# then install runme again
RUNME_DOWNLOAD_ON_INSTALL=1 npm i runme
# restore package.json to allow testing the extension
mv ./.package.json ./package.json
```

For running e2e tests we use a seperate `package.json` which dependencies need to be installed prior.

Then we can run the e2e tests via:

```sh { name=test:e2e:run }
cd ./tests/e2e/
npm ci
npx wdio run ./wdio.conf.ts
```

At the end we reconcile our dev environment by moving all files back to their original place:

```sh { name=test:e2e:reconcile }
[ -d "./.node_modules/" ] && rm -fr ./node_modules && mv ./.node_modules/ ./node_modules
```

If you cancel the running test at any time, make sure to run this command before continuing development.

### Release

```sh
https://github.com/stateful/vscode-runme/actions/workflows/release.yml
```

### Commit messages

Your commit messages ideally can answer two questions: what changed and why. The subject line should feature the “what” and the body of the commit should describe the “why”.

When creating a pull request, its description should reference the corresponding issue id.

## Release Project

Contributor with push access to this repo can at any time make a release. To do so, just trigger the [GitHub Action](https://github.com/stateful/vscode-runme/actions?query=workflow%3A%22Manual+NPM+Publish%22) that releases the package. Ensure you pick the correct release type by following the [semantic versioning](https://semver.org/) principle.

---

**Have fun, and happy hacking!**

Thanks for your contributions!
