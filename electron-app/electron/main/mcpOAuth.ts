import { createServer, type Server } from 'node:http'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import os from 'node:os'
import path from 'node:path'
import { shell } from 'electron'
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js'

export type McpOAuthConfig = {
  enabled?: boolean
  clientId?: string
  clientSecret?: string
  redirectUri?: string
  scope?: string
}

export type McpOAuthServerConfig = {
  url?: string
  oauth?: boolean | McpOAuthConfig
}

export type McpServerAuthState = 'none' | 'authenticated' | 'needs_sign_in'

type McpOAuthSessionFile = {
  tokens?: OAuthTokens
  codeVerifier?: string
  clientInformation?: OAuthClientInformationMixed
  discoveryState?: OAuthDiscoveryState
}

export const mcpOAuthEvents = new EventEmitter()

let callbackServer: Server | null = null
let callbackBaseUrl: string | null = null
let callbackServerPromise: Promise<string> | null = null

const stateToServerId = new Map<string, string>()

export function getMcpOAuthDir(): string {
  return path.join(os.homedir(), '.voidcast', 'mcp-oauth')
}

function sessionFilePath(serverId: string): string {
  const safe = serverId.replace(/[^a-zA-Z0-9._-]+/g, '_')
  return path.join(getMcpOAuthDir(), `${safe}.json`)
}

async function readSession(serverId: string): Promise<McpOAuthSessionFile> {
  const filePath = sessionFilePath(serverId)
  if (!existsSync(filePath)) return {}
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as McpOAuthSessionFile
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function writeSession(serverId: string, session: McpOAuthSessionFile): Promise<void> {
  const dir = getMcpOAuthDir()
  await mkdir(dir, { recursive: true })
  await writeFile(sessionFilePath(serverId), `${JSON.stringify(session, null, 2)}\n`, 'utf8')
}

export function isMcpOAuthEnabled(config: McpOAuthServerConfig | undefined): boolean {
  if (!config?.url) return false
  const oauth = config.oauth
  if (oauth === true) return true
  if (oauth && typeof oauth === 'object' && oauth.enabled !== false) return true
  return false
}

export async function hasMcpOAuthTokens(serverId: string): Promise<boolean> {
  const session = await readSession(serverId)
  return Boolean(session.tokens?.access_token)
}

export async function clearMcpOAuthSession(serverId: string): Promise<void> {
  const filePath = sessionFilePath(serverId)
  if (existsSync(filePath)) {
    await rm(filePath, { force: true })
  }
}

function oauthConfig(config: McpOAuthServerConfig): McpOAuthConfig {
  if (config.oauth === true) return {}
  if (config.oauth && typeof config.oauth === 'object') return config.oauth
  return {}
}

function successHtml(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Voidcast MCP</title></head><body style="font-family:system-ui,sans-serif;padding:2rem"><h1>Voidcast</h1><p>${message}</p><p>You can close this tab and return to the app.</p></body></html>`
}

function parseCallbackUrl(reqUrl: string): URL {
  return new URL(reqUrl, 'http://127.0.0.1')
}

async function handleOAuthCallback(reqUrl: string, res: import('node:http').ServerResponse): Promise<void> {
  const url = parseCallbackUrl(reqUrl)
  const code = url.searchParams.get('code')?.trim()
  const state = url.searchParams.get('state')?.trim()
  const oauthError = url.searchParams.get('error')?.trim()

  if (oauthError) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(successHtml(`Authorization failed: ${oauthError}`))
    return
  }

  if (!code || !state) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(successHtml('Missing authorization code.'))
    return
  }

  const serverId = stateToServerId.get(state)
  stateToServerId.delete(state)
  if (!serverId) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(successHtml('Unknown or expired OAuth session.'))
    return
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(successHtml('Signed in successfully.'))
  mcpOAuthEvents.emit('authorization_code', { serverId, code })
}

export async function ensureMcpOAuthCallbackUrl(): Promise<string> {
  if (callbackBaseUrl) return callbackBaseUrl
  if (callbackServerPromise) return callbackServerPromise

  callbackServerPromise = new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const reqUrl = req.url ?? '/'
      if (!reqUrl.startsWith('/callback')) {
        res.writeHead(404)
        res.end()
        return
      }
      void handleOAuthCallback(reqUrl, res).catch((error) => {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end(error instanceof Error ? error.message : String(error))
      })
    })

    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      if (!port) {
        reject(new Error('Failed to start MCP OAuth callback server.'))
        return
      }
      callbackServer = server
      callbackBaseUrl = `http://127.0.0.1:${port}/callback`
      resolve(callbackBaseUrl)
    })
  })

  return callbackServerPromise
}

export async function stopMcpOAuthCallbackServer(): Promise<void> {
  if (!callbackServer) return
  await new Promise<void>((resolve, reject) => {
    callbackServer!.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
  callbackServer = null
  callbackBaseUrl = null
  callbackServerPromise = null
  stateToServerId.clear()
}

class VoidcastMcpOAuthProvider implements OAuthClientProvider {
  private session: McpOAuthSessionFile | null = null
  private redirectUri: string | null = null

  constructor(
    private readonly serverId: string,
    private readonly serverUrl: string,
    private readonly config: McpOAuthServerConfig,
  ) {}

  private async loadSession(): Promise<McpOAuthSessionFile> {
    if (!this.session) {
      this.session = await readSession(this.serverId)
    }
    return this.session
  }

  private async persistSession(): Promise<void> {
    if (!this.session) return
    await writeSession(this.serverId, this.session)
  }

  get redirectUrl(): string | URL | undefined {
    const custom = oauthConfig(this.config).redirectUri?.trim()
    if (custom) return custom
    if (!callbackBaseUrl) {
      throw new Error('MCP OAuth callback server is not ready.')
    }
    return callbackBaseUrl
  }

  get clientMetadata(): OAuthClientMetadata {
    const redirect = String(this.redirectUri ?? callbackBaseUrl ?? '')
    const scope = oauthConfig(this.config).scope?.trim()
    return {
      client_name: 'Voidcast',
      redirect_uris: redirect ? [redirect] : [],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: oauthConfig(this.config).clientSecret ? 'client_secret_post' : 'none',
      ...(scope ? { scope } : {}),
    }
  }

  async state(): Promise<string> {
    const nonce = randomBytes(12).toString('hex')
    const value = `${this.serverId}:${nonce}`
    stateToServerId.set(value, this.serverId)
    return value
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    const fromConfig = oauthConfig(this.config)
    if (fromConfig.clientId?.trim()) {
      return {
        client_id: fromConfig.clientId.trim(),
        ...(fromConfig.clientSecret?.trim()
          ? { client_secret: fromConfig.clientSecret.trim() }
          : {}),
      }
    }
    return this.session?.clientInformation
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    const session = await this.loadSession()
    session.clientInformation = clientInformation
    this.session = session
    await this.persistSession()
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const session = await this.loadSession()
    return session.tokens
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const session = await this.loadSession()
    session.tokens = tokens
    this.session = session
    await this.persistSession()
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    this.redirectUri = String(this.redirectUrl)
    await shell.openExternal(authorizationUrl.toString())
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    const session = await this.loadSession()
    session.codeVerifier = codeVerifier
    this.session = session
    await this.persistSession()
  }

  async codeVerifier(): Promise<string> {
    const session = await this.loadSession()
    if (!session.codeVerifier) {
      throw new Error('Missing OAuth PKCE code verifier.')
    }
    return session.codeVerifier
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    const session = await this.loadSession()
    session.discoveryState = state
    this.session = session
    await this.persistSession()
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    const session = await this.loadSession()
    return session.discoveryState
  }

  async invalidateCredentials(
    scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery',
  ): Promise<void> {
    const session = await this.loadSession()
    if (scope === 'all') {
      this.session = {}
      await clearMcpOAuthSession(this.serverId)
      return
    }
    if (scope === 'client') delete session.clientInformation
    if (scope === 'tokens') delete session.tokens
    if (scope === 'verifier') delete session.codeVerifier
    if (scope === 'discovery') delete session.discoveryState
    this.session = session
    await this.persistSession()
  }
}

export async function createVoidcastMcpOAuthProvider(
  serverId: string,
  config: McpOAuthServerConfig,
  serverUrl: string,
): Promise<VoidcastMcpOAuthProvider> {
  await ensureMcpOAuthCallbackUrl()
  return new VoidcastMcpOAuthProvider(serverId, serverUrl, config)
}

export function transportHasFinishAuth(
  transport: unknown,
): transport is { finishAuth: (authorizationCode: string) => Promise<void> } {
  return (
    typeof transport === 'object' &&
    transport !== null &&
    'finishAuth' in transport &&
    typeof (transport as { finishAuth?: unknown }).finishAuth === 'function'
  )
}
