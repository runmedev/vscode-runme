import path from 'node:path'

/**
 * Reports whether an interpreter invokes Dagger's legacy shell command or its
 * replacement, script. Legacy shell interpreters must not have trailing
 * arguments because those belong to Dagger v1's terminal shell command.
 * Execution canonicalization remains kernel-owned.
 */
export function isDaggerCommand(programName: string): boolean {
  const fields = programName.trim().split(/\s+/)
  if (fields.length < 2) {
    return false
  }

  const executableName = (field: string) =>
    path.posix.basename(field.replaceAll('\\', '/')).replace(/\.exe$/i, '').toLowerCase()

  let daggerIndex = -1
  switch (executableName(fields[0])) {
    case 'dagger':
      daggerIndex = 0
      break
    case 'env':
      daggerIndex = fields.findIndex((field, index) => index > 0 && executableName(field) === 'dagger')
      break
    default:
      return false
  }

  if (daggerIndex < 0) {
    return false
  }

  for (let index = daggerIndex + 1; index < fields.length; index++) {
    switch (fields[index]) {
      case 'shell':
        return index === fields.length - 1
      case 'script':
        return true
    }
  }

  return false
}
