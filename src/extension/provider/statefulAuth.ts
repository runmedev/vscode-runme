import * as crypto from 'node:crypto'

import {
  authentication,
  AuthenticationProvider,
  Disposable,
  env,
  EventEmitter,
  ExtensionContext,
  ProgressLocation,
  Uri,
  window,
  AuthenticationSession,
  AuthenticationProviderAuthenticationSessionsChangeEvent,
  workspace,
  AuthenticationGetSessionOptions,
} from 'vscode'
import { v4 as uuidv4 } from 'uuid'
import fetch from 'node-fetch'
import jwt, { JwtPayload } from 'jsonwebtoken'

import {
  getAuthTokenPath,
  getDeleteAuthToken,
  getRunmeAppUrl,
  getShowLoginNotification,
} from '../../utils/configuration'
import { AuthenticationProviders, PLATFORM_USER_SIGNED_IN, TELEMETRY_EVENTS } from '../../constants'
import ContextState from '../contextState'
import getLogger from '../logger'
import { FeatureName } from '../../types'
import * as features from '../features'
import { PromiseAdapter, promiseFromEvent } from '../../utils/promiseFromEvent'

const logger = getLogger('StatefulAuthProvider')

const AUTH_NAME = 'Stateful'
const SESSIONS_SECRET_KEY = `${AuthenticationProviders.Stateful}.sessions`
export const DEFAULT_SCOPES = ['profile']
export const AUTH_TIMEOUT = 60000

interface TokenInformation {
  accessToken: string
  expiresIn: number
}

export interface StatefulAuthSession extends AuthenticationSession {
  expiresIn: number
  isExpired: boolean
}

interface DecodedToken extends JwtPayload {
  exp?: number
  scope?: string
}

type SessionsChangeEvent = AuthenticationProviderAuthenticationSessionsChangeEvent

export class StatefulAuthProvider implements AuthenticationProvider, Disposable {
  static #instance: StatefulAuthProvider | null = null
  static #context: ExtensionContext | null = null

  #pendingStates: string[] = []
  #codeVerfifiers = new Map<string, string>()
  #scopes = new Map<string, string[]>()
  #disposables: Disposable[] = []
  #codeExchangePromises = new Map<
    string,
    { promise: Promise<TokenInformation>; cancel: EventEmitter<void> }
  >()
  readonly #onSessionChange = this.registerDisposable(new EventEmitter<SessionsChangeEvent>())
  readonly #onAuthEvent = this.registerDisposable(new EventEmitter<Uri>())

  public static get instance(): StatefulAuthProvider {
    this.assertContext(this.#context)

    if (!StatefulAuthProvider.#instance) {
      const instance = new StatefulAuthProvider()
      const disposable = authentication.registerAuthenticationProvider(
        AuthenticationProviders.Stateful,
        AUTH_NAME,
        instance,
      )
      instance.registerDisposable(disposable)
      StatefulAuthProvider.#instance = instance
    }

    return StatefulAuthProvider.#instance
  }

  static initialize(context: ExtensionContext) {
    this.#context = context
  }

  static assertContext(
    context: ExtensionContext | null,
  ): asserts context is NonNullable<ExtensionContext> {
    if (!context) {
      throw new Error('Missing context dependency, requires StatefulAuthProvider.initialize')
    }
  }

  async newSession(silent?: boolean): Promise<StatefulAuthSession | undefined> {
    const options: AuthenticationGetSessionOptions = {}

    if (silent !== undefined) {
      options.silent = silent
    } else {
      options.createIfNone = true
    }

    const session = await authentication.getSession(
      AuthenticationProviders.Stateful,
      DEFAULT_SCOPES,
      options,
    )

    return session as StatefulAuthSession | undefined
  }

  async currentSession() {
    const sessions = await this.getSessions(this.getScopes())
    if (!sessions.length) {
      return
    }

    return sessions[0]
  }

  async ensureSession(): Promise<StatefulAuthSession | undefined> {
    let session = await this.currentSession()
    if (session) {
      StatefulAuthProvider.showLoginNotification()
      return session
    }

    session = await StatefulAuthProvider.bootstrapFromToken()
    const forceLogin = features.isOnInContextState(FeatureName.ForceLogin) || !!session

    const silent = forceLogin ? undefined : true

    return this.newSession(silent)
      .then(() => {
        if (session) {
          StatefulAuthProvider.showLoginNotification()
          return session
        }
      })
      .catch((error) => {
        let message
        if (error instanceof Error) {
          message = error.message
        } else {
          message = JSON.stringify(error)
        }

        logger.error(message)

        // https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/browser/mainThreadAuthentication.ts#L238
        // throw new Error('User did not consent to login.')
        // Calling again to ensure User Menu Badge
        if (forceLogin && message === 'User did not consent to login.') {
          authentication.getSession(AuthenticationProviders.Stateful, DEFAULT_SCOPES, {})
        }
        return error
      })
  }

  get onDidChangeSessions() {
    return this.#onSessionChange.event
  }

  fireOnAuthEvent(data: Uri) {
    this.#onAuthEvent.fire(data)
  }

  get redirectUri() {
    StatefulAuthProvider.assertContext(StatefulAuthProvider.#context)

    const publisher = StatefulAuthProvider.#context.extension.packageJSON.publisher
    const name = StatefulAuthProvider.#context.extension.packageJSON.name

    let callbackUrl = `${env.uriScheme}://${publisher}.${name}`
    return callbackUrl
  }

  /**
   * Get the existing sessions
   * @param scopes
   * @returns
   */
  public async getSessions(scopes?: string[]): Promise<StatefulAuthSession[]> {
    try {
      const sessions = await StatefulAuthProvider.getAllSessions()
      if (!sessions.length) {
        return []
      }

      // Get all required scopes
      const allScopes = this.getScopes(scopes || []) as string[]

      if (allScopes.length) {
        if (!scopes?.length) {
          const session = await this.getSession(sessions, allScopes)
          if (session && !session.isExpired) {
            return [session]
          }

          return []
        }

        const session = await this.getSession(sessions, scopes)
        if (!session) {
          return []
        }

        if (session && !session.isExpired) {
          return [session]
        }

        await ContextState.addKey(PLATFORM_USER_SIGNED_IN, false)
        await this.removeSession(session.id)
      }
    } catch (error) {
      // Nothing to do
      let message
      if (error instanceof Error) {
        message = error.message
      } else {
        message = JSON.stringify(error)
      }
      logger.error(message)
    }

    return []
  }

  /**
   * Create a new auth session
   * @param scopes
   * @returns
   */
  async createSession(scopes: string[]): Promise<StatefulAuthSession> {
    try {
      const { accessToken, expiresIn } = await StatefulAuthProvider.instance.login(scopes)

      if (!accessToken) {
        throw new Error('Stateful login failure')
      }

      const userinfo: { name: string; email: string } =
        await StatefulAuthProvider.getUserInfo(accessToken)
      const session: StatefulAuthSession = {
        id: uuidv4(),
        expiresIn: secsToUnixTime(expiresIn),
        accessToken,
        account: {
          label: userinfo.name,
          id: userinfo.email,
        },
        scopes: this.getScopes(scopes),
        isExpired: false,
      }

      await ContextState.addKey(PLATFORM_USER_SIGNED_IN, true)

      const persist = this.persistSessions([session], {
        added: [session],
      } as unknown as SessionsChangeEvent)
      await persist

      return session
    } catch (e) {
      window.showErrorMessage(`Sign in failed: ${e}`)
      throw e
    }
  }

  /**
   * Remove an existing session
   * @param sessionId
   */
  public async removeSession(sessionId: string): Promise<void> {
    const sessions = await StatefulAuthProvider.getAllSessions()
    if (!sessions.length) {
      return
    }

    const sessionIdx = await this.findSessionIndexById(sessions, sessionId)
    if (sessionIdx < 0) {
      return
    }

    const session = sessions[sessionIdx]
    sessions.splice(sessionIdx, 1)

    await this.persistSessions(sessions, {
      removed: [session],
    } as unknown as SessionsChangeEvent)
  }

  /**
   * Dispose the registered services
   */
  public async dispose() {
    this.#disposables.forEach((d) => d.dispose())
    this.#disposables = []
    StatefulAuthProvider.#instance = null
  }

  public static async bootstrapFromToken(): Promise<StatefulAuthSession | undefined> {
    try {
      const authTokenUri = await this.instance.getAuthTokenUri()
      if (!authTokenUri) {
        logger.info('No auth token file found, halting bootstrap from token.')
        return
      }
      const { token, payload } = await this.insecureDecode(authTokenUri)
      const session = await this.buildSession(token, payload)
      await this.instance.persistSessions([session], {
        added: [session],
        removed: undefined,
        changed: undefined,
      })
      await this.deleteAuthTokenFile(authTokenUri)
      return session
    } catch (error) {
      let message
      if (error instanceof Error) {
        message = error.message
      } else {
        message = JSON.stringify(error)
      }
      logger.error(message)
    }
  }

  private async getAuthTokenUri(): Promise<Uri | undefined> {
    const authTokenPath = getAuthTokenPath()
    if (!authTokenPath) {
      return
    }

    const authTokenUri = Uri.parse(authTokenPath)
    const hasTokenFile = await workspace.fs.stat(authTokenUri).then(
      () => true,
      () => false,
    )

    if (!hasTokenFile) {
      return
    }

    return authTokenUri
  }

  /**
   * Decode a JWT token without verifying its signature.
   */
  private static async insecureDecode(authTokenUri: Uri) {
    const bytes = await workspace.fs.readFile(authTokenUri)
    if (!bytes?.length) {
      throw new Error('Failed to read token file')
    }

    const token = new TextDecoder().decode(bytes).trim()
    const payload = jwt.decode(token) as DecodedToken
    if (!payload) {
      throw new Error('Failed to decode JWT token')
    }

    return { payload, token }
  }

  private static async buildSession(token: string, payload: DecodedToken) {
    if (!payload.exp || !payload.scope) {
      throw new Error('Invalid token format, missing exp or scope')
    }

    const { name, email } = await this.getUserInfo(token)
    if (!name || !email) {
      throw new Error('Failed to get user info from JWT token')
    }

    const session: StatefulAuthSession = {
      accessToken: token,
      expiresIn: secsToUnixTime(payload.exp),
      id: uuidv4(),
      account: {
        label: name,
        id: email,
      },
      scopes: payload.scope!.split(' '),
      isExpired: false,
    }

    return session
  }

  private static async deleteAuthTokenFile(authTokenUri: Uri) {
    if (getDeleteAuthToken()) {
      logger.info(`Deleting authToken file ${authTokenUri}`)
      await workspace.fs.delete(authTokenUri)
    }
  }

  /**
   * Log in to Stateful
   */
  private async login(scopes: string[] = []): Promise<TokenInformation> {
    return await window.withProgress<TokenInformation>(
      {
        location: ProgressLocation.Notification,
        title: 'Signing in to Stateful...',
        cancellable: true,
      },
      async (_, token) => {
        const nonceId = uuidv4()

        const scopeString = scopes.join(' ')
        scopes = this.getScopes(scopes)

        const codeVerifier = toBase64UrlEncoding(crypto.randomBytes(32))
        const codeChallenge = toBase64UrlEncoding(sha256(codeVerifier))

        let callbackUri = await env.asExternalUri(Uri.parse(this.redirectUri))
        const callbackQuery = new URLSearchParams(callbackUri.query)
        const stateId = callbackQuery.get('state') || nonceId

        callbackQuery.set('state', encodeURIComponent(stateId))
        callbackQuery.set('nonce', encodeURIComponent(nonceId))
        callbackUri = callbackUri.with({
          query: callbackQuery.toString(),
        })

        this.#pendingStates.push(stateId)
        this.#codeVerfifiers.set(stateId, codeVerifier)
        this.#scopes.set(stateId, scopes)

        const searchParams = new URLSearchParams({
          state: encodeURIComponent(callbackUri.toString(true)),
          checkSession: 'true',
          scope: scopes.join(' '),
          codeChallengeMethod: 'S256',
          codeChallenge: codeChallenge,
        })

        const uri = Uri.parse(`${getRunmeAppUrl(['api'])}idp-authorize?${searchParams.toString()}`)
        await env.openExternal(uri)

        // Retrieving the codeExchangePromise corresponding to the scopeString from the map
        let codeExchangePromise = this.#codeExchangePromises.get(scopeString)
        // Checking if codeExchangePromise is not found
        if (!codeExchangePromise) {
          // Creating a new codeExchangePromise using promiseFromEvent and setting up
          // event handling with handleUri function
          codeExchangePromise = promiseFromEvent(this.#onAuthEvent.event, this.handleUri(scopes))
          // Storing the newly created codeExchangePromise in the map with the corresponding scopeString
          this.#codeExchangePromises.set(scopeString, codeExchangePromise)
        }

        try {
          // Returning the result of the first resolved promise or the first rejected promise among multiple promises
          return await Promise.race([
            // Waiting for the codeExchangePromise to resolve
            codeExchangePromise.promise,
            // Creating a new promise that rejects on timeout
            new Promise<string>((_, reject) => setTimeout(() => reject('Cancelled'), AUTH_TIMEOUT)),
            // Creating a promise based on an event, rejecting with 'User Cancelled' when
            // token.onCancellationRequested event occurs
            promiseFromEvent<any, any>(token.onCancellationRequested, (_, __, reject) => {
              reject('User Cancelled')
            }).promise,
          ])
        } finally {
          // Filtering out the current stateId from the array of pendingStates
          this.#pendingStates = this.#pendingStates.filter((n) => n !== stateId)
          // Firing the cancel event of codeExchangePromise if it exists
          codeExchangePromise?.cancel.fire()
          // Deleting the codeExchangePromise corresponding to scopeString from the map
          this.#codeExchangePromises.delete(scopeString)
          // Deleting the codeVerifier corresponding to stateId from the map
          this.#codeVerfifiers.delete(stateId)
          // Deleting the scope corresponding to stateId from the map
          this.#scopes.delete(stateId)
        }
      },
    )
  }

  /**
   * Handle the redirect to VS Code (after sign in from Stateful)
   * @param scopes
   * @returns
   */
  private handleUri: (scopes: readonly string[]) => PromiseAdapter<Uri, TokenInformation> =
    (_scopes) => async (uri, resolve, reject) => {
      const query = new URLSearchParams(uri.query)
      const code = query.get('code')
      const stateId = query.get('state')

      const accessToken = query.get('accessToken')
      const expiresIn = query.get('expiresIn')

      if (!code) {
        reject(new Error('No code'))
        return
      }
      if (!stateId) {
        reject(new Error('No state'))
        return
      }

      const codeVerifier = this.#codeVerfifiers.get(stateId)
      if (!codeVerifier) {
        reject(new Error('No code verifier'))
        return
      }

      // Check if it is a valid auth request started by the extension
      if (!this.#pendingStates.some((n) => n === stateId)) {
        reject(new Error('State not found'))
        return
      }

      if (accessToken && expiresIn) {
        resolve({ accessToken, expiresIn: Number.parseInt(expiresIn) })
        return
      }

      const postData = {
        code,
        codeVerifier,
      }

      const response = await fetch(`${getRunmeAppUrl(['api'])}idp-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(postData),
      })

      const json = await response.json()

      resolve({
        accessToken: json.accessToken,
        expiresIn: json.expiresIn,
      })
    }

  /**
   * Get the user info from Stateful
   * @param token
   * @returns
   */
  private static async getUserInfo(token: string) {
    const response = await fetch(`${getRunmeAppUrl(['api'])}idp-user-info`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    const json = await response.json()
    if (!response.ok) {
      return Promise.reject(json)
    }

    return Promise.resolve(json)
  }

  /**
   * Get all required scopes
   * @param scopes
   */
  private getScopes(scopes: string[] = []): string[] {
    const modifiedScopes = [...scopes]

    if (!modifiedScopes.includes('openid')) {
      modifiedScopes.push('openid')
    }
    if (!modifiedScopes.includes('profile')) {
      modifiedScopes.push('profile')
    }
    if (!modifiedScopes.includes('email')) {
      modifiedScopes.push('email')
    }

    return modifiedScopes.sort()
  }

  /**
   * Checks if the token is not expired, considering it invalid one hour before its actual expiration time.
   * This validation is typically used for refreshing access tokens to avoid race conditions.
   * @param expirationTime The expiration time of the token in milliseconds since Unix epoch.
   * @returns True if the token is not expired, false otherwise.
   */
  private isTokenNotExpired(expirationTime: number) {
    // Get the current time in milliseconds since Unix epoch
    const currentTime = new Date().getTime()

    // Calculate the time one hour before the token expiration time
    const oneHourBeforeExpiration = expirationTime - 60 * 60 * 1000 // Subtract one hour in milliseconds

    // Check if the current time is before one hour before the token expiration time
    return currentTime < oneHourBeforeExpiration
  }

  public static get insensitiveHashedApiUrl() {
    // used as compound key in a hash-table; does not contain sensitive data
    return crypto
      .createHash('sha1')
      .update(getRunmeAppUrl(['api']))
      .digest('hex')
  }

  public static get sessionSecretKey() {
    return `${SESSIONS_SECRET_KEY}.${this.insensitiveHashedApiUrl}`
  }

  private static async getAllSessions(): Promise<StatefulAuthSession[]> {
    this.assertContext(this.#context)

    const allSessions = await this.#context.secrets.get(this.sessionSecretKey)
    if (!allSessions) {
      return []
    }

    try {
      const sessions = JSON.parse(allSessions) as StatefulAuthSession[]
      return sessions
    } catch (_e) {
      return []
    }
  }

  private async findSessionIndexById(sessions: StatefulAuthSession[], id: string) {
    return sessions.findIndex((s) => s.id === id)
  }

  private async persistSessions(sessions: StatefulAuthSession[], changes: SessionsChangeEvent) {
    StatefulAuthProvider.assertContext(StatefulAuthProvider.#context)
    await StatefulAuthProvider.#context.secrets.store(
      StatefulAuthProvider.sessionSecretKey,
      JSON.stringify(sessions),
    )
    StatefulAuthProvider.instance.#onSessionChange.fire(changes)
  }

  protected registerDisposable<T extends Disposable>(disposable: T): T {
    this.#disposables.push(disposable)
    return disposable
  }

  async getSession(sessions: StatefulAuthSession[], scopes?: string[]) {
    const session = sessions.find((s) => scopes?.every((scope) => s.scopes.includes(scope)))

    if (!session) {
      return null
    }

    if (this.isTokenNotExpired(session.expiresIn)) {
      await ContextState.addKey(PLATFORM_USER_SIGNED_IN, true)
      return session
    }

    return { ...session, isExpired: true }
  }

  static showLoginNotification() {
    this.assertContext(this.#context)

    if (!getShowLoginNotification()) {
      return
    }

    if (!this.#context.globalState.get<boolean>(TELEMETRY_EVENTS.OpenWorkspace, true)) {
      return
    }

    const openWorkspace = 'Open Workspace'
    const dontAskAgain = "Don't ask again"

    const informationMessageCallback: (
      answer: typeof openWorkspace | typeof dontAskAgain | undefined,
    ) => void = (answer) => {
      this.assertContext(this.#context)

      if (answer === openWorkspace) {
        const dashboardUri = getRunmeAppUrl(['app'])
        const uri = Uri.parse(dashboardUri)
        env.openExternal(uri)
      } else if (answer === dontAskAgain) {
        this.#context.globalState.update(TELEMETRY_EVENTS.OpenWorkspace, false)
      }
    }

    window
      .showInformationMessage('Logged into the Stateful Cloud', openWorkspace, dontAskAgain)
      .then(informationMessageCallback)
  }
}

function secsToUnixTime(seconds: number) {
  const now = new Date()
  return new Date(now.getTime() + seconds * 1000).getTime()
}

export function toBase64UrlEncoding(buffer: Buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export function sha256(buffer: string | Uint8Array): Buffer {
  return crypto.createHash('sha256').update(buffer).digest()
}
