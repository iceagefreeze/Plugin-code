import { Controller, Get, Post, HttpCode, Body, Query, Headers } from '@nestjs/common'
import { AppService, type InstallCallbackPayload } from './app.service'
import { ApprovalService, type IssueStatusChangedEvent } from './services/approval.service'
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
    const event = body as Partial<IssueStatusChangedEvent> | null | undefined
    const eventType = event?.eventType ?? headerEventType
    if (eventType === 'ones:events:health') {
      return { ok: true, message: 'health check passed' }
    }
    if (eventType !== 'ones:project:issue-status:changed') {
      return { ok: false, error: `unhandled event type: ${eventType}` }
    }
    const result = await this.approvalService.handleStatusChanged(event as IssueStatusChangedEvent)
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
    const resp = await this.openApiService.callV2(install, '/project/issueStatuses', {
      method: 'GET',
      query: { teamID: teamUUID },
    })
    return { ok: true, list: resp?.data?.list ?? resp?.list ?? [] }
  }

  @Get('/api/options/issue-fields')
  @HttpCode(200)
  async listIssueFields(@Query('team_uuid') teamUUID?: string) {
    if (!teamUUID) return { ok: false, error: 'missing team_uuid' }
    const install = await this.approvalService.getInstallationInfo()
    if (!install) return { ok: false, error: 'no installation info' }
    const resp = await this.openApiService.callV2(install, '/project/issueFields', {
      method: 'GET',
      query: { teamID: teamUUID },
    })
    return { ok: true, list: resp?.data?.list ?? resp?.list ?? [] }
  }

  @Get('/api/options/project-fields')
  @HttpCode(200)
  async listProjectFields(@Query('team_uuid') teamUUID?: string) {
    if (!teamUUID) return { ok: false, error: 'missing team_uuid' }
    const install = await this.approvalService.getInstallationInfo()
    if (!install) return { ok: false, error: 'no installation info' }
    const resp = await this.openApiService.callV2(install, '/project/projectFields', {
      method: 'GET',
      query: { teamID: teamUUID },
    })
    return { ok: true, list: resp?.data?.fields ?? resp?.fields ?? [] }
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
