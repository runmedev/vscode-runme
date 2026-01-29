# [Runme](http://runme.dev) DevOps Notebooks for [Visual Studio Code](https://code.visualstudio.com/) [![Tests](https://github.com/runmedev/vscode-runme/actions/workflows/test.yml/badge.svg)](https://github.com/runmedev/vscode-runme/actions/workflows/test.yml)

Runme offers a robust solution for integrating operational documentation written in Markdown files.
It improves documentation maintainability and team collaboration. Seamlessly incorporate scripting, pipelines, and GitOps methodologies into your infrastructure workflows.

With native support for Helm, Terraform, Ansible, Docker, and SSH, Runme enhances your DevOps toolchain. Utilize Runme's native cloud renderers to access the AWS Console and Google Cloud Console directly within your Notebooks. (More Cloud renderers coming soon!)

## How it works

This VS Code extension transparently opens markdown files (i.e. README.md) as runnable VS Code Notebooks (with the click of a `play` button).
By annotating markdown code blocks, repository maintainers can enrich the interactive, runbook-style experience of their markdown notebooks, all while ensuring they render correctly in markdown viewers. Runme, available as an [open-source](https://docs.runme.dev/open-source) tool, is licensed under APL 2.0.

> 💡 To disable the default opening of the Runme Notebook when accessing Markdown files, you have the option to right-click on the .md file, then select **"Open With..."** and choose your preferred text editor. For a permanent solution, select **"Configure default editor for..."** and make your choice accordingly.".

![Text and notebook view side-by-side](https://runme.dev/img/intro.gif)

## Documentation

Please visit Runme's documentation to learn about its purpose, all its features, and how to get the most out of it:

- [https://docs.runme.dev/](https://docs.runme.dev/)

Feel free to submit any issues you may have via the
[issue tracker](https://github.com/runmedev/vscode-runme/issues) or [tell us about it on Discord](https://discord.gg/runme).

## Guides

Runme integrates with numerous third-party services and tools to simplify your documentation process and enhance your workflow across various domains. So, whether you are working with a cloud provider, setting up infrastructure, handling databases, etc. Runme can help you run and execute your projects, create standard procedures, and provide visibility to other team members.

[Read the official Runme guide](https://docs.runme.dev/guide/)

# Installation

- Search for `runme` in the VS Code marketplace or extensions panel
- Install from the [VS Code marketplace website](https://marketplace.visualstudio.com/items?itemName=stateful.runme)
- Be on the cutting edge and [download the latest release](https://github.com/runmedev/vscode-runme/releases)

Comprehensive install instructions are available in the docs at [https://docs.runme.dev/install](https://docs.runme.dev/install).

# Usage

Once you've cloned a repository in VS Code, open any markdown file to observe that instead of displaying its content directly, it renders a Notebook. Within this Notebook, shell commands and other code sections are presented as runnable blocks. For detailed guidance, refer to Runme's [Getting Started guide](https://docs.runme.dev/getting-started) for step-by-step instructions.

## Configure Cell Execution

Runme allows code blocks to be annotated with attributes to provide control over some aspects of execution, output, interaction, and other behavior. Please find a complete list in the [docs](https://docs.runme.dev/configuration#cell-level-options).

For instance, the following annotation will run the command in the background, great for compilers/bundler with file watchers. To enable or disable any of the available options just click the respective cell's `Configure` button.

    ```sh { background=true }
    npx tsc --watch
    ```

## Configure Document-level Execution

Runme does not just retain frontmatter, it supports top-level settings that will affect all cells in the document.

```sh {"id":"01HF7B0KK8DED9E3ZYTXMMAQFJ"}
---
shell: bash
# or
shell: zsh
# or
shell: /bin/ksh
---
```

Check the complete list of configuration options at https://docs.runme.dev/configuration or take a look at the [examples](https://github.com/runmedev/vscode-runme/tree/main/examples) which are also illustrated in [Runme's integration docs](https://docs.runme.dev/integrations).

## Frequently Asked Questions

Chances are, you're not the first trailblazer to wander through here – someone might have already asked that burning question of yours, and we've got it covered. But hey, you might just be the pioneer with a fresh perspective! So feel free to ask away – your question could be the start of something new, and we're all ears! [Checkout out our official FAQ](https://docs.runme.dev/faq)

## Let Us Know What You Think

Runme is under active development. Please be aware of following known limitations:

- Only shell is currently supported on macOS, Linux, and Windows ([WSL](https://code.visualstudio.com/docs/remote/wsl)). PowerShell is not supported yet
- Be aware of edge cases. Let us know when you hit any snags. We appreciate it!

We would love to hear feedback, appreciate your patience, as Runme continutes to harden. Get in touch please!

- [Join our Discord](https://discord.gg/runme)
- [Submit an Issue](https://github.com/stateful/runme/issues)
- [Contribute on GitHub](https://github.com/runmedev/vscode-runme/blob/main/CONTRIBUTING.md)
- [Read the Docs](https://docs.runme.dev/)

## Code of Conduct

This project follows the [CNCF Code of Conduct](https://github.com/cncf/foundation/blob/main/code-of-conduct.md). See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) for details.
