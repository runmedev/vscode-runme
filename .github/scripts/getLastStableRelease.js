import os from 'node:os'


export const getLastStableRelease = async () => {
  const branch = process.env.GITHUB_REF_NAME ?? 'main'
  const suffix = branch === 'main' ? '/latest' : ''

  const headers = {
    'Accept': 'application/vnd.github+json',
    ...(process.env.GITHUB_TOKEN ? { 'Authorization': `Bearer ${process.env.GITHUB_TOKEN}` } : {})
  }
  /**
   * Unless we're not on the main branch latest release is the most recent non-prerelease, non-draft release
   */
  const response = (await fetch(`https://api.github.com/repos/stateful/runme/releases${suffix}`, {
    headers
  }))
  const json = await response.json().then(json => {
    return Array.isArray(json) ? json[0] : json
  })

  const { tag_name } = json
  const arch = os.arch() === 'x64' ? 'x86_64' : os.arch() === 'ia32' ? 'arm64' : os.arch()
  const ext = os.platform() === 'win32' ? 'zip' : 'tar.gz'
  const binary = `${os.platform().replace('win32', 'windows')}_${arch}.${ext}`
  const downloadUrl = `https://download.stateful.com/runme/${tag_name.replace('v', '')}/runme_${binary}`
  return downloadUrl
}

/**
 * execute if called directly
 */
if (process.argv[1] && process.argv[1].endsWith('getLastStableRelease.js')) {
  const downloadUrl = await getLastStableRelease()
  // This console log is important since it's being exported to a ENV VAR
  console.log(downloadUrl)
}
