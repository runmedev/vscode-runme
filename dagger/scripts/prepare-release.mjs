import fs from 'node:fs/promises'
import path from 'node:path'

const [channel, marketplaceVersion] = process.argv.slice(2)
if (!['stable', 'edge'].includes(channel) || !marketplaceVersion) {
  throw new Error('usage: prepare-release.mjs <stable|edge> <marketplace-version>')
}

const packagePath = path.resolve('package.json')
const manifest = JSON.parse(await fs.readFile(packagePath, 'utf8'))
manifest.version = marketplaceVersion

const smartEnvStore =
  manifest.contributes?.configuration?.[0]?.properties?.['runme.experiments.smartEnvStore']
if (!smartEnvStore) {
  throw new Error('Runme Smart Env Store configuration is missing from package.json')
}

if (channel === 'stable') {
  const runmeViews = manifest.contributes?.views?.runme
  if (!Array.isArray(runmeViews) || runmeViews.length < 3) {
    throw new Error('Expected Runme development views are missing from package.json')
  }
  manifest.contributes.views.runme = runmeViews.slice(0, 1)
  delete manifest.contributes.views['runme-notebook']
  delete manifest.contributes.viewsContainers.panel
  smartEnvStore.default = false
} else {
  smartEnvStore.default = true
}

await fs.writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`)
