import os from 'node:os'
import path from 'node:path'

import { ExtensionContext, NotebookCell, Uri, workspace } from 'vscode'
import { z } from 'zod'

import { RUNME_FRONTMATTER_PARSED, SERVER_PORT } from '../constants'
import { RunmeIdentity } from '../extension/grpc/parser/tcp/types'
import { getAnnotations, isWindows } from '../extension/utils'
import { NotebookAutoSaveSetting, EnvVarMode, Serializer } from '../types'

const ACTIONS_SECTION_NAME = 'runme.actions'
const SERVER_SECTION_NAME = 'runme.server'
const TERMINAL_SECTION_NAME = 'runme.terminal'
const CODELENS_SECTION_NAME = 'runme.codelens'
const NOTEBOOK_SECTION_NAME = 'runme.notebook'
const ENV_SECTION_NAME = 'runme.env'
const CLI_SECTION_NAME = 'runme.cli'
const APP_SECTION_NAME = 'runme.app'

export const OpenViewInEditorAction = z.enum(['split', 'toggle'])
const DEFAULT_DIR_ENV = 1
const DEFAULT_DOCS_URL = 'https://docs.runme.dev'
const DEFAULT_RUNME_APP_API_URL = 'https://cloud.stateful.com'
const DEFAULT_RUNME_BASE_DOMAIN = 'cloud.stateful.com'
const DEFAULT_RUNME_REMOTE_DEV = 'staging.cloud.stateful.com'
const DEFAULT_WORKSPACE_FILE_ORDER = ['.env.local', '.env']
const APP_LOOPBACKS = ['127.0.0.1', 'localhost']
const APP_LOOPBACK_MAPPING = new Map<string, string>([
  ['api.', ':4000'],
  ['app.', ':4001'],
])

type NotebookTerminalValue = keyof typeof notebookTerminalSchema

const editorSettings = workspace.getConfiguration('editor')
const terminalSettings = workspace.getConfiguration('terminal.integrated')
const notebookTerminalSchema = {
  backgroundTask: z.boolean().default(true),
  nonInteractive: z.boolean().default(false),
  interactive: z.boolean().default(true),
  interactiveIsDefault: z.boolean().default(true),
  fontSize: z.number().default(editorSettings.get<number>('fontSize', 10)),
  fontFamily: z
    .string()
    .default(editorSettings.get<string>('fontFamily', terminalSettings.get('fontFamily', 'Arial'))),
  rows: z.number().int().default(10),
  cursorStyle: z.enum(['block', 'bar', 'underline']).default('bar'),
  cursorBlink: z.boolean().default(true).optional(),
  cursorWidth: z.number().min(1).optional(),
  smoothScrollDuration: z.number().optional(),
  scrollback: z.number(),
  closeOnSuccess: z.boolean().default(true),
}

const configurationSchema = {
  actions: {
    openViewInEditor: OpenViewInEditorAction.default('split'),
  },
  server: {
    customAddress: z.string().min(1).optional(),
    binaryPath: z.string().optional(),
    enableLogger: z.boolean().default(false),
    enableTLS: z.boolean().default(true),
    tlsDir: z.string().optional(),
    transportType: z.enum(['TCP', 'UDS']).default('TCP'),
    lifecycleIdentity: z.nativeEnum(RunmeIdentity).default(RunmeIdentity.CELL),
    runnerVersion: z.enum(['v1', 'v2']).default('v1'),
  },
  codelens: {
    enable: z.boolean().default(true),
    pasteNewline: z.boolean().default(false),
  },
  notebook: {
    executionOrder: z.boolean().default(true),
    envVarMode: z.enum([EnvVarMode.Docs, EnvVarMode.Shell]).default(EnvVarMode.Docs),
  },
  env: {
    workspaceFileOrder: z.array(z.string()).default(DEFAULT_WORKSPACE_FILE_ORDER),
    loadWorkspaceFiles: z.boolean().default(true),
    dirEnv: z.number().default(DEFAULT_DIR_ENV),
  },
  cli: {
    useIntegratedRunme: z.boolean().default(false),
  },
  app: {
    apiUrl: z.string().default(DEFAULT_RUNME_APP_API_URL),
    baseDomain: z.string().default(DEFAULT_RUNME_BASE_DOMAIN),
    forceNewWindow: z.boolean().default(true),
    notebookAutoSave: z
      .enum([NotebookAutoSaveSetting.Yes, NotebookAutoSaveSetting.No])
      .default(NotebookAutoSaveSetting.No),
    sessionOutputs: z.boolean().default(true),
    maskOutputs: z.boolean().default(true),
    loginPrompt: z.boolean().default(true),
    platformAuth: z.boolean().default(false),
    docsUrl: z.string().default(DEFAULT_DOCS_URL),
    authTokenPath: z.string().optional(),
    deleteAuthToken: z.boolean().default(true),
    showLoginNotification: z.boolean().default(true),
  },
}

const _notebookTerminalSchemaObject = z.object(notebookTerminalSchema)
export type TerminalConfiguration = z.infer<typeof _notebookTerminalSchemaObject>
export type ServerTransportType = z.infer<typeof configurationSchema.server.transportType>
export type ServerLifecycleIdentity = z.infer<typeof configurationSchema.server.lifecycleIdentity>
export type ServerRunnerVersion = z.infer<typeof configurationSchema.server.runnerVersion>

const getActionsConfigurationValue = <T>(
  configName: keyof typeof configurationSchema.actions,
  defaultValue: T,
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
  defaultValue: T,
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
  defaultValue: T,
) => {
  const configurationSection = workspace.getConfiguration(TERMINAL_SECTION_NAME)
  const configurationValue = configurationSection.get<T>(configName)!
  const parseResult = notebookTerminalSchema[configName].safeParse(
    configurationValue === null ? undefined : configurationValue,
  )
  if (parseResult.success) {
    return parseResult.data as T
  }
  return defaultValue
}

const getCodeLensConfigurationValue = <T>(
  configName: keyof typeof configurationSchema.codelens,
  defaultValue: T,
) => {
  const configurationSection = workspace.getConfiguration(CODELENS_SECTION_NAME)
  const configurationValue = configurationSection.get<T>(configName)!
  const parseResult = configurationSchema.codelens[configName].safeParse(configurationValue)
  if (parseResult.success) {
    return parseResult.data as T
  }
  return defaultValue
}

const getNotebookConfigurationValue = <T>(
  configName: keyof typeof configurationSchema.notebook,
  defaultValue: T,
) => {
  const configurationSection = workspace.getConfiguration(NOTEBOOK_SECTION_NAME)
  const configurationValue = configurationSection.get<T>(configName)!
  const parseResult = configurationSchema.notebook[configName].safeParse(configurationValue)
  if (parseResult.success) {
    return parseResult.data as T
  }
  return defaultValue
}

const getEnvConfigurationValue = <T>(
  configName: keyof typeof configurationSchema.env,
  defaultValue: T,
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
  defaultValue: T,
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
  defaultValue: T,
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

const getServerLifecycleIdentity = (): ServerLifecycleIdentity => {
  return getServerConfigurationValue<ServerLifecycleIdentity>(
    'lifecycleIdentity',
    RunmeIdentity.UNSPECIFIED,
  )
}

const getCustomServerAddress = (): string | undefined => {
  const address = getServerConfigurationValue<string | undefined>('customAddress', undefined)

  if (!address) {
    return address
  }

  if (address && !URL.canParse(address)) {
    return address
  }

  const url = new URL(address)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return address
  }

  return url.host.toString()
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

const getBinaryPath = (extensionBaseUri: Uri, platform = os.platform()): Uri => {
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

const getServerRunnerVersion = (): ServerRunnerVersion => {
  return getServerConfigurationValue<ServerRunnerVersion>('runnerVersion', 'v1')
}

const isInteractiveTerminalDefault = (): boolean => {
  return getRunmeTerminalConfigurationValue('interactiveIsDefault', true)
}

const isNotebookTerminalFeatureEnabled = (
  featureName: keyof typeof notebookTerminalSchema,
): boolean => {
  return getRunmeTerminalConfigurationValue(featureName, false)
}

const getNotebookTerminalConfigurations = (metadata: Serializer.Metadata) => {
  const keys = Object.keys(notebookTerminalSchema) as Array<keyof typeof notebookTerminalSchema>
  const config = keys.reduce(
    (p, c) => {
      p[c] = getRunmeTerminalConfigurationValue<never>(c, undefined as never)
      return p
    },
    {} as TerminalConfiguration,
  )
  const parsedFm = metadata?.[RUNME_FRONTMATTER_PARSED]
  if (parsedFm?.terminalRows) {
    const rows = Number(parsedFm.terminalRows)
    if (!Number.isFinite(rows)) {
      return config
    }
    config.rows = rows
  }
  return config
}

const isNotebookTerminalEnabledForCell = (cell: NotebookCell): boolean => {
  const { interactive, background } = getAnnotations(cell)

  if (interactive) {
    return background
      ? isNotebookTerminalFeatureEnabled('backgroundTask')
      : isNotebookTerminalFeatureEnabled('interactive')
  }

  return false
}

const getCloseTerminalOnSuccess = () => {
  return getRunmeTerminalConfigurationValue<boolean>('closeOnSuccess', true)
}

const getCodeLensEnabled = (): boolean => {
  return getCodeLensConfigurationValue<boolean>('enable', true)
}

const getCodeLensPasteIntoTerminalNewline = (): boolean => {
  return getCodeLensConfigurationValue<boolean>('pasteNewline', false)
}

const getNotebookExecutionOrder = (): boolean => {
  return getNotebookConfigurationValue<boolean>('executionOrder', true)
}

const getEnvVarMode = (): EnvVarMode => {
  return getNotebookConfigurationValue('envVarMode', EnvVarMode.Docs)
}

const registerExtensionEnvVarsMutation = (
  context: ExtensionContext,
  envs: Record<string, string>,
): void => {
  context.environmentVariableCollection.persistent = false
  const binaryBasePath =
    path.dirname(getBinaryPath(context.extensionUri).fsPath) + (isWindows() ? ';' : ':')
  context.environmentVariableCollection.prepend('PATH', binaryBasePath)

  Object.entries(envs).forEach(([k, v]) => {
    context.environmentVariableCollection.replace(k, v)
  })

  // todo(sebastian): consider making recent vs specific session a setting
  context.environmentVariableCollection.delete('RUNME_SESSION')
}

const getActionsOpenViewInEditor = () => {
  type ActionEnum = z.infer<typeof OpenViewInEditorAction>
  return getActionsConfigurationValue<ActionEnum>(
    'openViewInEditor',
    OpenViewInEditorAction.enum.split,
  )
}

const getEnvWorkspaceFileOrder = (): string[] => {
  return getEnvConfigurationValue('workspaceFileOrder', DEFAULT_WORKSPACE_FILE_ORDER)
}

const getEnvLoadWorkspaceFiles = (): boolean => {
  return getEnvConfigurationValue('loadWorkspaceFiles', true)
}

const getEnvDirEnv = (): number => {
  return getEnvConfigurationValue('dirEnv', DEFAULT_DIR_ENV)
}

const getCLIUseIntegratedRunme = (): boolean => {
  return getCLIConfigurationValue('useIntegratedRunme', false)
}

const getRemoteDev = (baseDomain: string): boolean => {
  const localDev = APP_LOOPBACKS.map((host) =>
    Uri.from({ scheme: 'http', authority: host }).toString().slice(0, -1),
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

  if (!isLoopback) {
    subdomains = subdomains.map((s) => {
      if (s === 'app') {
        return ''
      }
      return s
    })
  }

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

const getRunmePanelIdentifier = (identifer: string): string => {
  const configurationSection = workspace.getConfiguration(`${APP_SECTION_NAME}.panel`)
  const configurationValue = configurationSection.get<string>(identifer) || identifer
  return configurationValue
}

const getForceNewWindowConfig = (): boolean => {
  return getCloudConfigurationValue('forceNewWindow', true)
}

const getNotebookAutoSave = (): NotebookAutoSaveSetting => {
  return getCloudConfigurationValue('notebookAutoSave', NotebookAutoSaveSetting.No)
}

const getSessionOutputs = (): boolean => {
  return getCloudConfigurationValue('sessionOutputs', true)
}

const getMaskOutputs = (): boolean => {
  return getCloudConfigurationValue('maskOutputs', true)
}

const getLoginPrompt = (): boolean => {
  return getCloudConfigurationValue('loginPrompt', true)
}

const isPlatformAuthEnabled = (): boolean => {
  return getCloudConfigurationValue('platformAuth', false)
}

const getDocsUrl = (): string => {
  return getCloudConfigurationValue('docsUrl', DEFAULT_DOCS_URL)
}

const getDocsUrlFor = (path: string): string => {
  const baseUrl = getDocsUrl()
  return `${baseUrl}${path}`
}

const getAuthTokenPath = () => {
  return getCloudConfigurationValue<string | undefined>('authTokenPath', undefined)
}

const getDeleteAuthToken = () => {
  return getCloudConfigurationValue<boolean>('deleteAuthToken', true)
}

const getShowLoginNotification = () => {
  return getCloudConfigurationValue<boolean>('showLoginNotification', true)
}

export {
  enableServerLogs,
  getActionsOpenViewInEditor,
  getAuthTokenPath,
  getBinaryPath,
  getCLIUseIntegratedRunme,
  getCloseTerminalOnSuccess,
  getCodeLensEnabled,
  getCodeLensPasteIntoTerminalNewline,
  getCustomServerAddress,
  getDeleteAuthToken,
  getDocsUrl,
  getDocsUrlFor,
  getEnvLoadWorkspaceFiles,
  getEnvDirEnv,
  getEnvWorkspaceFileOrder,
  getForceNewWindowConfig,
  getLoginPrompt,
  getMaskOutputs,
  getNotebookAutoSave,
  getEnvVarMode,
  getNotebookExecutionOrder,
  getNotebookTerminalConfigurations,
  getPortNumber,
  getRunmeAppUrl,
  getRunmePanelIdentifier,
  getServerConfigurationValue,
  getServerLifecycleIdentity,
  getServerRunnerVersion,
  getSessionOutputs,
  getShowLoginNotification,
  getTLSDir,
  getTLSEnabled,
  isInteractiveTerminalDefault,
  isNotebookTerminalEnabledForCell,
  isNotebookTerminalFeatureEnabled,
  isPlatformAuthEnabled,
  registerExtensionEnvVarsMutation,
}
