import path from 'node:path'

export const DAGGER_LEGACY_COMMAND = 'dagger shell'
export const DAGGER_COMMAND = 'dagger script'

/**
 * Reports whether an interpreter invokes Dagger's legacy shell command or its
 * replacement, script. Execution canonicalization remains kernel-owned.
 */
export function isDaggerCommand(programName: string): boolean {
  const fields = programName.trim().split(/\s+/)
  if (fields.length < 2) {
    return false
  }

  const executableName = (field: string) => path.posix.basename(field.replaceAll('\\', '/'))

  let daggerIndex = 0
  if (executableName(fields[0]) === 'env') {
    daggerIndex++
    while (
      daggerIndex < fields.length &&
      (fields[daggerIndex].startsWith('-') || fields[daggerIndex].includes('='))
    ) {
      daggerIndex++
    }
  }

  if (daggerIndex + 1 >= fields.length || executableName(fields[daggerIndex]) !== 'dagger') {
    return false
  }

  return fields[daggerIndex + 1] === 'shell' || fields[daggerIndex + 1] === 'script'
}
