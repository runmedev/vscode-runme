export const releaseTargets = [
  { kernelPlatform: 'linux/amd64', vsceTarget: 'linux-x64' },
  { kernelPlatform: 'linux/arm64', vsceTarget: 'linux-arm64' },
  { kernelPlatform: 'darwin/amd64', vsceTarget: 'darwin-x64' },
  { kernelPlatform: 'darwin/arm64', vsceTarget: 'darwin-arm64' },
  { kernelPlatform: 'windows/amd64', vsceTarget: 'win32-x64' },
  { kernelPlatform: 'windows/arm64', vsceTarget: 'win32-arm64' },
] as const

export type ReleaseChannel = 'stable' | 'edge'

export interface ReleaseMetadata {
  channel: ReleaseChannel
  marketplaceVersion: string
  version: string
}

const numericIdentifier = '(0|[1-9]\\d*)'
const releaseTagPattern = new RegExp(
  `^${numericIdentifier}\\.${numericIdentifier}\\.${numericIdentifier}(?:-edge\\.${numericIdentifier})?$`,
)

export function parseReleaseTag(tag: string, commitTimestamp = 0): ReleaseMetadata {
  const match = releaseTagPattern.exec(tag)
  if (!match) {
    throw new Error(
      `Invalid release tag "${tag}"; expected X.Y.Z or X.Y.Z-edge.N without a v prefix`,
    )
  }

  const [, major, minor, patch, edgeSequence] = match
  const channel: ReleaseChannel = edgeSequence === undefined ? 'stable' : 'edge'

  if (channel === 'stable') {
    return { channel, marketplaceVersion: tag, version: tag }
  }

  if (
    !Number.isSafeInteger(commitTimestamp) ||
    commitTimestamp <= 0 ||
    commitTimestamp > 2_147_483_647
  ) {
    throw new Error(
      'Edge releases require a positive tagged-commit timestamp within Marketplace limits',
    )
  }

  return {
    channel,
    marketplaceVersion: `${major}.${minor}.${commitTimestamp}`,
    version: `${major}.${minor}.${patch}-edge.${edgeSequence}`,
  }
}

export function assertSourceVersion(
  tag: string,
  packageVersion: unknown,
  lockfileVersion: unknown,
): void {
  if (packageVersion !== tag) {
    throw new Error(`package.json version "${String(packageVersion)}" does not match tag "${tag}"`)
  }
  if (lockfileVersion !== tag) {
    throw new Error(
      `package-lock.json root version "${String(lockfileVersion)}" does not match tag "${tag}"`,
    )
  }
}

export function releaseArtifactName(
  extensionName: string,
  target: string,
  version: string,
): string {
  return `${extensionName}-${target}-${version}.vsix`
}
