import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import {
  assertSourceVersion,
  parseGitCommitTimestamp,
  parseGitHubRepository,
  parseReleaseTag,
  publicationCommand,
  RELEASE_PUBLICATION_ENABLED,
  releaseArtifactName,
  releaseTargets,
  resolveReleaseTagCommit,
} from '../../dagger/src/release'

describe('Dagger release policy', () => {
  it('exposes the release graph as named Dagger Shell nouns', () => {
    const notebook = readFileSync('dagger/RELEASE.md', 'utf8')
    const moduleSource = readFileSync('dagger/src/index.ts', 'utf8')
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8')

    expect(notebook).toContain('shell: dagger shell --progress=plain')
    expect(notebook).toContain('"name":"ReleaseArtifacts"')
    expect(notebook).toContain('"name":"ReleaseDistribution"')
    expect(notebook).toContain('"name":"ReleaseCandidate"')
    expect(notebook).toContain('"name":"GhaReleaseCandidate"')
    expect(notebook).toContain('"name":"PublishRelease"')
    expect(notebook).toContain('"name":"GhaRelease"')
    expect(notebook).toContain('publish-release $(GhaReleaseCandidate)')
    expect(notebook).toContain('gha-release-candidate')
    expect(notebook).toContain('gha-release')
    expect(notebook).not.toContain('git tag --points-at')
    expect(notebook).not.toContain('grep -E')
    expect(moduleSource).toContain('async ghaRelease(')
    expect(moduleSource).toContain('[NOOP] Release tag')
    expect(moduleSource).not.toContain('must be annotated')
    expect(notebook).not.toContain('"name":"release:pipeline"')
    expect(notebook).not.toContain('dagger call')
    expect(workflow).toContain('workflows: GhaRelease')
    expect(workflow).toContain('workflow_run:')
    expect(workflow).toContain('- Pipeline')
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'")
    expect(workflow).toContain('ref: ${{ github.event.workflow_run.head_sha }}')
    expect(workflow).not.toContain('actions: read')
    expect(workflow).not.toContain('tags:')
    expect(workflow).not.toContain('workflows: release:pipeline')
    expect(workflow).not.toContain('RUNME_TEST_TOKEN')
    expect(moduleSource).not.toContain('releaseTestMarker')
    expect(moduleSource).not.toContain('.release-tests-passed')
  })

  it('parses a GitHub repository for the GHA adapter', () => {
    expect(parseGitHubRepository('runmedev/vscode-runme')).toEqual({
      owner: 'runmedev',
      repo: 'vscode-runme',
    })
    expect(() => parseGitHubRepository('runmedev')).toThrow('expected owner/name')
    expect(() => parseGitHubRepository('runmedev/vscode-runme/extra')).toThrow(
      'expected owner/name',
    )
  })

  it('converts a GitHub commit date to a Unix timestamp', () => {
    expect(parseGitCommitTimestamp('2026-11-11T23:26:59Z')).toBe(1_794_439_619)
    expect(() => parseGitCommitTimestamp(undefined)).toThrow('GitHub commit timestamp')
    expect(() => parseGitCommitTimestamp('not-a-date')).toThrow('GitHub commit timestamp')
  })

  it('resolves lightweight and annotated release tags to their commits', () => {
    expect(resolveReleaseTagCommit('3.18.0', { sha: 'lightweight-sha', type: 'commit' })).toBe(
      'lightweight-sha',
    )
    expect(
      resolveReleaseTagCommit(
        '3.18.0',
        { sha: 'tag-object-sha', type: 'tag' },
        { sha: 'annotated-target-sha', type: 'commit' },
      ),
    ).toBe('annotated-target-sha')
    expect(() => resolveReleaseTagCommit('3.18.0', { sha: 'tree-sha', type: 'tree' })).toThrow(
      'unsupported tree',
    )
  })

  it('enables publication by default and supports explicit simulation', () => {
    const command = ['npx', 'vsce', 'publish', '--packagePath', '/tmp/release/runme.vsix']

    expect(RELEASE_PUBLICATION_ENABLED).toBe(true)
    expect(publicationCommand(command, 'Visual Studio Marketplace: runme.vsix')).toEqual(command)
    expect(publicationCommand(command, 'Visual Studio Marketplace: runme.vsix', false)).toEqual([
      'printf',
      '%s\n',
      '[SIMULATION] Visual Studio Marketplace: runme.vsix',
    ])
    expect(publicationCommand(command, 'ignored', true)).toEqual(command)
  })

  it('parses a stable bare tag', () => {
    expect(parseReleaseTag('3.18.0')).toEqual({
      channel: 'stable',
      marketplaceVersion: '3.18.0',
      version: '3.18.0',
    })
  })

  it('maps an edge tag to a deterministic numeric Marketplace version', () => {
    expect(parseReleaseTag('3.18.1-edge.4', 1_794_424_000)).toEqual({
      channel: 'edge',
      marketplaceVersion: '3.18.1794424000',
      version: '3.18.1-edge.4',
    })
  })

  it.each(['v3.18.0', '3.18', '3.18.0-beta.1', '03.18.0', '3.018.0', '3.18.00', '3.18.0-edge.01'])(
    'rejects noncanonical tag %s',
    (tag) => {
      expect(() => parseReleaseTag(tag, 1_794_424_000)).toThrow('Invalid release tag')
    },
  )

  it('uses the numeric source version for local edge artifacts by default', () => {
    expect(parseReleaseTag('3.18.1-edge.0')).toEqual({
      channel: 'edge',
      marketplaceVersion: '3.18.1',
      version: '3.18.1-edge.0',
    })
  })

  it('rejects an invalid production timestamp for edge tags', () => {
    expect(() => parseReleaseTag('3.18.1-edge.0', 0)).toThrow('tagged-commit timestamp')
  })

  it('requires source versions to match the tag', () => {
    expect(() => assertSourceVersion('3.18.0', '3.18.0', '3.18.0')).not.toThrow()
    expect(() => assertSourceVersion('3.18.0', '3.17.0', '3.18.0')).toThrow('package.json')
    expect(() => assertSourceVersion('3.18.0', '3.18.0', '3.17.0')).toThrow('package-lock.json')
  })

  it('defines the complete platform matrix', () => {
    expect(releaseTargets.map(({ vsceTarget }) => vsceTarget)).toEqual([
      'linux-x64',
      'linux-arm64',
      'darwin-x64',
      'darwin-arm64',
      'win32-x64',
      'win32-arm64',
    ])
  })

  it('uses the semantic release version in artifact names', () => {
    expect(releaseArtifactName('runme', 'linux-x64', '3.18.1-edge.0')).toBe(
      'runme-linux-x64-3.18.1-edge.0.vsix',
    )
  })
})
