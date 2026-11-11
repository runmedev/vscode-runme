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
import {
  assertSourceVersion,
  parseReleaseTag,
  releaseArtifactName,
  releaseTargets,
} from './release.js'

@object()
export class VscodeRunme {
  /**
   * The source to build the extension from.
   */
  @func()
  source: Directory

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
  presetup: File

  constructor(source?: Directory) {
    if (!source) {
      source = dag.git('https://github.com/runmedev/vscode-runme.git').branch('main').tree()
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
  async base(githubToken?: Secret): Promise<VscodeRunme> {
    if (this.container) {
      return this
    }

    const containerPlatform = await this.defaultPlatform()
    const binary = dag
      .runme()
      .linkRelease(containerPlatform, { githubToken, version: 'latest' })
      .file('runme')

    let container = dag
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

    if (githubToken) {
      container = container.withSecretVariable('GITHUB_TOKEN', githubToken)
    }

    this.container = container

    return this
  }

  private async baseContainer(githubToken?: Secret): Promise<Container> {
    await this.base(githubToken)
    if (!this.container) {
      throw new Error('Failed to initialize the base container')
    }
    return this.container
  }

  /**
   * Builds the VSIX extension file.
   * @param runmeBinary - The runme binary to be added to the container.
   * @returns The modified VscodeRunme instance.
   */
  @func()
  async build(
    runmeBinary: Directory,
    githubToken?: Secret,
    instrumentationKey?: Secret,
    connectionString?: Secret,
  ): Promise<VscodeRunme> {
    let container = await this.baseContainer(githubToken)

    if (instrumentationKey) {
      container = container.withSecretVariable('INSTRUMENTATION_KEY', instrumentationKey)
    }
    if (connectionString) {
      container = container.withSecretVariable('CONNECTION_STR', connectionString)
    }

    this.container = container
      .withMountedDirectory('/mnt/vscode-runme/bin', runmeBinary)
      .withExec('runme run configureNPM setup build'.split(' '))

    return this
  }

  @func()
  async prebuild(extensionVsix: File): Promise<VscodeRunme> {
    const container = await this.baseContainer()

    this.extension = await this.unpackExtension(extensionVsix)
    this.container = container.withExec('runme run configureNPM setup'.split(' '))

    return this
  }

  /**
   * Bundles the VSIX extension file.
   * @returns The modified VscodeRunme instance.
   */
  @func()
  async bundle(
    target?: string,
    preRelease: boolean = true,
    output: string = 'runme-extension.vsix',
  ): Promise<File> {
    const container = await this.baseContainer()

    const command = [
      'npx',
      'vsce',
      'package',
      '--no-yarn',
      '--no-git-tag-version',
      '--no-update-package-json',
      '-o',
      output,
    ]
    if (target) {
      command.push('-t', target)
    }
    if (preRelease) {
      command.push('--pre-release')
    }

    return container.withExec(command).file(output)
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
    const container = await this.baseContainer()

    const expect = debug ? ReturnType.Any : ReturnType.Success

    return container.withExec('runme run test:unit'.split(' '), { expect })
  }

  /**
   * Integration tests the extension end-to-end.
   * @param runmeTestToken - The Runme test token to use for integration tests.
   * @param debug - Whether to run the tests in debug mode.
   * @param spec - The spec file to run, omit "tests/e2e".
   * @returns Returns the container running the tests.
   */
  @func()
  async integrationTest(
    runmeTestToken?: Secret,
    debug = false,
    spec?: string,
    vscodeVersion?: string,
  ): Promise<Container> {
    let container = await this.baseContainer()

    const e2eTestCommand = ['xvfb-run', 'npx wdio run ./wdio.conf.ts']
    if (spec && spec.length > 0) {
      e2eTestCommand.push(...['--spec', spec])
    }

    const expect = debug ? ReturnType.Any : ReturnType.Success
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

    if (vscodeVersion) {
      container = container.withEnvVariable('RUNME_TEST_VSCODE_VERSION', vscodeVersion)
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
   * @param specRetries - The number of retries for the spec.
   * @returns The modified VscodeRunme instance.
   */
  @func()
  async ghaJob(
    actor: string,
    baseOwner: string,
    eventName: string,
    forkOwner: string,
    specRetries: number = 3,
  ): Promise<VscodeRunme> {
    const container = await this.baseContainer()

    // GitHub Actions metadata only for internal PRs
    this.container = container
      .withEnvVariable('BASE_OWNER', baseOwner)
      .withEnvVariable('FORK_OWNER', forkOwner)
      .withEnvVariable('GITHUB_ACTOR', actor)
      .withEnvVariable('GITHUB_EVENT_NAME', eventName)
      // retry more aggressively in GHA
      .withEnvVariable('RUNME_TEST_SPEC_RETRIES', specRetries.toString())

    return this
  }

  /**
   * Build every platform-specific VSIX for a canonical release tag without publishing.
   * @param tag Canonical bare release tag; defaults to the source package version.
   * @param commitTimestamp Optional tagged-commit timestamp for production edge Marketplace versions.
   * @param githubToken Optional GitHub token used to avoid anonymous API rate limits.
   * @param instrumentationKey Optional Application Insights instrumentation key.
   * @param connectionString Optional Application Insights connection string.
   * @param runmeVersion Optional Runme kernel version; defaults to the latest stable release.
   */
  @func()
  async releaseArtifacts(
    tag?: string,
    commitTimestamp?: number,
    githubToken?: Secret,
    instrumentationKey?: Secret,
    connectionString?: Secret,
    runmeVersion?: string,
  ): Promise<Directory> {
    const sourcePackage = JSON.parse(await this.source.file('package.json').contents())
    const sourceLockfile = JSON.parse(await this.source.file('package-lock.json').contents())
    const releaseTag = tag ?? sourcePackage.version
    const metadata = parseReleaseTag(releaseTag, commitTimestamp)
    assertSourceVersion(releaseTag, sourcePackage.version, sourceLockfile.packages?.['']?.version)

    const releaseSource = this.prepareReleaseSource(metadata.channel, metadata.marketplaceVersion)
    const resolvedRunmeVersion = runmeVersion ?? (await this.latestRunmeVersion(githubToken))
    let artifacts = dag.directory()

    for (const target of releaseTargets) {
      const kernel = await this.runmeKernel(
        target.kernelPlatform,
        resolvedRunmeVersion,
        githubToken,
      )
      const builder = new VscodeRunme(releaseSource)
      await builder.build(kernel, githubToken, instrumentationKey, connectionString)

      const artifactName = releaseArtifactName(sourcePackage.name, target.vsceTarget, releaseTag)
      const artifact = await builder.bundle(
        target.vsceTarget,
        metadata.channel === 'edge',
        artifactName,
      )
      artifacts = artifacts.withFile(artifactName, artifact)
    }

    return artifacts
  }

  /**
   * Build and test a release candidate without publishing it.
   * @param tag Canonical bare release tag; defaults to the source package version.
   * @param commitTimestamp Optional tagged-commit timestamp for production edge Marketplace versions.
   * @param githubToken Optional GitHub token used to avoid anonymous API rate limits.
   * @param instrumentationKey Optional Application Insights instrumentation key.
   * @param connectionString Optional Application Insights connection string.
   * @param runmeTestToken Optional token used by the integration test suite.
   * @param runmeVersion Optional Runme kernel version; defaults to the latest stable release.
   */
  @func()
  async releaseCandidate(
    tag?: string,
    commitTimestamp?: number,
    githubToken?: Secret,
    instrumentationKey?: Secret,
    connectionString?: Secret,
    runmeTestToken?: Secret,
    runmeVersion?: string,
  ): Promise<Directory> {
    const sourcePackage = JSON.parse(await this.source.file('package.json').contents())
    const sourceLockfile = JSON.parse(await this.source.file('package-lock.json').contents())
    const releaseTag = tag ?? sourcePackage.version
    const metadata = parseReleaseTag(releaseTag, commitTimestamp)
    assertSourceVersion(releaseTag, sourcePackage.version, sourceLockfile.packages?.['']?.version)

    const resolvedRunmeVersion = runmeVersion ?? (await this.latestRunmeVersion(githubToken))
    const artifacts = await this.releaseArtifacts(
      releaseTag,
      commitTimestamp,
      githubToken,
      instrumentationKey,
      connectionString,
      resolvedRunmeVersion,
    )
    const testMarker = await this.releaseTestMarker(
      metadata.channel,
      metadata.marketplaceVersion,
      githubToken,
      instrumentationKey,
      connectionString,
      runmeTestToken,
      resolvedRunmeVersion,
    )

    return artifacts.withFile('.release-tests-passed', testMarker)
  }

  /**
   * Publish an already-built and tested release candidate.
   * @param candidate Release candidate returned by releaseCandidate.
   * @param tag Canonical bare release tag (X.Y.Z or X.Y.Z-edge.N).
   * @param repository GitHub repository in owner/name form.
   * @param githubToken GitHub token for publication.
   * @param oidcRequestUrl GitHub Actions OIDC request URL.
   * @param oidcRequestToken GitHub Actions OIDC request token.
   * @param openVsxToken Open VSX token used for stable releases.
   */
  @func()
  async publishRelease(
    candidate: Directory,
    tag: string,
    repository: string,
    githubToken: Secret,
    oidcRequestUrl: string,
    oidcRequestToken: Secret,
    openVsxToken: Secret,
  ): Promise<Container> {
    const metadata = parseReleaseTag(tag)
    const testMarker = candidate.file('.release-tests-passed')
    const artifacts = candidate.withoutFile('.release-tests-passed')
    const releaseSource = this.prepareReleaseSource(metadata.channel, metadata.marketplaceVersion)
    const publisher = new VscodeRunme(releaseSource)
    let container = (await publisher.baseContainer(githubToken))
      .withExec('runme run configureNPM setup'.split(' '))
      .withDirectory('/tmp/release', artifacts)
      .withFile('/tmp/release-tests-passed', testMarker)
      .withEnvVariable('ACTIONS_ID_TOKEN_REQUEST_URL', oidcRequestUrl)
      .withSecretVariable('ACTIONS_ID_TOKEN_REQUEST_TOKEN', oidcRequestToken)
      .withEnvVariable('GITHUB_ACTIONS', 'true')
      .withSecretVariable('GH_TOKEN', githubToken)
      .withEnvVariable('RELEASE_CHANNEL', metadata.channel)
      .withEnvVariable('RELEASE_REPOSITORY', repository)
      .withEnvVariable('RELEASE_TAG', tag)

    if (metadata.channel === 'stable') {
      container = container.withSecretVariable('OVSX_PAT', openVsxToken)
    }

    for (const target of releaseTargets) {
      const artifactName = releaseArtifactName('runme', target.vsceTarget, tag)
      const artifactPath = `/tmp/release/${artifactName}`
      const marketplaceCommand = [
        'npx',
        'vsce',
        'publish',
        '--packagePath',
        artifactPath,
        '--no-yarn',
        '--oidc',
        '--skip-duplicate',
      ]
      if (metadata.channel === 'edge') {
        marketplaceCommand.push('--pre-release')
      }
      container = container.withExec(marketplaceCommand)

      if (metadata.channel === 'stable') {
        container = container.withExec([
          'npm',
          'exec',
          '--yes',
          '--package=ovsx@1.4.0',
          '--',
          'ovsx',
          'publish',
          artifactPath,
          '--skip-duplicate',
        ])
      }
    }

    return container.withExec(['bash', 'dagger/scripts/publish-github-release.sh'])
  }

  private prepareReleaseSource(channel: string, marketplaceVersion: string): Directory {
    return dag
      .container({ platform: 'linux/amd64' as Platform })
      .from('node:22-bookworm-slim')
      .withDirectory('/src', this.source.withoutDirectory('tls').withoutFile('.git'))
      .withWorkdir('/src')
      .withExec(['node', 'dagger/scripts/prepare-release.mjs', channel, marketplaceVersion])
      .directory('/src')
  }

  private async releaseTestMarker(
    channel: string,
    marketplaceVersion: string,
    githubToken: Secret | undefined,
    instrumentationKey: Secret | undefined,
    connectionString: Secret | undefined,
    runmeTestToken: Secret | undefined,
    runmeVersion: string,
  ): Promise<File> {
    const releaseSource = this.prepareReleaseSource(channel, marketplaceVersion)
    const kernel = await this.runmeKernel('linux/amd64', runmeVersion, githubToken)
    const builder = new VscodeRunme(releaseSource)
    await builder.build(kernel, githubToken, instrumentationKey, connectionString)

    const unitMarker = (await builder.unitTest())
      .withExec(['touch', '/tmp/release-unit-tests-passed'])
      .file('/tmp/release-unit-tests-passed')

    return (await builder.integrationTest(runmeTestToken))
      .withFile('/tmp/release-unit-tests-passed', unitMarker)
      .withExec(['touch', '/tmp/release-tests-passed'])
      .file('/tmp/release-tests-passed')
  }

  private async latestRunmeVersion(githubToken?: Secret): Promise<string> {
    const octokit = new Octokit({ auth: githubToken ? await githubToken.plaintext() : undefined })
    const { data } = await octokit.rest.repos.getLatestRelease({
      owner: 'runmedev',
      repo: 'runme',
    })
    return data.tag_name
  }

  private async runmeKernel(
    platform: string,
    version: string,
    githubToken?: Secret,
  ): Promise<Directory> {
    if (!platform.startsWith('windows/')) {
      return dag.runme().linkRelease(platform as Platform, { githubToken, version })
    }

    const architecture = platform.endsWith('/arm64') ? 'arm64' : 'x86_64'
    const assetName = `runme_windows_${architecture}.zip`
    const octokit = new Octokit({
      auth: githubToken ? await githubToken.plaintext() : undefined,
    })
    const { data } = await octokit.rest.repos.getReleaseByTag({
      owner: 'runmedev',
      repo: 'runme',
      tag: version,
    })
    const asset = data.assets.find(({ name }: { name: string }) => name === assetName)
    if (!asset) {
      throw new Error(`Runme ${version} does not contain ${assetName}`)
    }

    const archive = dag.http(asset.browser_download_url)
    const extracted = dag
      .container({ platform: 'linux/amd64' as Platform })
      .from('alpine:3.22')
      .withExec(['apk', 'add', '--no-cache', 'unzip'])
      .withFile('/tmp/runme.zip', archive)
      .withWorkdir('/tmp/release')
      .withExec(['unzip', '/tmp/runme.zip'])

    return dag.directory().withFile('runme.exe', extracted.file('/tmp/release/runme.exe'))
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
    if (!os || !arch) {
      throw new Error(`Invalid platform ${platform}; expected os/arch`)
    }
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
      const prereleases = data.filter((release: { prerelease: boolean }) => release.prerelease)
      return prereleases[0] // Returns the most recent prerelease
    }

    const { data } = await octokit.rest.repos.getReleaseByTag({
      ...repoParams,
      tag: version,
    })

    return data
  }
}
