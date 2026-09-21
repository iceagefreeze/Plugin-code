import { Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { storage } from '@ones-open/node-sdk'
import type { InstallationInfo } from '@ones-open/node-sdk'
import { OpenApiService } from './openapi.service'

// ---- 事件类型（对应 ones:project:issue-status:changed）----
export type IssueStatusChangedEvent = {
  eventID: string
  eventType: 'ones:project:issue-status:changed'
  timestamp: number
  subscriberID?: string
  eventData: {
    organizationID?: string
    teamID?: string
    triggerUserID?: string
    issueID: string
    trigger?: string
    fromStatus?: { id: string }
    toStatus?: { id: string }
  }
}

// ---- 托管存储实体 ----
type ApprovalConfigEntity = {
  team_uuid: string
  approved_status_id: string
  approved_status_name: string
  project_template_id: string
  name_field_id: string
  owner_field_id: string
  type_field_id: string
  type_project_field_id: string
  start_field_id: string
  end_field_id: string
  updated_at: number
}

type ApprovalRecordEntity = {
  issue_uuid: string
  team_uuid: string
  event_id: string
  status: string
  project_uuid: string
  project_name: string
  project_identifier: string
  error_code: string
  error_message: string
  created_at: number
  updated_at: number
}

const configEntity = storage.entity<ApprovalConfigEntity>('approval_config')
const recordEntity = storage.entity<ApprovalRecordEntity>('approval_record')
const installationSecretEntity = storage.entity<{ installation_id: string }>('installation_secret')

// Entity key 规范：/^[_a-z0-9]{1,64}$/。teamUUID / issueUUID 可能含大写或超长，做归一化。
const toEntityKey = (id: string, prefix: string) => {
  const normalized = String(id || '').toLowerCase()
  if (/^[_a-z0-9]{1,64}$/.test(normalized) && normalized.length <= 64) return normalized
  const hash = createHash('sha256').update(String(id)).digest('hex').slice(0, 48)
  return `${prefix}_${hash}`
}
const makeKey = (id: string, prefix: string) => {
  const k = toEntityKey(id, prefix)
  const wanted = `${prefix}_${k}`
  return wanted.length <= 64 ? wanted : wanted.slice(0, 64)
}
const configKey = (teamUUID: string) => makeKey(teamUUID, 'cfg')
const recordKey = (issueUUID: string) => makeKey(issueUUID, 'rec')

// ---- 字段值归一化（OpenAPI 返回的 value 结构随类型变化）----
const fieldAsText = (v: unknown): string => {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map((x) => fieldAsText(x)).filter(Boolean).join(', ')
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    return String(o.name ?? o.value ?? o.displayValue ?? o.label ?? o.text ?? o.uuid ?? o.id ?? '')
  }
  return String(v)
}
const fieldAsOption = (v: unknown): { id: string; name: string } => {
  const arr = Array.isArray(v) ? v : [v]
  for (const item of arr) {
    if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>
      const id = String(o.uuid ?? o.id ?? o.value ?? '')
      const name = String(o.name ?? o.label ?? o.displayValue ?? o.text ?? '')
      if (id || name) return { id, name }
    }
  }
  const text = fieldAsText(v)
  return { id: text, name: text }
}

@Injectable()
export class ApprovalService {
  constructor(private readonly openApiService: OpenApiService) {}

  // ---- 安装凭据 ----
  async getInstallationInfo(): Promise<InstallationInfo | null> {
    try {
      const all = await installationSecretEntity.query().limit(1).getMany()
      const first = all?.data?.[0]
      if (!first) return null
      const v = first.value as any
      return { installation_id: v.installation_id, shared_secret: v.shared_secret, ones_base_url: v.ones_base_url }
    } catch {
      return null
    }
  }

  // ---- 配置读写 ----
  async getConfig(teamUUID: string): Promise<ApprovalConfigEntity | null> {
    try {
      const row = await configEntity.get(configKey(teamUUID))
      return (row as ApprovalConfigEntity | undefined) ?? null
    } catch {
      return null
    }
  }

  async saveConfig(teamUUID: string, patch: Partial<ApprovalConfigEntity>): Promise<ApprovalConfigEntity> {
    const existing = (await this.getConfig(teamUUID)) ?? ({} as ApprovalConfigEntity)
    const base: ApprovalConfigEntity = {
      team_uuid: teamUUID,
      approved_status_id: '',
      approved_status_name: '',
      project_template_id: 'comwater',
      name_field_id: '',
      owner_field_id: '',
      type_field_id: '',
      type_project_field_id: '',
      start_field_id: '',
      end_field_id: '',
      updated_at: Date.now(),
    }
    const merged: ApprovalConfigEntity = { ...base, ...existing, ...patch, updated_at: Date.now() }
    await configEntity.set(configKey(teamUUID), merged)
    return merged
  }

  // ---- 事件处理入口：判断是否通过状态，通过则触发创建 ----
  async handleStatusChanged(event: IssueStatusChangedEvent): Promise<{ handled: boolean; reason?: string }> {
    const data = event.eventData ?? {}
    const teamUUID = String(data.teamID ?? '')
    const issueUUID = String(data.issueID ?? '')
    const toStatus = data.toStatus
    if (!teamUUID || !issueUUID || !toStatus?.id) {
      return { handled: false, reason: 'missing team/issue/toStatus' }
    }

    const cfg = await this.getConfig(teamUUID)
    if (!cfg?.approved_status_id) {
      return { handled: false, reason: 'no approval config or no approved status set' }
    }
    if (toStatus.id !== cfg.approved_status_id) {
      return { handled: false, reason: `toStatus ${toStatus.id} != approved ${cfg.approved_status_id}` }
    }

    // 幂等：同一 issue 已 created/pending 则跳过（至少一次投递 + 重复触发场景）
    const existing = await this.getRecord(issueUUID)
    if (existing && (existing.status === 'created' || existing.status === 'pending' || existing.status === 'creating')) {
      return { handled: false, reason: `already ${existing.status}` }
    }

    // 立即返回，后台执行创建逻辑（事件回调需快速返回）
    void this.createProjectForIssue(teamUUID, issueUUID, event.eventID, cfg).catch((err) => {
      console.error(`[approval] 后台创建失败 issue=${issueUUID}`, err)
    })
    return { handled: true, reason: 'dispatched' }
  }

  // ---- 核心：读审批单字段 → 创建项目 → 回写属性 ----
  async createProjectForIssue(
    teamUUID: string,
    issueUUID: string,
    eventID: string,
    cfg: ApprovalConfigEntity,
  ): Promise<ApprovalRecordEntity> {
    const rk = recordKey(issueUUID)
    const now = Date.now()
    const creating: ApprovalRecordEntity = {
      issue_uuid: issueUUID,
      team_uuid: teamUUID,
      event_id: eventID,
      status: 'creating',
      project_uuid: '',
      project_name: '',
      project_identifier: '',
      error_code: '',
      error_message: '',
      created_at: now,
      updated_at: now,
    }
    await recordEntity.set(rk, creating)

    try {
      const installRow = await this.getInstallationInfo()
      if (!installRow) throw new Error('installation info not found')

      const issueDetail = await this.openApiService.callV2(
        installRow,
        `/project/issues/${issueUUID}`,
        { method: 'GET', query: { teamID: teamUUID } },
      )
      const issue = issueDetail?.data ?? issueDetail
      const fieldValues: Record<string, unknown> = {}
      for (const fv of (issue?.fieldValues ?? []) as Array<{ fieldID: string; value: unknown }>) {
        if (fv?.fieldID) fieldValues[fv.fieldID] = fv.value
      }

      const readField = (fieldId: string): unknown => (fieldId ? fieldValues[fieldId] : undefined)
      const name = String(readField(cfg.name_field_id) ?? issue?.title ?? '').trim()
      const ownerRaw = readField(cfg.owner_field_id) ?? issue?.assignee
      const owner = fieldAsOption(ownerRaw).id
      const startDate = fieldAsText(readField(cfg.start_field_id) ?? issue?.planStartDate)
      const endDate = fieldAsText(readField(cfg.end_field_id) ?? issue?.planEndDate)
      const typeOption = fieldAsOption(readField(cfg.type_field_id))

      if (!name) throw new Error('立项单缺少项目名称（未配置名称字段且无标题）')

      const members = owner ? [owner] : []
      const createBody: Record<string, unknown> = { name, members }
      if (cfg.project_template_id) createBody.templateID = cfg.project_template_id
      const createResp = await this.openApiService.callV2(
        installRow,
        `/project/projects`,
        { method: 'POST', query: { teamID: teamUUID }, body: createBody },
      )
      const createData = createResp?.data ?? createResp
      const projectID = String(createData?.id ?? '')
      if (!projectID) throw new Error(`创建接口未返回项目ID: ${JSON.stringify(createResp).slice(0, 300)}`)

      const updateBody: Record<string, unknown> = {}
      if (startDate) updateBody.plannedStartDate = startDate
      if (endDate) updateBody.plannedEndDate = endDate
      if (owner) updateBody.owner = owner
      if (cfg.type_project_field_id && typeOption.id) {
        const optId = await this.resolveProjectTypeOption(installRow, teamUUID, cfg.type_project_field_id, typeOption)
        if (optId) updateBody.customField = { [cfg.type_project_field_id]: optId }
      }
      if (Object.keys(updateBody).length) {
        await this.openApiService.callV2(
          installRow,
          `/project/projects/${projectID}`,
          { method: 'PUT', query: { teamID: teamUUID }, body: updateBody },
        )
      }

      const done: ApprovalRecordEntity = {
        ...creating,
        status: 'created',
        project_uuid: projectID,
        project_name: name,
        updated_at: Date.now(),
      }
      await recordEntity.set(rk, done)
      console.log(`[approval] 项目创建成功 issue=${issueUUID} project=${projectID} name=${name}`)
      return done
    } catch (err: any) {
      const failed: ApprovalRecordEntity = {
        ...creating,
        status: 'failed',
        error_code: err?.code ?? 'CREATE_FAILED',
        error_message: String(err?.message ?? err ?? '未知错误').slice(0, 4096),
        updated_at: Date.now(),
      }
      await recordEntity.set(rk, failed)
      console.error(`[approval] 创建失败 issue=${issueUUID}:`, err?.message ?? err)
      return failed
    }
  }

  // ---- 项目类型选项：审批单里的选项名映射到项目自定义属性的选项 id ----
  private async resolveProjectTypeOption(
    installRow: InstallationInfo,
    teamUUID: string,
    projectFieldId: string,
    sourceOption: { id: string; name: string },
  ): Promise<string | null> {
    const list = await this.openApiService.callV2(installRow, `/project/projectFields`, {
      method: 'GET',
      query: { teamID: teamUUID },
    })
    const fields = (list?.data?.fields ?? list?.fields ?? []) as Array<{
      id: string
      name: string
      typeLabel?: string
      options?: Array<{ id: string; value?: string; name?: string }>
    }>
    const field = fields.find((f) => f.id === projectFieldId)
    if (!field?.options?.length) return null
    const want = sourceOption.name || sourceOption.id
    const match = field.options.find((o) => {
      const label = String(o?.value ?? o?.name ?? o?.id ?? '').trim()
      return label && (label === want || label === sourceOption.id)
    })
    return match?.id ?? null
  }

  // ---- 记录读写 ----
  async getRecord(issueUUID: string): Promise<ApprovalRecordEntity | null> {
    try {
      const row = await recordEntity.get(recordKey(issueUUID))
      return (row as ApprovalRecordEntity | undefined) ?? null
    } catch {
      return null
    }
  }

  async listRecords(teamUUID: string): Promise<ApprovalRecordEntity[]> {
    try {
      const result = await recordEntity.query().limit(200).getMany()
      const rows = result?.data ?? []
      return rows.map((r) => r.value as ApprovalRecordEntity).filter((r) => !teamUUID || r.team_uuid === teamUUID)
    } catch {
      return []
    }
  }
}
