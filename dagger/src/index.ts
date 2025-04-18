/**
 * Build the Runme VS Code extension end-to-end.
 *
 */

import {
  Platform,
  dag,
  Container,
  File,
  Directory,
  object,
  func,
  ReturnType,
  Secret,
} from '@dagger.io/dagger'

@object()
export class VscodeRunme {
  /**
   * The source to build the extension from.
   */
  @func()
  source?: Directory

  /**
   * The container to build the extension in.
   */
  @func()
  container?: Container

  /**
   * The presetup script to be added to the container.
   */
  @func()
  presetup?: File

  constructor(source?: Directory) {
    if (!source) {
      source = dag.git('https://github.com/runmedev/vscode-runme.git').tag('main').tree()
    }
    this.source = source
    this.presetup = source.file('dagger/scripts/presetup.sh')
  }

  /**
   * Get the default platform for the container.
   * @returns The default platform.
   */
  @func()
  defaultPlatform(): Promise<Platform> {
    return dag.defaultPlatform()
  }

  /**
   * Sets up the base container
   * @returns The modified VscodeRunme instance.
   */
  @func()
  async base(): Promise<VscodeRunme> {
    if (this.container) {
      return this
    }

    const containerPlatform = await this.defaultPlatform()
    const binary = dag
      .runmeKernel()
      .releaseFiles(containerPlatform, { version: 'latest' })
      .file('runme')

    this.container = dag
      .container({ platform: containerPlatform })
      .from('ghcr.io/runmedev/runme-build-env:latest')

      // CI/CD-related config
      .withEnvVariable('DO_NOT_TRACK', '1')
      .withEnvVariable('DAGGER_BUILD', '1')
      .withEnvVariable('CI', '1')
      .withEnvVariable('SHELL', 'bash')
      .withEnvVariable('EXTENSION_NAME', 'runme')

      .withFile('/usr/local/bin/runme', binary)
      .withFile('/usr/local/bin/presetup', this.presetup)
      .withEntrypoint([])
      .withMountedDirectory('/mnt/vscode-runme', this.source)
      .withWorkdir('/mnt/vscode-runme')
      .withExec('bash /usr/local/bin/presetup'.split(' '))

    return this
  }

  /**
   * Builds the VSIX extension file.
   * @param runmeBinary - The runme binary to be added to the container.
   * @returns The modified VscodeRunme instance.
   */
  @func()
  async build(runmeBinary: Directory): Promise<VscodeRunme> {
    await this.base()

    this.container = this.container
      .withMountedDirectory('/mnt/vscode-runme/bin', runmeBinary)
      .withExec('runme run configureNPM setup build'.split(' '))

    return this
  }

  /**
   * Bundles the VSIX extension file.
   * @returns The modified VscodeRunme instance.
   */
  @func()
  async bundle(): Promise<File> {
    await this.base()

    return this.container.withExec('runme run bundle'.split(' ')).file('runme-extension.vsix')
  }

  /**
   * Runs the unit tests.
   * @param runmeBinary - The runme binary to be added to the container.
   * @param debug - Whether to run the tests in debug mode.
   * @param spec - The spec file to run.
   * @returns Returns the container running the tests.
   */
  @func()
  async unitTest(debug = false): Promise<Container> {
    await this.base()

    const expect = debug ? ReturnType.Any : ReturnType.Success

    return this.container.withExec('runme run test:unit'.split(' '), { expect })
  }

  /**
   * Integration tests the extension end-to-end.
   * @param runmeTestToken - The Runme test token to use for integration tests.
   * @param debug - Whether to run the tests in debug mode.
   * @param spec - The spec file to run, omit "tests/e2e".
   * @returns Returns the container running the tests.
   */
  @func()
  async integrationTest(runmeTestToken?: Secret, debug = false, spec?: string): Promise<Container> {
    await this.base()

    const e2eTestCommand = ['xvfb-run', 'npx wdio run ./wdio.conf.ts']
    if (spec && spec.length > 0) {
      e2eTestCommand.push(...['--spec', spec])
    }

    const expect = debug ? ReturnType.Any : ReturnType.Success

    let container = this.container
    if (runmeTestToken) {
      // GitHub Actions-integration e2e tests
      container = container.withSecretVariable('RUNME_TEST_TOKEN', runmeTestToken)
    }

    return (
      container
        // Run e2e tests exclusively from bundle not source/dependencies
        .withExec('rm -rf node_modules'.split(' '))
        .withWorkdir('tests/e2e')
        .withExec('npm ci'.split(' '))
        .withExec(e2eTestCommand.join(' ').split(' '), { expect })
    )
  }

  /**
   * Sets the GitHub Actions job info.
   * @param actor - The GitHub Actions actor.
   * @param eventName - The GitHub Actions event name.
   * @param forkOwner - The GitHub Actions fork owner.
   * @param baseOwner - The GitHub Actions base owner.
   * @returns The modified VscodeRunme instance.
   */
  @func()
  async ghaJob(
    actor: string,
    baseOwner: string,
    eventName: string,
    forkOwner: string,
  ): Promise<VscodeRunme> {
    await this.base()

    // GitHub Actions metadata only for internal PRs
    this.container = this.container
      .withEnvVariable('BASE_OWNER', baseOwner)
      .withEnvVariable('FORK_OWNER', forkOwner)
      .withEnvVariable('GITHUB_ACTOR', actor)
      .withEnvVariable('GITHUB_EVENT_NAME', eventName)

    return this
  }
}
