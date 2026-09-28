import { Injectable, OnApplicationShutdown } from '@nestjs/common'
import { storage } from '@ones-open/node-sdk'

export type InstallCallbackPayload = {
  installation_id: string
  shared_secret: string
  ones_base_url: string
}

type InstallationSecretEntity = {
  installation_id: string
  shared_secret: string
  ones_base_url: string
  updated_at: number
}

const installationSecretEntity = storage.entity<InstallationSecretEntity>('installation_secret')

@Injectable()
export class AppService implements OnApplicationShutdown {
  healthCheck() {
    return { ok: true }
  }

  async installCallback(payload: InstallCallbackPayload) {
    const installationId = (payload.installation_id || '').trim()
    const row: InstallationSecretEntity = {
      installation_id: installationId,
      shared_secret: (payload.shared_secret || '').trim(),
      ones_base_url: (payload.ones_base_url || '').trim(),
      updated_at: Date.now(),
    }
    console.log(`[install_cb] 收到安装回调 installation_id=${installationId} base_url=${row.ones_base_url} shared_secret长度=${row.shared_secret.length}`)

    try {
      // 用 installation_id 存一份（追溯），同时用固定 key 存最新凭据（覆盖旧值）
      await installationSecretEntity.set(installationId, row)
      await installationSecretEntity.set('current', row)
      console.log(`[install_cb] 凭据已写入 current key`)
      return { ok: true }
    } catch (error) {
      console.error('install-callback: failed to save shared_secret', error)
      return { ok: false, error: 'failed to save install callback data' }
    }
  }

  onApplicationShutdown(signal?: string) {
    console.log('shutdown signal:', signal)
  }
}
