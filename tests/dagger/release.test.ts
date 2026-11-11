import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import {
  assertSourceVersion,
  parseReleaseTag,
  releaseArtifactName,
  releaseTargets,
} from '../../dagger/src/release'

describe('Dagger release policy', () => {
  it('exposes the release graph as named Dagger Shell nouns', () => {
    const notebook = readFileSync('dagger/RELEASE.md', 'utf8')

    expect(notebook).toContain('shell: dagger shell')
    expect(notebook).toContain('"name":"ReleaseArtifacts"')
    expect(notebook).toContain('"name":"ReleaseDistribution"')
    expect(notebook).toContain('"name":"Release"')
    expect(notebook).not.toContain('dagger call')
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

  it('requires immutable timestamp input for edge tags', () => {
    expect(() => parseReleaseTag('3.18.1-edge.0')).toThrow('tagged-commit timestamp')
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
