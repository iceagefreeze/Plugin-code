import { Injectable } from '@nestjs/common'
import { oauth } from '@ones-open/node-sdk'
import type { InstallationInfo } from '@ones-open/node-sdk'

export type OpenApiCallOptions = {
  api: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Record<string, string | undefined>
}

type CachedToken = {
  token: string
  expiresAt: number
}

@Injectable()
export class OpenApiService {
  // 进程内 token 缓存 + 并发去重。ONES 对同一 installation 频繁并发换 token 会把部分 token 判为 not active，
  // 必须复用已换到的 token，避免每个请求都现场换。
  private tokenCache = new Map<string, CachedToken>()
  private inflight = new Map<string, Promise<string>>()
  private readonly TOKEN_TTL_MS = 10 * 60 * 1000

  private async getToken(installationInfo: InstallationInfo, userID?: string): Promise<string> {
    const key = `${installationInfo.installation_id}:${userID ?? ''}`
    const cached = this.tokenCache.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token
    }
    const existing = this.inflight.get(key)
    if (existing) return existing
    const promise = (async () => {
      const token = await oauth.getAccessTokenByInstallationInfo(installationInfo, userID)
      this.tokenCache.set(key, { token, expiresAt: Date.now() + this.TOKEN_TTL_MS })
      return token
    })()
    this.inflight.set(key, promise)
    try {
      return await promise
    } finally {
      this.inflight.delete(key)
    }
  }

  clearToken(installationID: string) {
    for (const key of this.tokenCache.keys()) {
      if (key.startsWith(installationID + ':')) this.tokenCache.delete(key)
    }
  }

  /**
   * 以应用身份调用 ONES OpenAPI。installationInfo 来自 install 回调持久化的凭据。
   * 统一前缀 /openapi/v2，返回解析后的 JSON（204 返回 null）。
   */
  async call(
    installationInfo: InstallationInfo,
    { api, method, body, query }: OpenApiCallOptions,
    userID?: string,
  ): Promise<any> {
    const accessToken = await this.getToken(installationInfo, userID)
    const apiURL = new URL(api, installationInfo.ones_base_url)
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== '') apiURL.searchParams.set(key, value)
      }
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` }
    const requestOptions: RequestInit = { method, headers }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      requestOptions.body = JSON.stringify(body)
    }
    const response = await fetch(apiURL.toString(), requestOptions)
    if (!response.ok) {
      const text = await response.text()
      if (response.status === 401 && text.includes('NotActive')) {
        this.tokenCache.delete(`${installationInfo.installation_id}:${userID ?? ''}`)
      }
      throw new Error(`ONES OpenAPI ${method} ${api} failed: ${response.status} ${text}`)
    }
    if (response.status === 204) return null
    return await response.json()
  }

  /** 以应用身份调用，自动补全 /openapi/v2 前缀 */
  async callV2(
    installationInfo: InstallationInfo,
    path: string,
    options: Omit<OpenApiCallOptions, 'api'>,
    userID?: string,
  ): Promise<any> {
    return this.call(installationInfo, { ...options, api: `/openapi/v2${path}` }, userID)
  }
}
