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
import { Octokit } from 'octokit'

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
   * The extension to perform operations on if different from the source.
   */
  @func()
  extension?: Directory

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
      .linkRelease(containerPlatform, { version: 'latest' })
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

  @func()
  async prebuild(extensionVsix: File): Promise<VscodeRunme> {
    await this.base()

    this.extension = await this.unpackExtension(extensionVsix)
    this.container = this.container.withExec('runme run configureNPM setup'.split(' '))

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

    if (this.extension) {
      const path = '/tmp/runme-test-extension'
      container = container
        .withMountedDirectory(path, this.extension)
        .withEnvVariable('RUNME_TEST_EXTENSION', path)
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
   * @param baseOwner - The GitHub Actions base owner.
   * @param eventName - The GitHub Actions event name.
   * @param forkOwner - The GitHub Actions fork owner.
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

  /**
   * Fetches a Runme release from GitHub and returns a directory with the release assets.
   * @param githubToken Optional GitHub token for authentication
   * @param version Release version to fetch, defaults to 'latest'
   */
  @func()
  async listRelease(githubToken?: Secret, version: string = 'latest'): Promise<Directory> {
    const release = await this.getReleaseByVersion(githubToken, version)
    if (!release) {
      throw new Error('Failed to get release')
    }
    const containerPlatform = await this.defaultPlatform()
    let container = dag.container({ platform: containerPlatform }).from('alpine')
    const releaseDir = `/releases/${version}`
    for (const asset of release.assets) {
      if (!asset.name.endsWith('.vsix')) {
        continue
      }
      container = container.withFile(
        `${releaseDir}/${asset.name}`,
        dag.http(asset.browser_download_url),
      )
    }
    return container.directory(releaseDir)
  }

  /**
   * Fetches a Runme release from GitHub and returns a directory with the uncompressed release files.
   * @param platform Target OS/arch in the format 'os/arch', e.g. 'linux/amd64'
   * @param githubToken Optional GitHub token for authentication
   * @param version Release version to fetch, defaults to 'latest'
   */
  @func()
  async linkRelease(
    platform: string,
    githubToken?: Secret,
    version: string = 'latest',
  ): Promise<File> {
    if (version === 'latest' || version === 'prerelease') {
      const release = await this.getReleaseByVersion(githubToken, version)
      version = release.name
    }

    const [os, arch] = platform.split('/')
    const archMap: Record<string, string> = {
      x86_64: 'x64',
      amd64: 'x64',
      arm64: 'arm64',
      wasm: 'wasm',
    }
    const archName = archMap[arch] || arch
    const filename = `runme-${os}-${archName}-${version}.vsix`
    const releaseDir = await this.listRelease(githubToken, version)

    return releaseDir.file(filename)
  }

  @func()
  async unpackExtension(extensionVsix: File): Promise<Directory> {
    const containerPlatform = await this.defaultPlatform()
    let container = dag
      .container({ platform: containerPlatform })
      .from('alpine')
      .withFile('/tmp/runme-extension.vsix.zip', extensionVsix)
      .withWorkdir('/tmp/')
      .withExec(['unzip', 'runme-extension.vsix.zip'])

    return container.directory('/tmp/extension')
  }

  /**
   * Fetches a GitHub release by version or tag.
   * @param githubToken - Optional GitHub token for authentication
   * @param version - The version to fetch ('latest' or a specific tag)
   * @returns The GitHub release data
   */
  private async getReleaseByVersion(githubToken?: Secret, version: string = 'latest') {
    const octokit = new Octokit({
      auth: githubToken ? await githubToken.plaintext() : undefined,
    })

    const repoParams = {
      owner: 'runmedev',
      repo: 'vscode-runme',
    }

    if (version === 'latest') {
      const { data } = await octokit.rest.repos.getLatestRelease(repoParams)
      return data
    }

    if (version === 'prerelease') {
      const { data } = await octokit.rest.repos.listReleases(repoParams)
      const prereleases = data.filter((release) => release.prerelease)
      return prereleases[0] // Returns the most recent prerelease
    }

    const { data } = await octokit.rest.repos.getReleaseByTag({
      ...repoParams,
      tag: version,
    })

    return data
  }
}
