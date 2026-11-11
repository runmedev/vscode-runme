import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import {
  assertSourceVersion,
  evaluateGhaPipelineRuns,
  parseReleaseTag,
  publicationCommand,
  RELEASE_PUBLICATION_ENABLED,
  releaseArtifactName,
  releaseTargets,
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
    expect(notebook).toContain('runme run PublishRelease')
    expect(notebook).not.toContain('"name":"release:pipeline"')
    expect(notebook).not.toContain('dagger call')
    expect(workflow).toContain('workflows: GhaRelease')
    expect(workflow).toContain('actions: read')
    expect(workflow).not.toContain('workflows: release:pipeline')
    expect(workflow).not.toContain('RUNME_TEST_TOKEN')
    expect(moduleSource).not.toContain('releaseTestMarker')
    expect(moduleSource).not.toContain('.release-tests-passed')
  })

  it('waits when the exact GHA Pipeline run has not appeared', () => {
    expect(evaluateGhaPipelineRuns([])).toEqual({ state: 'pending' })
  })

  it('waits while the exact GHA Pipeline run is active', () => {
    expect(
      evaluateGhaPipelineRuns([
        { conclusion: null, status: 'in_progress', url: 'https://example.test/pipeline' },
      ]),
    ).toEqual({ state: 'pending', url: 'https://example.test/pipeline' })
  })

  it('accepts only a successful exact GHA Pipeline run', () => {
    expect(
      evaluateGhaPipelineRuns([
        { conclusion: 'success', status: 'completed', url: 'https://example.test/pipeline' },
      ]),
    ).toEqual({ state: 'passed', url: 'https://example.test/pipeline' })
  })

  it('rejects a completed unsuccessful exact GHA Pipeline run', () => {
    expect(
      evaluateGhaPipelineRuns([
        { conclusion: 'failure', status: 'completed', url: 'https://example.test/pipeline' },
      ]),
    ).toEqual({
      state: 'failed',
      conclusion: 'failure',
      url: 'https://example.test/pipeline',
    })
  })

  it('keeps publication fail-closed until the rollout constant changes', () => {
    const command = ['npx', 'vsce', 'publish', '--packagePath', '/tmp/release/runme.vsix']

    expect(RELEASE_PUBLICATION_ENABLED).toBe(false)
    expect(publicationCommand(command, 'Visual Studio Marketplace: runme.vsix')).toEqual([
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
