import os from 'node:os'

export const PLATFORM_OS = os.platform()
export const DENO_ACCESS_TOKEN_KEY = 'DENO_ACCESS_TOKEN'
export const DENO_PROJECT_NAME_KEY = 'DENO_PROJECT_NAME'

export const DEFAULT_ENV = {
  RUNME_TASK: 'true',
  PATH: process.env.PATH || ''
}
export const ENV_STORE = new Map<string, string>(
  Object.entries(DEFAULT_ENV)
)

export const BOOTFILE = '.runme_bootstrap'
