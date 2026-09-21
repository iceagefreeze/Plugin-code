import { Injectable } from '@nestjs/common'
import { oauth } from '@ones-open/node-sdk'
import type { InstallationInfo } from '@ones-open/node-sdk'

export type OpenApiCallOptions = {
  api: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Record<string, string | undefined>
}

@Injectable()
export class OpenApiService {
  /**
   * 以应用身份调用 ONES OpenAPI。installationInfo 来自 install 回调持久化的凭据。
   * 统一前缀 /openapi/v2，返回解析后的 JSON（204 返回 null）。
   */
  async call(
    installationInfo: InstallationInfo,
    { api, method, body, query }: OpenApiCallOptions,
    userID?: string,
  ): Promise<any> {
    const accessToken = await oauth.getAccessTokenByInstallationInfo(installationInfo, userID)
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
