import { readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import { ExtensionContext, NotebookCell, Uri, workspace } from 'vscode'
import { z } from 'zod'

import { getAnnotations, isWindows } from '../extension/utils'
import { SERVER_PORT } from '../constants'

const ACTIONS_SECTION_NAME = 'runme.actions'
const SERVER_SECTION_NAME = 'runme.server'
const TERMINAL_SECTION_NAME = 'runme.terminal'
const CODELENS_SECTION_NAME = 'runme.codelens'
const ENV_SECTION_NAME = 'runme.env'
const CLI_SECTION_NAME = 'runme.cli'
const APP_SECTION_NAME = 'runme.app'

export const OpenViewInEditorAction = z.enum(['split', 'toggle'])
const DEFAULT_WORKSPACE_FILE_ORDER = ['.env.local', '.env']
const DEFAULT_RUNME_APP_API_URL = 'https://api.runme.dev'
const DEFAULT_RUNME_BASE_DOMAIN = 'runme.dev'
const DEFAULT_RUNME_REMOTE_DEV = 'staging.runme.dev'
const APP_LOOPBACKS = ['127.0.0.1', 'localhost']
const APP_LOOPBACK_MAPPING = new Map<string, string>([
  ['api.', ':4000'],
  ['app.', ':4001'],
])

// todo(sebastian): temp hack, remove for stable release
let APP_PANELS_PRESENT = false
try {
  const packageJson = readFileSync(path.join(__dirname, '../package.json'), { encoding: 'utf8' })
  APP_PANELS_PRESENT = packageJson.indexOf('viewsContainers') > -1
} catch (err) {
  if (err instanceof Error) {
    console.error(err.message)
  } else {
    console.error(err)
  }
}

type NotebookTerminalValue = keyof typeof configurationSchema.notebookTerminal

const configurationSchema = {
  actions: {
    openViewInEditor: OpenViewInEditorAction.default('split'),
  },
  server: {
    customAddress: z.string().nonempty().optional(),
    binaryPath: z.string().optional(),
    enableLogger: z.boolean().default(false),
    enableTLS: z.boolean().default(true),
    tlsDir: z.string().optional(),
  },
  notebookTerminal: {
    backgroundTask: z.boolean().default(true),
    nonInteractive: z.boolean().default(false),
    interactive: z.boolean().default(true),
    fontSize: z.number().optional(),
    fontFamily: z.string().optional(),
    rows: z.number().int(),
  },
  codelens: {
    enable: z.boolean().default(true),
  },
  env: {
    workspaceFileOrder: z.array(z.string()).default(DEFAULT_WORKSPACE_FILE_ORDER),
    loadWorkspaceFiles: z.boolean().default(true),
  },
  cli: {
    useIntegratedRunme: z.boolean().default(false),
  },
  app: {
    apiUrl: z.string().default(DEFAULT_RUNME_APP_API_URL),
    baseDomain: z.string().default(DEFAULT_RUNME_BASE_DOMAIN),
    enableShare: z.boolean().default(true),
  },
}

const getActionsConfigurationValue = <T>(
  configName: keyof typeof configurationSchema.actions,
  defaultValue: T
) => {
  const configurationSection = workspace.getConfiguration(ACTIONS_SECTION_NAME)
  const configurationValue = configurationSection.get<T>(configName)!
  const parseResult = configurationSchema.actions[configName].safeParse(configurationValue)
  if (parseResult.success) {
    return parseResult.data as T
  }
  return defaultValue
}

const getServerConfigurationValue = <T>(
  configName: keyof typeof configurationSchema.server,
  defaultValue: T
) => {
  const configurationSection = workspace.getConfiguration(SERVER_SECTION_NAME)
  const configurationValue = configurationSection.get<T>(configName)!
  const parseResult = configurationSchema.server[configName].safeParse(configurationValue)
  if (parseResult.success) {
    return parseResult.data as T
  }
  return defaultValue
}

const getRunmeTerminalConfigurationValue = <T>(
  configName: NotebookTerminalValue,
  defaultValue: T
) => {
  const configurationSection = workspace.getConfiguration(TERMINAL_SECTION_NAME)
  const configurationValue = configurationSection.get<T>(configName)!
  const parseResult = configurationSchema.notebookTerminal[configName].safeParse(configurationValue)
  if (parseResult.success) {
    return parseResult.data as T
  }
  return defaultValue
}

const getCodeLensConfigurationValue = <T>(
  configName: keyof typeof configurationSchema.codelens,
  defaultValue: T
) => {
  const configurationSection = workspace.getConfiguration(CODELENS_SECTION_NAME)
  const configurationValue = configurationSection.get<T>(configName)!
  const parseResult = configurationSchema.codelens[configName].safeParse(configurationValue)
  if (parseResult.success) {
    return parseResult.data as T
  }
  return defaultValue
}

const getEnvConfigurationValue = <T>(
  configName: keyof typeof configurationSchema.env,
  defaultValue: T
) => {
  const configurationSection = workspace.getConfiguration(ENV_SECTION_NAME)
  const configurationValue = configurationSection.get<T>(configName)!
  const parseResult = configurationSchema.env[configName].safeParse(configurationValue)
  if (parseResult.success) {
    return parseResult.data as T
  }
  return defaultValue
}

const getCloudConfigurationValue = <T>(
  configName: keyof typeof configurationSchema.app,
  defaultValue: T
) => {
  const configurationSection = workspace.getConfiguration(APP_SECTION_NAME)
  const configurationValue = configurationSection.get<T>(configName)!
  const parseResult = configurationSchema.app[configName].safeParse(configurationValue)
  if (parseResult.success) {
    return parseResult.data as T
  }
  return defaultValue
}

const getCLIConfigurationValue = <T>(
  configName: keyof typeof configurationSchema.cli,
  defaultValue: T
) => {
  const configurationSection = workspace.getConfiguration(CLI_SECTION_NAME)
  const configurationValue = configurationSection.get<T>(configName)!
  const parseResult = configurationSchema.cli[configName].safeParse(configurationValue)
  if (parseResult.success) {
    return parseResult.data as T
  }
  return defaultValue
}

const getPortNumber = (): number => {
  return SERVER_PORT
}

const getCustomServerAddress = (): string | undefined => {
  return getServerConfigurationValue<string | undefined>('customAddress', undefined)
}

const getTLSEnabled = (): boolean => {
  if (isWindows()) {
    // disable on windows until we figure out file permissions
    return false
  }

  return getServerConfigurationValue('enableTLS', true)
}

const getTLSDir = (extensionsDir: Uri): string => {
  return (
    getServerConfigurationValue('tlsDir', undefined) || Uri.joinPath(extensionsDir, 'tls').fsPath
  )
}

const getBinaryPath = (extensionBaseUri: Uri, platform: string): Uri => {
  const userPath = getServerConfigurationValue<string | undefined>('binaryPath', undefined)

  const isWin = platform.toLowerCase().startsWith('win')
  const binName = isWin ? 'runme.exe' : 'runme'
  const bundledPath = Uri.joinPath(extensionBaseUri, 'bin', binName)

  if (userPath) {
    if (path.isAbsolute(userPath)) {
      return Uri.file(userPath)
    } else if (workspace.workspaceFolders && workspace.workspaceFolders.length > 0) {
      return Uri.joinPath(workspace.workspaceFolders[0].uri, userPath)
    }
  }

  return bundledPath
}

const enableServerLogs = (): boolean => {
  return getServerConfigurationValue<boolean>('enableLogger', false)
}

const isNotebookTerminalFeatureEnabled = (
  featureName: keyof typeof configurationSchema.notebookTerminal
): boolean => {
  return getRunmeTerminalConfigurationValue(featureName, false)
}

const getNotebookTerminalFontSize = (): number | undefined => {
  return getRunmeTerminalConfigurationValue<number | undefined>('fontSize', undefined)
}

const getNotebookTerminalFontFamily = (): string | undefined => {
  return getRunmeTerminalConfigurationValue<string | undefined>('fontFamily', undefined)
}

const isNotebookTerminalEnabledForCell = (cell: NotebookCell): boolean => {
  const { interactive, background } = getAnnotations(cell)

  return interactive
    ? background
      ? isNotebookTerminalFeatureEnabled('backgroundTask')
      : isNotebookTerminalFeatureEnabled('interactive')
    : isNotebookTerminalFeatureEnabled('nonInteractive')
}

const getNotebookTerminalRows = (): number => {
  return getRunmeTerminalConfigurationValue<number>('rows', 10)
}

const getCodeLensEnabled = (): boolean => {
  return getCodeLensConfigurationValue<boolean>('enable', true)
}

const registerExtensionEnvironmentVariables = (context: ExtensionContext): void => {
  context.environmentVariableCollection.prepend(
    'PATH',
    path.dirname(getBinaryPath(context.extensionUri, os.platform()).fsPath) +
      (isWindows() ? ';' : ':')
  )
}

const getActionsOpenViewInEditor = () => {
  type ActionEnum = z.infer<typeof OpenViewInEditorAction>
  return getActionsConfigurationValue<ActionEnum>(
    'openViewInEditor',
    OpenViewInEditorAction.enum.split
  )
}

const getEnvWorkspaceFileOrder = (): string[] => {
  return getEnvConfigurationValue('workspaceFileOrder', DEFAULT_WORKSPACE_FILE_ORDER)
}

const getEnvLoadWorkspaceFiles = (): boolean => {
  return getEnvConfigurationValue('loadWorkspaceFiles', true)
}

const getCLIUseIntegratedRunme = (): boolean => {
  return getCLIConfigurationValue('useIntegratedRunme', false)
}

const getRemoteDev = (baseDomain: string): boolean => {
  const localDev = APP_LOOPBACKS.map((host) =>
    Uri.from({ scheme: 'http', authority: host }).toString().slice(0, -1)
  )
  return localDev.map((uri) => baseDomain.startsWith(uri)).reduce((p, c) => p || c)
}

const getRunmeAppUrl = (subdomains: string[]): string => {
  let base = getRunmeBaseDomain()
  const isRemoteDev = getRemoteDev(base)
  if (isRemoteDev) {
    if (subdomains.length === 1 && subdomains?.[0] === 'app') {
      return base
    } else {
      base = DEFAULT_RUNME_REMOTE_DEV
    }
  }

  const isLoopback = APP_LOOPBACKS.map((host) => base.includes(host)).reduce((p, c) => p || c)
  const scheme = isLoopback ? 'http' : 'https'

  let sub = subdomains.join('.')
  if (sub.length > 0) {
    sub = `${sub}.`
  }

  let port = ''
  if (isLoopback && sub.length > 0) {
    port = APP_LOOPBACK_MAPPING.get(sub) ?? ''
    sub = ''
  }

  const endpoint = Uri.parse(`${scheme}://${sub}${base}${port}`, true)
  return endpoint.toString()
}

const getRunmeBaseDomain = (): string => {
  const baseDomain = getCloudConfigurationValue('baseDomain', DEFAULT_RUNME_BASE_DOMAIN)
  if (baseDomain.length === 0) {
    return DEFAULT_RUNME_BASE_DOMAIN
  }
  return baseDomain
}

const isRunmeAppButtonsEnabled = (): boolean => {
  return APP_PANELS_PRESENT && getCloudConfigurationValue('enableShare', true)
}

export {
  getPortNumber,
  getBinaryPath,
  enableServerLogs,
  getServerConfigurationValue,
  isNotebookTerminalFeatureEnabled,
  isNotebookTerminalEnabledForCell,
  getTLSEnabled,
  getTLSDir,
  getNotebookTerminalFontFamily,
  getNotebookTerminalFontSize,
  getNotebookTerminalRows,
  getCodeLensEnabled,
  registerExtensionEnvironmentVariables,
  getCustomServerAddress,
  getActionsOpenViewInEditor,
  getEnvWorkspaceFileOrder,
  getEnvLoadWorkspaceFiles,
  getCLIUseIntegratedRunme,
  getRunmeAppUrl,
  isRunmeAppButtonsEnabled,
}
