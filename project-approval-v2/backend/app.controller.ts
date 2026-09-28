import { Controller, Get, Post, HttpCode, Body, Query, Headers } from '@nestjs/common'
import { AppService, type InstallCallbackPayload } from './app.service'
import { ApprovalService, type ApprovalStatusChangedEvent } from './services/approval.service'
import { OpenApiService } from './services/openapi.service'
import { createWebPageURL } from './utils'

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly approvalService: ApprovalService,
    private readonly openApiService: OpenApiService,
  ) {}

  @Get('/health_check')
  healthCheck() {
    return this.appService.healthCheck()
  }

  @Post('/install_cb')
  @HttpCode(200)
  installCallback(@Body() body: InstallCallbackPayload) {
    return this.appService.installCallback(body)
  }

  @Post('/app_setting_entries')
  @HttpCode(200)
  getCustomEntries() {
    return {
      entries: [
        { title: '立项审批配置', page_url: createWebPageURL('approval-config.html') },
        { title: '创建记录', page_url: createWebPageURL('approval-records.html') },
      ],
    }
  }

  // ---- 事件 webhook ----
  @Post('/events/webhook')
  @HttpCode(200)
  async handleEventWebhook(
    @Body() body: unknown,
    @Headers('x-ones-event-type') headerEventType?: string,
  ) {
    const event = body as Partial<ApprovalStatusChangedEvent> | null | undefined
    const eventType = event?.eventType ?? headerEventType
    console.log(`[webhook] 收到事件 eventType=${eventType} headerEventType=${headerEventType} body=${JSON.stringify(body).slice(0, 800)}`)
    if (eventType === 'ones:events:health') {
      return { ok: true, message: 'health check passed' }
    }
    if (eventType !== 'ones:project:issue-status:changed') {
      return { ok: false, error: `unhandled event type: ${eventType}` }
    }
    const result = await this.approvalService.handleStatusChanged(event as ApprovalStatusChangedEvent)
    console.log(`[webhook] 事件处理结果 ${JSON.stringify(result)}`)
    return { ok: true, ...result }
  }

  // ---- 配置页 API ----
  @Get('/api/config')
  @HttpCode(200)
  async getConfig(@Query('team_uuid') teamUUID?: string) {
    if (!teamUUID) return { ok: false, error: 'missing team_uuid' }
    const config = await this.approvalService.getConfig(teamUUID)
    return { ok: true, config }
  }

  @Post('/api/config')
  @HttpCode(200)
  async saveConfig(@Body() body: Record<string, any>) {
    const teamUUID = String(body.team_uuid ?? '')
    if (!teamUUID) return { ok: false, error: 'missing team_uuid' }
    const { team_uuid: _drop, ...patch } = body
    const config = await this.approvalService.saveConfig(teamUUID, patch)
    return { ok: true, config }
  }

  // ---- 配置页需要动态拉取的状态 / 字段列表 ----
  @Get('/api/options/statuses')
  @HttpCode(200)
  async listStatuses(@Query('team_uuid') teamUUID?: string) {
    if (!teamUUID) return { ok: false, error: 'missing team_uuid' }
    const install = await this.approvalService.getInstallationInfo()
    if (!install) return { ok: false, error: 'no installation info' }
    try {
      const resp = await this.openApiService.callV2(install, '/project/issueStatuses', {
        method: 'GET',
        query: { teamID: teamUUID },
      })
      return { ok: true, list: resp?.data?.list ?? resp?.list ?? [] }
    } catch (e: any) {
      console.error('[approval] statuses 接口调用失败', e?.message ?? e)
      return { ok: false, error: String(e?.message ?? e) }
    }
  }

  @Get('/api/options/teams')
  @HttpCode(200)
  async listTeams() {
    const list = await this.approvalService.listTeams()
    return { ok: true, list }
  }

  @Get('/api/options/projects')
  @HttpCode(200)
  async listProjects(@Query('team_uuid') teamUUID?: string) {
    console.log(`[approval] GET /api/options/projects 收到 team_uuid=${teamUUID}`)
    if (!teamUUID) return { ok: false, error: 'missing team_uuid' }
    const list = await this.approvalService.listProjects(teamUUID)
    return { ok: true, list }
  }

  @Get('/api/options/issue-types')
  @HttpCode(200)
  async listIssueTypes(@Query('team_uuid') teamUUID?: string) {
    console.log(`[approval] GET /api/options/issue-types 收到 team_uuid=${teamUUID}`)
    if (!teamUUID) return { ok: false, error: 'missing team_uuid' }
    const list = await this.approvalService.listIssueTypes(teamUUID)
    return { ok: true, list }
  }

  @Get('/api/options/issue-fields')
  @HttpCode(200)
  async listIssueFields(@Query('team_uuid') teamUUID?: string) {
    if (!teamUUID) return { ok: false, error: 'missing team_uuid' }
    const install = await this.approvalService.getInstallationInfo()
    if (!install) return { ok: false, error: 'no installation info' }
    try {
      // searchIssueFields：完整可搜索属性目录（旧 issueFields 接口不完整，字段多时返回空）
      const all: Array<{ id: string; name: string; fieldType?: string; fieldTypeName?: string }> = []
      let cursor: string | undefined
      let guard = 0
      do {
        const resp = await this.openApiService.callV2(install, '/project/searchIssueFields', {
          method: 'GET',
          query: { teamID: teamUUID, limit: '500', cursor },
        })
        const list = resp?.data?.list ?? resp?.list ?? []
        const arr = Array.isArray(list) ? list : []
        for (const f of arr) all.push({ id: String(f.id ?? ''), name: String(f.name ?? ''), fieldType: String(f.fieldType ?? ''), fieldTypeName: String(f.fieldTypeName ?? '') })
        const pageInfo = resp?.data?.pageInfo ?? resp?.pageInfo
        cursor = pageInfo?.hasNextPage ? pageInfo?.endCursor : undefined
        guard += 1
        if (!pageInfo?.hasNextPage) break
      } while (cursor && guard < 20)
      console.log(`[approval] listIssueFields teamID=${teamUUID} 共 ${all.length} 个字段`)
      return { ok: true, list: all }
    } catch (e: any) {
      console.error('[approval] issueFields 接口调用失败', e?.message ?? e)
      return { ok: false, error: String(e?.message ?? e) }
    }
  }

  @Get('/api/options/project-fields')
  @HttpCode(200)
  async listProjectFields(@Query('team_uuid') teamUUID?: string) {
    if (!teamUUID) return { ok: false, error: 'missing team_uuid' }
    const install = await this.approvalService.getInstallationInfo()
    if (!install) return { ok: false, error: 'no installation info' }
    try {
      const resp = await this.openApiService.callV2(install, '/project/projectFields', {
        method: 'GET',
        query: { teamID: teamUUID },
      })
      return { ok: true, list: resp?.data?.fields ?? resp?.fields ?? [] }
    } catch (e: any) {
      console.error('[approval] projectFields 接口调用失败', e?.message ?? e)
      return { ok: false, error: String(e?.message ?? e) }
    }
  }

  // ---- 记录列表 ----
  @Get('/api/records')
  @HttpCode(200)
  async listRecords(@Query('team_uuid') teamUUID?: string) {
    if (!teamUUID) return { ok: false, error: 'missing team_uuid' }
    const records = await this.approvalService.listRecords(teamUUID)
    return { ok: true, records }
  }
}
