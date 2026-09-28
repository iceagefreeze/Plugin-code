import { Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { storage } from '@ones-open/node-sdk'
import type { InstallationInfo } from '@ones-open/node-sdk'
import { OpenApiService } from './openapi.service'

// ---- 事件类型（对应 ones:project:issue-status:changed）----
export type ApprovalStatusChangedEvent = {
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
  approval_project_uuid: string
  approval_issue_type_id: string
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
      // 优先取固定 key 'current'（install 回调每次覆盖），避免取到旧的失效凭据
      const current = (await installationSecretEntity.get('current')) as any
      if (current?.installation_id && current?.shared_secret && current?.ones_base_url) {
        console.log(`[getInstallationInfo] 命中 current key, installation_id=${current.installation_id}`)
        return { installation_id: current.installation_id, shared_secret: current.shared_secret, ones_base_url: current.ones_base_url }
      }
      // 兜底：取最新一条（updated_at 最大）
      const all = await installationSecretEntity.query().limit(20).getMany()
      const rows = all?.data ?? []
      const sorted = rows
        .map((r) => r.value as any)
        .filter((v) => v?.installation_id && v?.shared_secret && v?.ones_base_url)
        .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
      if (!sorted.length) {
        console.error('[getInstallationInfo] 无可用凭据（current 为空，且无历史记录）')
        return null
      }
      const v = sorted[0]
      console.log(`[getInstallationInfo] 兜底取最新, installation_id=${v.installation_id}`)
      return { installation_id: v.installation_id, shared_secret: v.shared_secret, ones_base_url: v.ones_base_url }
    } catch (e: any) {
      console.error('[getInstallationInfo] 异常', e?.message)
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
      approval_project_uuid: '',
      approval_issue_type_id: '',
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

  // ---- 事件处理入口：审批状态 = approved 即触发，含项目/类型校验 ----
  async handleStatusChanged(event: ApprovalStatusChangedEvent): Promise<{ handled: boolean; reason?: string }> {
    const data = event.eventData ?? {}
    const teamUUID = String(data.teamID ?? '')
    const issueUUID = String(data.issueID ?? '')
    const toStatusID = String(data.toStatus?.id ?? '')
    if (!teamUUID || !issueUUID || !toStatusID) {
      return { handled: false, reason: 'missing team/issue/toStatus' }
    }

    const cfg = await this.getConfig(teamUUID)
    if (!cfg?.approved_status_id) {
      return { handled: false, reason: 'no approval config or no approved status set' }
    }
    if (toStatusID !== cfg.approved_status_id) {
      return { handled: false, reason: `toStatus ${toStatusID} != approved ${cfg.approved_status_id}` }
    }

    // 幂等：同一 issue 已 created/pending 则跳过（至少一次投递 + 重复触发场景）
    const existing = await this.getRecord(issueUUID)
    if (existing && (existing.status === 'created' || existing.status === 'pending' || existing.status === 'creating')) {
      return { handled: false, reason: `already ${existing.status}` }
    }

    // 立即返回，后台执行（含详情读取 + 项目/类型校验 + 创建）
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

      // 项目/类型校验：定位审批单（只处理配置指定的审批项目 + 审批单类型）
      const issueProjectID = String(issue?.project?.id ?? '')
      const issueTypeID = String(issue?.issueType?.id ?? '')
      if (cfg.approval_project_uuid && issueProjectID && issueProjectID !== cfg.approval_project_uuid) {
        throw new Error(`工作项所属项目 ${issueProjectID} 不是配置的审批项目 ${cfg.approval_project_uuid}`)
      }
      if (cfg.approval_issue_type_id && issueTypeID && issueTypeID !== cfg.approval_issue_type_id) {
        throw new Error(`工作项类型 ${issueTypeID} 不是配置的审批单类型 ${cfg.approval_issue_type_id}`)
      }

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

  // ---- 配置页下拉：团队列表 ----
  async listTeams(): Promise<Array<{ id: string; name: string }>> {
    const install = await this.getInstallationInfo()
    if (!install) return []
    try {
      const resp = await this.openApiService.callV2(install, '/account/teams', { method: 'GET' })
      const teams = resp?.data?.teams ?? resp?.teams ?? []
      return (Array.isArray(teams) ? teams : []).map((t: any) => ({ id: String(t.id ?? ''), name: String(t.name ?? '') }))
    } catch (e: any) {
      console.error('[approval] 获取团队列表失败', e?.message)
      return []
    }
  }

  // ---- 配置页下拉：项目列表 + 工作项类型列表 ----
  async listProjects(teamUUID: string): Promise<Array<{ id: string; name: string }>> {
    const install = await this.getInstallationInfo()
    if (!install) {
      console.error('[approval] 获取项目列表失败：无安装凭据')
      return []
    }
    try {
      // 分页拉全（默认 limit=50 会截断，项目多的团队搜不到后面的）
      const all: Array<{ id: string; name: string }> = []
      let cursor: string | undefined
      let guard = 0
      do {
        const resp = await this.openApiService.callV2(install, '/project/projects', {
          method: 'GET',
          query: { teamID: teamUUID, limit: '100', cursor },
        })
        const list = resp?.data?.list ?? resp?.data ?? resp?.list ?? []
        const arr = Array.isArray(list) ? list : []
        for (const p of arr) all.push({ id: String(p.id ?? ''), name: String(p.name ?? '') })
        const pageInfo = resp?.data?.pageInfo ?? resp?.pageInfo
        cursor = pageInfo?.hasNextPage ? pageInfo?.endCursor : undefined
        guard += 1
        if (!pageInfo?.hasNextPage) break
      } while (cursor && guard < 50)
      console.log(`[approval] listProjects teamID=${teamUUID} 共 ${all.length} 个项目`)
      return all
    } catch (e: any) {
      console.error('[approval] 获取项目列表失败 teamID=' + teamUUID, e?.message)
      return []
    }
  }

  async listIssueTypes(teamUUID: string): Promise<Array<{ id: string; name: string }>> {
    const install = await this.getInstallationInfo()
    if (!install) {
      console.error('[approval] 获取类型列表失败：无安装凭据')
      return []
    }
    try {
      const all: Array<{ id: string; name: string }> = []
      let cursor: string | undefined
      let guard = 0
      do {
        const resp = await this.openApiService.callV2(install, '/project/issueTypes', {
          method: 'GET',
          query: { teamID: teamUUID, limit: '100', cursor },
        })
        const list = resp?.data?.list ?? resp?.data ?? resp?.list ?? []
        const arr = Array.isArray(list) ? list : []
        for (const t of arr) all.push({ id: String(t.id ?? ''), name: String(t.name ?? '') })
        const pageInfo = resp?.data?.pageInfo ?? resp?.pageInfo
        cursor = pageInfo?.hasNextPage ? pageInfo?.endCursor : undefined
        guard += 1
        if (!pageInfo?.hasNextPage) break
      } while (cursor && guard < 50)
      console.log(`[approval] listIssueTypes teamID=${teamUUID} 共 ${all.length} 个类型`)
      return all
    } catch (e: any) {
      console.error('[approval] 获取工作项类型列表失败 teamID=' + teamUUID, e?.message)
      return []
    }
  }
}
