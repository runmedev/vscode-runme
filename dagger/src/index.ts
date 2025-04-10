/* eslint-disable max-len */
/**
 * Build the Runme VS Code extension end-to-end.
 *
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Platform, dag, Container, File, Directory, object, func, Secret } from '@dagger.io/dagger'
import * as os from 'os'
@object()
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export class VscodeRunme {
  /**
   * The source to build the extension from.
   */
  @func()
  source?: Directory

  /**
   * The presetup script to be added to the container.
   */
  @func()
  presetup?: File

  constructor(source?: Directory) {
    if (!source) {
      source = dag.git('https://github.com/runmedev/vscode-runme.git').tag("main").tree()
    }
    this.source = source
    this.presetup = source.file('dagger/scripts/presetup.sh')
  }

  /**
   * Sets up the container for the VscodeRunme instance.
   * @param binary - Optional kernel binary file to be added to the container.
   * @param presetup - Optional presetup (for dependencies) file to be added to the container.
   * @returns The modified VscodeRunme instance.
   */
  @func()
  container(): Container {
    const arch = os.arch() === 'x64' ? 'amd64' : 'arm64'
    const containerPlatform = `linux/${arch}` as Platform
    const binary = dag.runme().releaseFiles(containerPlatform, { version: 'latest' }).file('runme')

    return dag
      .container({ platform: containerPlatform })
      .from('node:20')
      .withEnvVariable('DAGGER_BUILD', '1')
      .withEnvVariable('EXTENSION_NAME', 'runme')
      .withFile('/usr/local/bin/runme', binary)
      .withFile('/usr/local/bin/presetup', this.presetup)
      .withEntrypoint([])
      .withMountedDirectory('/mnt/vscode-runme', this.source)
      .withWorkdir('/mnt/vscode-runme')
      .withExec('bash /usr/local/bin/presetup'.split(' '))
  }

  /**
   * Builds the VSIX extension file.
   * @returns The packaged VSIX extension file.
   */
  @func()
  async build(runmeRelease: Directory): Promise<File> {
    return this.container()
      .withMountedDirectory('/mnt/vscode-runme/bin', runmeRelease)
      .withExec('runme run setup build bundle'.split(' '))
      .file('runme-extension.vsix')
  }
}
