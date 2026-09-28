import { storage } from '@ones-op/sdk/node'
import { OPFetch, FetchAsAdmin } from '@ones-op/fetch'
import { Logger } from '@ones-op/node-logger'
import type { PluginRequest, PluginResponse } from '@ones-op/node-types'

const records = storage.entity('appr_rec_v2')
const configs = storage.entity('appr_cfg_v2')
// Fallback for environments where Entity Storage is unavailable.
let runtimeConfig: any = {}
const runtimeRecords: any = {}
const ok = (data: unknown = null): PluginResponse => ({ body: { ok: true, data, error: null } })
const fail = (code: string, message: string, statusCode = 400): PluginResponse => ({ statusCode, body: { ok: false, data: null, error: { code, message } } })
const body = (r: any) => r?.body && typeof r.body === 'object' ? r.body : {}
const user = (r: any) => String(r?.headers?.['ones-user-id'] || r?.headers?.['Ones-User-Id'] || r?.headers?.['ones-user-uuid'] || r?.headers?.['Ones-User-UUID'] || r?.user?.id || 'session')
const team = (r: any) => {
  const fromParams = r?.params?.teamUUID || r?.params?.team_uuid
  const fromUrl = String(r?.url || r?.path || '').split('?')[0].match(/\/team\/([A-Za-z0-9_-]+)/)?.[1]
  return String(fromParams || fromUrl || body(r).team_uuid || r?.headers?.['ones-check-id'] || r?.headers?.['Ones-Check-Id'] || '')
}
const key = (teamUUID: string) => `team_${teamUUID}`
const normalizeId = (value: any) => {
  const text = String(value || '').trim()
  if (!text) return ''
  const matches = text.match(/[A-Za-z0-9_-]{8,64}/g)
  return matches?.length ? matches[matches.length - 1] : text
}
const eventOf = (r: any) => { const e = r?.body?.eventID ? r.body : r; return { id: String(e?.eventID || ''), ctx: e?.eventContext || {}, data: e?.eventData || {} } }
const triggerUserOf = (r: any) => { const e = r?.body?.eventID ? r.body : r; return String(e?.eventContext?.triggerUserID || e?.eventData?.triggerUserID || r?.trigger_user_id || '') }
async function config(teamUUID: string): Promise<any> { if (runtimeConfig[teamUUID]) return runtimeConfig[teamUUID]; try { return (await configs.get(key(teamUUID))) || {} } catch { return {} } }
function responseData(response: any): any {
  return response?.data ?? response?.body ?? response
}
function responseSummary(response: any): string {
  const value = responseData(response)
  if (value == null) return 'empty'
  if (typeof value !== 'object') return String(value).slice(0, 500)
  try { return JSON.stringify(value).slice(0, 1000) } catch { return `keys=${Object.keys(value).join(',')}` }
}
async function issueDetail(teamUUID: string, issueUUID: string, req?: any): Promise<any> {
  // 用 OpenAPI GET /project/issues/:issueID 读工作项详情，字段值在 fieldValues 数组
  try {
    const r: any = await FetchAsAdmin(`/openapi/v2/project/issues/${issueUUID}`, { method: 'GET', params: { teamID: teamUUID } })
    const value = responseData(r)
    const issue = value?.data ?? value
    const name = String(issue?.name || issue?.title || '')
    const fieldValues = Array.isArray(issue?.fieldValues) ? issue.fieldValues : []
    const properties: any = {}
    for (const fv of fieldValues) {
      const fid = String(fv?.fieldID || fv?.field_id || fv?.fieldId || '')
      if (fid) properties[fid] = fv?.value
    }
    if (name || Object.keys(properties).length) return { name, properties }
  } catch (e: any) {
    Logger.info(`[立项审批] OpenAPI工作项详情失败 issue=${issueUUID} status=${e?.response?.status || ''} message=${e?.message || ''}`)
  }
  throw Object.assign(new Error('读取审批工作项详情失败'), { code: 'ISSUE_DETAIL_FAILED' })
}
function fieldText(v: any): string {
  if (v == null) return ''
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  if (Array.isArray(v)) return v.map((x: any) => fieldText(x)).filter(Boolean).join(', ')
  if (typeof v === 'object') return String(v.value ?? v.name ?? v.label ?? v.displayValue ?? v.display_value ?? v.text ?? v.title ?? '')
  return String(v)
}
function fieldId(v: any): string {
  if (v == null) return ''
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  if (Array.isArray(v)) return fieldId(v[0])
  if (typeof v === 'object') return String(v.id ?? v.uuid ?? '')
  return ''
}
function singleSelect(value: any): { uuid: string; name: string } {
  const v = Array.isArray(value) ? value[0] : value
  if (v && typeof v === 'object') return { uuid: String(v.uuid || v.id || ''), name: String(v.name || v.label || v.displayValue || v.value || v.text || '') }
  return { uuid: '', name: String(v || '') }
}
function isApproved(c: any, s: any) { if (!s || typeof s === 'string' && !s.trim()) return false; const id = typeof s === 'object' ? String(s.id || s.uuid || s.statusID || s.statusUUID || '') : String(s); const name = typeof s === 'object' ? String(s.name || s.title || s.statusName || '') : String(s); const configured = String(c.approved_status_uuid || '').trim(); const configuredName = String(c.approved_status_name || '').trim(); return Boolean((configured && id === configured) || (configuredName && name.trim() === configuredName) || (configuredName && typeof s === 'string' && s.trim() === configuredName)) }
async function run(teamUUID: string, issueUUID: string, eventID: string, retry = false, request?: any): Promise<any> {
  const c = await config(teamUUID); c.template_uuid = c.template_uuid || 'comwater'
  let existing: any = runtimeRecords[issueUUID] || {}
  try { existing = (await records.get(issueUUID)) || existing } catch {}
  if (existing?.status === 'created' || existing?.status === 'pending' || existing?.status === 'creating') { runtimeRecords[issueUUID] = existing; return existing }
  const now = Date.now(); runtimeRecords[issueUUID] = { ...(existing || {}), issue_uuid: issueUUID, team_uuid: teamUUID, event_id: eventID || existing?.event_id || '', status: 'creating', retry_count: Number(existing?.retry_count || 0) + (retry ? 1 : 0), updated_at: now }; try { await records.set(issueUUID, runtimeRecords[issueUUID]) } catch {}
  try {
    let issue: any = {}; try { issue = await issueDetail(teamUUID, issueUUID, request) } catch (e: any) { Logger.info(`[立项审批] 跳过工作项详情读取 issue=${issueUUID} message=${e?.message || ''}`) }; const p: any = issue?.properties || {}
    let mapping: any = {}; try { mapping = JSON.parse(String(c.mapping_json || '{}')) } catch {}
    // 映射值存字段 UUID（配置页动态选择）；兼容旧配置里存的中文字段名（按名称取值）
    const mapped = (target: string, fallback: string): any => { const raw = String(mapping[target] || fallback || '').trim(); if (!raw) return undefined; return p[raw] }
    const name = fieldText(mapped('项目名称', '')) || String(issue?.name || issue?.title || `立项项目-${issueUUID.slice(-8)}`).trim()
    const owner = fieldId(mapped('项目负责人', '')) || fieldId(issue?.assignee)
    const startDate = fieldText(mapped('开始日期', '')).slice(0, 10)
    const endDate = fieldText(mapped('结束日期', '')).slice(0, 10)
    const typeRaw = mapped('项目类型（单选）', '') || mapped('项目类型', '')
    const typeSourceField = String(mapping['项目类型（单选）'] || mapping['项目类型'] || '')
    let projectTypeUuid = ''
    let projectTypeName = ''
    if (typeRaw != null) {
      const t = singleSelect(typeRaw)
      if (t.uuid) { projectTypeUuid = t.uuid; projectTypeName = t.name }
      else if (t.name && /^[A-Za-z0-9]{8,64}$/.test(t.name)) {
        // 字符串是选项 UUID（ONES 单选字段值只返回选项 UUID），用 field/options 查名称
        projectTypeUuid = t.name
        projectTypeName = typeSourceField ? await resolveOptionName(teamUUID, typeSourceField, projectTypeUuid) : ''
      } else { projectTypeName = t.name }
    }
    Logger.info(`[立项审批] 字段值 fieldIDs=${Object.keys(p).join(',')}`)
    Logger.info(`[立项审批] 映射 mapping=${JSON.stringify(mapping).slice(0, 400)}`)
    Logger.info(`[立项审批] 提取结果 name=${name} owner=${owner} start=${startDate} end=${endDate} type=${projectTypeUuid}/${projectTypeName}`)
    const triggerUser = triggerUserOf(request)
    if (!name) throw Object.assign(new Error('立项单缺少项目名称'), { code: 'MISSING_FIELD' })
    const pending = { issue_uuid: issueUUID, team_uuid: teamUUID, event_id: eventID || existing?.event_id || '', status: 'pending', project_uuid: '', project_name: name, owner_uuid: owner, start_date: startDate, end_date: endDate, project_type_uuid: projectTypeUuid, project_type_name: projectTypeName, trigger_user_uuid: triggerUser, error_code: '', error_message: '', retry_count: Number(existing?.retry_count || 0) + (retry ? 1 : 0), updated_at: Date.now() }
    runtimeRecords[issueUUID] = pending; try { await records.set(issueUUID, pending) } catch {}; Logger.info(`[立项审批] 已生成待创建记录 issue=${issueUUID}`); return pending
  } catch (e: any) { const failed = { ...(runtimeRecords[issueUUID] || {}), issue_uuid: issueUUID, team_uuid: teamUUID, status: 'failed', error_code: e?.code || 'CREATE_FAILED', error_message: e?.message || '创建项目失败', updated_at: Date.now() }; runtimeRecords[issueUUID] = failed; try { await records.set(issueUUID, failed) } catch {}; throw e }
}
export async function onIssueStatusChanged(req: PluginRequest): Promise<PluginResponse> { const e = eventOf(req), teamUUID = String(e.ctx.teamID || e.ctx.teamUUID || e.data.teamID || team(req)); const issueID = String(e.data.issueID || e.data.issueUUID || e.data.id || ''); const status = e.data.newStatus || e.data.toStatus || e.data.targetStatus || e.data.status; const c = await config(teamUUID); Logger.info(`[立项审批] 收到状态事件 issue=${issueID} status=${JSON.stringify(status).slice(0, 500)} data=${JSON.stringify(e.data).slice(0, 1000)}`); if (!teamUUID || !issueID || !isApproved(c, status)) { Logger.info(`[立项审批] 忽略非通过状态 issue=${issueID} status=${JSON.stringify(status).slice(0, 300)}`); return ok({ ignored: true }) } try { const result = await run(teamUUID, issueID, e.id, false, req); Logger.info(`[立项审批] 待创建记录已生成 issue=${issueID} status=${result.status}`); return ok({ ...result, pending: result.status === 'pending' }) } catch (err: any) { const message = `${err?.code || 'CREATE_FAILED'}: ${err?.message || '生成待创建记录失败'}${err?.detail ? `; ${err.detail}` : ''}`; Logger.error(`[立项审批] 待创建记录生成失败 issue=${issueID} ${message}`); throw new Error(message) } }
export async function getConfig(req: PluginRequest): Promise<PluginResponse> { return ok({ approved_status_name: '已通过', approved_status_uuid: '', template_uuid: 'comwater', mapping_json: '{}', ...(await config(team(req))) }) }
export async function saveConfig(req: PluginRequest): Promise<PluginResponse> { const teamUUID = team(req); if (!teamUUID) return fail('MISSING_TEAM', '无法识别当前团队，请从团队插件配置页打开'); const b = body(req); const approvalProject = normalizeId(b.approval_project_uuid); const issueType = normalizeId(b.issue_type_uuid); const template = normalizeId(b.template_uuid) || 'comwater'; if (!approvalProject || !issueType || (!b.approved_status_uuid && !b.approved_status_name)) return fail('INVALID_CONFIG', '审批项目、工作项类型和通过状态均为必填'); let mapping = '{}'; try { if (typeof b.mapping_json === 'string') { JSON.parse(b.mapping_json); mapping = b.mapping_json.slice(0, 4096) } else if (b.mapping_json && typeof b.mapping_json === 'object') mapping = JSON.stringify(b.mapping_json).slice(0, 4096) } catch { return fail('INVALID_CONFIG', '属性映射格式无效') } const value = { team_uuid: teamUUID, approval_project_uuid: approvalProject, issue_type_uuid: issueType, approved_status_uuid: normalizeId(b.approved_status_uuid), approved_status_name: String(b.approved_status_name || '').trim(), template_uuid: template, mapping_json: mapping }; runtimeConfig[teamUUID] = value; try { await configs.set(key(teamUUID), value) } catch {} return ok(value) }
export async function listRecords(req: PluginRequest): Promise<PluginResponse> {
  try {
    const q: any = await records.query().limit(200).getMany()
    const rows = Array.isArray(q) ? q : (Array.isArray(q?.data) ? q.data : (Array.isArray(q?.data?.data) ? q.data.data : []))
    const items = rows.map((x: any) => ({ id: x.key || x.id, ...(x.value || x) }))
    // Include the in-process record when storage reads lag behind an event write.
    for (const value of Object.values(runtimeRecords) as any[]) {
      if (value?.team_uuid === team(req) && !items.some((item: any) => item.issue_uuid === value.issue_uuid)) items.push({ id: value.issue_uuid, ...value })
    }
    return ok({ items })
  } catch {
    return ok({ items: Object.values(runtimeRecords).filter((x: any) => x?.team_uuid === team(req)) })
  }
}
export async function confirmRecord(req: PluginRequest): Promise<PluginResponse> { const b = body(req), issueUUID = String(b.issue_uuid || ''), projectUUID = String(b.project_uuid || ''), projectIdentifier = String(b.project_identifier || ''); if (!issueUUID || !projectUUID) return fail('INVALID_REQUEST', '缺少审批单或项目 UUID'); const current: any = runtimeRecords[issueUUID] || await records.get(issueUUID) || {}; const done = { ...current, issue_uuid: issueUUID, team_uuid: team(req) || current.team_uuid || '', status: 'created', project_uuid: projectUUID, project_identifier: projectIdentifier, error_code: '', error_message: '', updated_at: Date.now() }; runtimeRecords[issueUUID] = done; try { await records.set(issueUUID, done) } catch {}; Logger.info(`[立项审批] 浏览器创建已确认 issue=${issueUUID} project=${projectUUID}`); return ok(done) }
export async function enrichRecord(req: PluginRequest): Promise<PluginResponse> { const b = body(req), issueUUID = String(b.issue_uuid || ''), projectName = String(b.project_name || '').trim(); if (!issueUUID || !projectName) return fail('INVALID_REQUEST', '缺少审批单或项目名称'); const current: any = runtimeRecords[issueUUID] || await records.get(issueUUID) || {}; const next = { ...current, issue_uuid: issueUUID, team_uuid: team(req) || current.team_uuid || '', project_name: projectName, updated_at: Date.now() }; runtimeRecords[issueUUID] = next; try { await records.set(issueUUID, next) } catch {}; return ok(next) }
export async function retryRecord(req: PluginRequest): Promise<PluginResponse> { const id = String(body(req).issue_uuid || ''); const current: any = runtimeRecords[id] || await records.get(id) || {}; if (!id || !current.issue_uuid) return fail('INVALID_REQUEST', '找不到待创建记录'); const pending = { ...current, status: 'pending', error_code: '', error_message: '', updated_at: Date.now() }; runtimeRecords[id] = pending; try { await records.set(id, pending) } catch {}; return ok(pending) }

// ---- 动态下拉数据源（消除硬编码字段/状态 UUID，配置页实时拉取）----
const openApiList = async (teamUUID: string, path: string, extraParams: any = {}): Promise<any> => {
  const r: any = await FetchAsAdmin(`/openapi/v2/project/${path}`, { method: 'GET', params: { teamID: teamUUID, ...extraParams } })
  return responseData(r)
}
export async function listStatuses(req: PluginRequest): Promise<PluginResponse> {
  const teamUUID = team(req)
  if (!teamUUID) return fail('MISSING_TEAM', '无法识别当前团队')
  try {
    const value = await openApiList(teamUUID, 'issueStatuses')
    const list = value?.list ?? value?.data?.list ?? (Array.isArray(value) ? value : [])
    const arr = Array.isArray(list) ? list : []
    const items = arr.map((s: any) => ({ uuid: String(s.id ?? s.uuid ?? ''), name: String(s.name ?? s.title ?? '') })).filter((x: any) => x.uuid)
    Logger.info(`[立项审批] listStatuses teamID=${teamUUID} 共 ${items.length} 个状态`)
    return ok({ items })
  } catch (e: any) {
    Logger.error(`[立项审批] listStatuses 失败 teamID=${teamUUID} ${e?.message || ''}`)
    return fail('LIST_STATUS_FAILED', `状态列表加载失败：${e?.message || ''}`)
  }
}
export async function listIssueFields(req: PluginRequest): Promise<PluginResponse> {
  const teamUUID = team(req)
  if (!teamUUID) return fail('MISSING_TEAM', '无法识别当前团队')
  try {
    const all: any[] = []
    let cursor: string | undefined
    let guard = 0
    do {
      const params: any = { teamID: teamUUID, limit: '500' }
      if (cursor) params.cursor = cursor
      const value = await openApiList(teamUUID, 'searchIssueFields', params)
      const list = value?.list ?? value?.data?.list ?? (Array.isArray(value) ? value : [])
      const arr = Array.isArray(list) ? list : []
      for (const f of arr) all.push({ uuid: String(f.id ?? f.uuid ?? ''), name: String(f.name ?? ''), typeLabel: String(f.fieldTypeName ?? f.typeLabel ?? f.fieldType ?? '') })
      const pageInfo = value?.pageInfo ?? value?.data?.pageInfo
      cursor = pageInfo?.hasNextPage ? pageInfo?.endCursor : undefined
      guard += 1
      if (!pageInfo?.hasNextPage) break
    } while (cursor && guard < 20)
    const items = all.filter((x: any) => x.uuid && x.name)
    Logger.info(`[立项审批] listIssueFields teamID=${teamUUID} 共 ${items.length} 个字段`)
    return ok({ items })
  } catch (e: any) {
    Logger.error(`[立项审批] listIssueFields 失败 teamID=${teamUUID} ${e?.message || ''}`)
    return fail('LIST_FIELD_FAILED', `字段列表加载失败：${e?.message || ''}`)
  }
}
export async function listProjectFields(req: PluginRequest): Promise<PluginResponse> {
  const teamUUID = team(req)
  if (!teamUUID) return fail('MISSING_TEAM', '无法识别当前团队')
  try {
    const value = await openApiList(teamUUID, 'projectFields')
    const fields = value?.fields ?? value?.data?.fields ?? (Array.isArray(value) ? value : [])
    const arr = Array.isArray(fields) ? fields : []
    const items = arr.map((f: any) => ({ uuid: String(f.id ?? f.uuid ?? ''), name: String(f.name ?? ''), typeLabel: String(f.typeLabel ?? f.fieldTypeName ?? ''), options: Array.isArray(f.options) ? f.options : [] })).filter((x: any) => x.uuid && x.name)
    Logger.info(`[立项审批] listProjectFields teamID=${teamUUID} 共 ${items.length} 个项目字段`)
    return ok({ items })
  } catch (e: any) {
    Logger.error(`[立项审批] listProjectFields 失败 teamID=${teamUUID} ${e?.message || ''}`)
    return fail('LIST_PROJECT_FIELD_FAILED', `项目字段列表加载失败：${e?.message || ''}`)
  }
}
// 查询字段选项（POST /openapi/v2/project/field/options），返回 uuid/value 列表
async function fieldOptions(teamUUID: string, fieldUUID: string, uuids?: string[]): Promise<Array<{ uuid: string; value: string }>> {
  try {
    const data: any = { field_uuid: fieldUUID, include_fields: ['uuid', 'value'], limit: 100 }
    if (uuids && uuids.length) data.uuids = uuids
    const r: any = await FetchAsAdmin('/openapi/v2/project/field/options', { method: 'POST', params: { teamID: teamUUID }, data })
    const value = responseData(r)
    const list = Array.isArray(value) ? value : (value?.list ?? value?.data ?? [])
    return (Array.isArray(list) ? list : []).map((o: any) => ({ uuid: String(o.uuid ?? o.id ?? ''), value: String(o.value ?? o.name ?? '') })).filter((o: any) => o.uuid)
  } catch (e: any) {
    Logger.info(`[立项审批] 字段选项查询失败 field=${fieldUUID} ${e?.message || ''}`)
    return []
  }
}
// 将字段值里的选项 UUID 解析为选项名称（源字段）
async function resolveOptionName(teamUUID: string, fieldUUID: string, optionUUID: string): Promise<string> {
  if (!fieldUUID || !optionUUID) return ''
  const options = await fieldOptions(teamUUID, fieldUUID, [optionUUID])
  return options.length ? options[0].value : ''
}
export async function createProject(req: PluginRequest): Promise<PluginResponse> {
  const teamUUID = team(req)
  if (!teamUUID) return fail('MISSING_TEAM', '无法识别当前团队')
  const b = body(req)
  const name = String(b.name || '').trim()
  const templateID = String(b.template_uuid || 'project-t2').trim()
  const members = Array.isArray(b.members) ? b.members.map((x: any) => String(x)).filter(Boolean) : []
  const owner = String(b.owner || '').trim()
  if (!name) return fail('INVALID_REQUEST', '缺少项目名称')
  try {
    // 内部 API：POST /project/api/project/team/:teamUUID/projects/add
    // 客户端生成 16 位项目 uuid（负责人前缀 8 位 + 随机 8 位）
    const prefix = (owner || '00000000').slice(0, 8).padEnd(8, '0')
    const random8 = Math.random().toString(36).slice(2, 10).padEnd(8, '0')
    const projectUUID = (prefix + random8).slice(0, 16)
    const payload: any = { project: { uuid: projectUUID, name }, template_id: templateID, members }
    if (owner) payload.project.assign = owner
    Logger.info(`[立项审批] 创建项目请求(内部API) teamID=${teamUUID} name=${name} template=${templateID} uuid=${projectUUID} owner=${owner}`)
    const r: any = await OPFetch(`/project/api/project/team/${teamUUID}/projects/add`, { method: 'POST', teamUUID, data: payload })
    Logger.info(`[立项审批] 创建项目原始响应=${responseSummary(r).slice(0, 800)}`)
    const value = responseData(r)
    const project = value?.project ?? value?.data?.project ?? value?.data ?? value
    const actualUUID = String(project?.uuid || projectUUID)
    if (!actualUUID) return fail('CREATE_FAILED', `创建项目未返回项目 UUID：${responseSummary(r).slice(0, 300)}`)
    Logger.info(`[立项审批] 项目创建成功 project=${actualUUID} name=${name} template=${templateID}`)
    return ok({ project_uuid: actualUUID, identifier: '' })
  } catch (e: any) {
    Logger.error(`[立项审批] 项目创建失败 ${e?.message || ''} detail=${responseSummary(e?.response).slice(0, 500)}`)
    return fail('CREATE_FAILED', `项目创建失败：${e?.message || ''}`)
  }
}
export async function updateProjectFields(req: PluginRequest): Promise<PluginResponse> {
  const teamUUID = team(req)
  const b = body(req)
  const projectUUID = String(b.project_uuid || '')
  if (!teamUUID || !projectUUID) return fail('INVALID_REQUEST', '缺少团队或项目 UUID')
  const item: any = {}
  if (b.owner) item.assign = String(b.owner)
  if (b.planned_start_date) item.plan_start_time = Math.floor(new Date(String(b.planned_start_date)).getTime() / 1000)
  if (b.planned_end_date) item.plan_end_time = Math.floor(new Date(String(b.planned_end_date)).getTime() / 1000)
  if (b.custom_field && typeof b.custom_field === 'object') {
    for (const [k, v] of Object.entries(b.custom_field)) if (v) item[k] = v
  }
  if (!Object.keys(item).length) return ok({ updated: false })
  try {
    // 内部 API：POST /project/api/project/team/:teamUUID/item/project-{uuid}/update
    const r: any = await OPFetch(`/project/api/project/team/${teamUUID}/item/project-${projectUUID}/update`, { method: 'POST', teamUUID, data: { item } })
    Logger.info(`[立项审批] 项目字段更新成功 project=${projectUUID} keys=${Object.keys(item).join(',')}`)
    return ok({ updated: true })
  } catch (e: any) {
    Logger.error(`[立项审批] 项目字段更新失败 project=${projectUUID} ${e?.message || ''} detail=${responseSummary(e?.response).slice(0, 500)}`)
    return fail('UPDATE_FAILED', `项目字段更新失败：${e?.message || ''}`)
  }
}
export async function verifyProject(req: PluginRequest): Promise<PluginResponse> {
  const teamUUID = team(req)
  const projectUUID = String(body(req).project_uuid || '')
  if (!teamUUID || !projectUUID) return fail('INVALID_REQUEST', '缺少项目 UUID')
  try {
    const r: any = await OPFetch(`/project/api/project/team/${teamUUID}/projects/info?ids=${projectUUID}`, { method: 'GET', teamUUID })
    const value = responseData(r)
    const projects = value?.projects ?? value?.data?.projects ?? []
    return ok({ exists: Array.isArray(projects) && projects.length > 0 })
  } catch (e: any) {
    Logger.info(`[立项审批] 验证项目失败 project=${projectUUID} status=${e?.response?.status || ''} ${e?.message || ''}`)
    return ok({ exists: false })
  }
}
