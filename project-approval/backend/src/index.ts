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
  const c = await config(teamUUID)
  let mapping: any = {}
  try { mapping = JSON.parse(String(c.mapping_json || '{}')) } catch {}
  const aliases: any = { '项目名称': 'Bukbqjpm', '立项名称': 'Bukbqjpm', '项目负责人': 'QE8d8KfA', '负责人': 'QE8d8KfA', '计划开始日期': 'field009', '计划完成日期': 'field010', '项目类型': 'cA3wKBQs', '项目类型（单选）': 'cA3wKBQs' }
  const fields = Array.from(new Set(['Bukbqjpm', 'field009', 'field010', 'QE8d8KfA', 'cA3wKBQs', ...Object.values(mapping).map(x => aliases[String(x || '')] || String(x || ''))].filter(x => /^[A-Za-z0-9_]{6,64}$/.test(String(x)))))
  const normalizeDetailForm = (raw: any): any => {
    const value = responseData(raw)
    const form = value?.detail_form || value?.detailForm || value?.data?.detail_form || value?.data?.detailForm || value
    const properties = form?.properties || form?.fields || form?.field_values || form?.values || form?.form_items || value?.fields || {}
    const list = Array.isArray(properties) ? properties.reduce((out: any, item: any) => {
      const key = item?.field_uuid || item?.fieldUuid || item?.property_uuid || item?.uuid || item?.id || item?.key || item?.name
      const field = item?.field || item?.property || item
      if (key) out[key] = field?.value ?? field?.displayValue ?? field?.display_value ?? field?.text ?? field
      if (item?.name && item?.name !== key) out[item.name] = field?.value ?? field?.displayValue ?? field?.display_value ?? field?.text ?? field
      return out
    }, {}) : Object.entries(properties || {}).reduce((out: any, [key, item]: any) => {
      out[key] = item
      return out
    }, {})
    const name = form?.name || form?.title || value?.name || value?.title || list.field001?.value || list.field001
    return { name, properties: list }
  }
  const detailFormUrls = [
    `/project/api/project/team/${teamUUID}/items/${issueUUID}/detail_form`,
    `/project/api/project/team/${teamUUID}/issues/${issueUUID}/detail_form`,
    `/project/api/ones-project/team/${teamUUID}/workitems/${issueUUID}/detail_form`,
    `/project/api/project/team/${teamUUID}/tasks/${issueUUID}/detail_form`,
  ]
  for (const url of detailFormUrls) {
    try {
      const r: any = await OPFetch(url, { method: 'GET', teamUUID })
      const normalized = normalizeDetailForm(r)
      if (normalized.properties && (Object.keys(normalized.properties).length || normalized.name)) return normalized
    } catch (e: any) {
      Logger.info(`[立项审批] detail_form接口失败 url=${url} status=${e?.response?.status || ''} message=${e?.message || ''}`)
    }
  }
  if (fields.length) {
    try {
      const query = `select uid(field001,${fields.join(',')},v$issue_path) from issue where uid(uuid) = uid('${issueUUID}');`
      const r: any = await OPFetch(`/project/api/ones-project/team/${teamUUID}/workitems/onesql`, { method: 'POST', teamUUID, data: { query } })
      const item = r?.data?.[0]?.item || r?.body?.data?.[0]?.item || r?.data?.data?.[0]?.item
      if (item) return { name: item.field001, properties: item }
    } catch (e: any) { Logger.info(`[立项审批] ONESQL工作项详情失败 status=${e?.response?.status || ''} message=${e?.message || ''}`) }
  }
  const urls = [
    `/project/api/project/team/${teamUUID}/tasks/${issueUUID}`,
    `/project/api/ones-project/team/${teamUUID}/tasks/${issueUUID}`,
    `/project/api/project/team/${teamUUID}/issues/${issueUUID}`,
  ]
  let last: any
  for (const url of urls) {
    try {
      const r: any = await OPFetch(url, { method: 'GET', teamUUID })
      const value = r?.body || r?.data || r
      if (value && typeof value === 'object') return value
    } catch (e: any) {
      last = e
      Logger.info(`[立项审批] 工作项详情接口失败 url=${url} status=${e?.response?.status || ''} message=${e?.message || ''}`)
    }
  }
  for (const url of [`/openapi/v2/project/issues/${issueUUID}`, `/openapi/v2/project/issue/${issueUUID}`]) {
    try {
      const r: any = await FetchAsAdmin(url, { method: 'GET', params: { teamID: teamUUID } })
      const value = responseData(r)
      if (value && typeof value === 'object') return value
    } catch (e: any) { Logger.info(`[立项审批] 管理员OpenAPI工作项详情失败 url=${url} status=${e?.response?.status || ''} detail=${responseSummary(e?.response) || e?.message || ''}`) }
  }
  throw Object.assign(new Error(`读取审批工作项失败：${last?.message || '接口不可用'}`), { code: 'ISSUE_DETAIL_FAILED' })
}
function singleSelect(value: any): { uuid: string; name: string } {
  const v = Array.isArray(value) ? value[0] : value
  if (v && typeof v === 'object') return { uuid: String(v.uuid || v.id || v.value || ''), name: String(v.name || v.label || v.displayValue || '') }
  return { uuid: '', name: String(v || '') }
}
function isApproved(c: any, s: any) { if (!s || typeof s === 'string' && !s.trim()) return false; const id = typeof s === 'object' ? String(s.id || s.uuid || s.statusID || s.statusUUID || '') : String(s); const name = typeof s === 'object' ? String(s.name || s.title || s.statusName || '') : String(s); const configured = String(c.approved_status_uuid || '').trim(); const configuredName = String(c.approved_status_name || '').trim(); return Boolean((configured && id === configured) || (!configured && id === 'C4GCmGyA') || (configuredName && name.trim() === configuredName) || (configuredName && typeof s === 'string' && s.trim() === configuredName)) }
async function run(teamUUID: string, issueUUID: string, eventID: string, retry = false, request?: any): Promise<any> {
  const c = await config(teamUUID); c.template_uuid = c.template_uuid || 'waterfall'
  let existing: any = runtimeRecords[issueUUID] || {}
  try { existing = (await records.get(issueUUID)) || existing } catch {}
  if (existing?.status === 'created' || existing?.status === 'pending' || existing?.status === 'creating') { runtimeRecords[issueUUID] = existing; return existing }
  const now = Date.now(); runtimeRecords[issueUUID] = { ...(existing || {}), issue_uuid: issueUUID, team_uuid: teamUUID, event_id: eventID || existing?.event_id || '', status: 'creating', retry_count: Number(existing?.retry_count || 0) + (retry ? 1 : 0), updated_at: now }; try { await records.set(issueUUID, runtimeRecords[issueUUID]) } catch {}
  try {
    let issue: any = {}; try { issue = await issueDetail(teamUUID, issueUUID, request) } catch (e: any) { Logger.info(`[立项审批] 跳过工作项详情读取 issue=${issueUUID} message=${e?.message || ''}`) }; const eventData = eventOf(request).data || {}; const p = { ...(eventData.properties || {}), ...(eventData.field_values || {}), ...(issue?.properties || issue?.data?.properties || {}) }
    let mapping: any = {}; try { mapping = JSON.parse(String(c.mapping_json || '{}')) } catch {}
    const aliases: any = { '项目名称': 'Bukbqjpm', '立项名称': 'Bukbqjpm', '项目负责人': 'QE8d8KfA', '负责人': 'QE8d8KfA', '计划开始日期': 'field009', '计划完成日期': 'field010', '项目类型': 'cA3wKBQs', '项目类型（单选）': 'cA3wKBQs' }
    const mapped = (target: string, fallback: string) => { const source = String(mapping[target] || fallback); const key = aliases[source] || source; return p[key]?.value ?? p[key]?.displayValue ?? p[key] }
    const value = (name: string) => p[name]?.value ?? p[name]?.displayValue ?? p[name]
    const name = String(mapped('项目名称', '立项名称') || issue?.name || issue?.title || `立项项目-${issueUUID.slice(-8)}`).trim(); const owner = String(mapped('项目负责人', '项目负责人') || issue?.assignee || '').trim(); const projectType = singleSelect(mapped('项目类型（单选）', '项目类型') || value('project_type')); const triggerUser = triggerUserOf(request)
    if (!name) throw Object.assign(new Error('立项单缺少项目名称'), { code: 'MISSING_FIELD' })
    const pending = { issue_uuid: issueUUID, team_uuid: teamUUID, event_id: eventID || existing?.event_id || '', status: 'pending', project_uuid: '', project_name: name, project_type_uuid: projectType.uuid, project_type_name: projectType.name, trigger_user_uuid: triggerUser, error_code: '', error_message: '', retry_count: Number(existing?.retry_count || 0) + (retry ? 1 : 0), updated_at: Date.now() }
    runtimeRecords[issueUUID] = pending; try { await records.set(issueUUID, pending) } catch {}; Logger.info(`[立项审批] 已生成待创建记录 issue=${issueUUID}`); return pending
  } catch (e: any) { const failed = { ...(runtimeRecords[issueUUID] || {}), issue_uuid: issueUUID, team_uuid: teamUUID, status: 'failed', error_code: e?.code || 'CREATE_FAILED', error_message: e?.message || '创建项目失败', updated_at: Date.now() }; runtimeRecords[issueUUID] = failed; try { await records.set(issueUUID, failed) } catch {}; throw e }
}
export async function onIssueStatusChanged(req: PluginRequest): Promise<PluginResponse> { const e = eventOf(req), teamUUID = String(e.ctx.teamID || e.ctx.teamUUID || e.data.teamID || team(req)); const issueID = String(e.data.issueID || e.data.issueUUID || e.data.id || ''); const status = e.data.newStatus || e.data.toStatus || e.data.targetStatus || e.data.status; const c = await config(teamUUID); Logger.info(`[立项审批] 收到状态事件 issue=${issueID} status=${JSON.stringify(status).slice(0, 500)} data=${JSON.stringify(e.data).slice(0, 1000)}`); if (!teamUUID || !issueID || !isApproved(c, status)) { Logger.info(`[立项审批] 忽略非通过状态 issue=${issueID} status=${JSON.stringify(status).slice(0, 300)}`); return ok({ ignored: true }) } try { const result = await run(teamUUID, issueID, e.id, false, req); Logger.info(`[立项审批] 待创建记录已生成 issue=${issueID} status=${result.status}`); return ok({ ...result, pending: result.status === 'pending' }) } catch (err: any) { const message = `${err?.code || 'CREATE_FAILED'}: ${err?.message || '生成待创建记录失败'}${err?.detail ? `; ${err.detail}` : ''}`; Logger.error(`[立项审批] 待创建记录生成失败 issue=${issueID} ${message}`); throw new Error(message) } }
export async function getConfig(req: PluginRequest): Promise<PluginResponse> { return ok({ approved_status_name: '已通过', approved_status_uuid: '', template_uuid: 'waterfall', mapping_json: '{}', ...(await config(team(req))) }) }
export async function saveConfig(req: PluginRequest): Promise<PluginResponse> { const teamUUID = team(req); if (!teamUUID) return fail('MISSING_TEAM', '无法识别当前团队，请从团队插件配置页打开'); const b = body(req); const approvalProject = normalizeId(b.approval_project_uuid); const issueType = normalizeId(b.issue_type_uuid); const template = normalizeId(b.template_uuid) || 'waterfall'; if (!approvalProject || !issueType || (!b.approved_status_uuid && !b.approved_status_name)) return fail('INVALID_CONFIG', '审批项目、工作项类型和通过状态均为必填'); let mapping = '{}'; try { if (typeof b.mapping_json === 'string') { JSON.parse(b.mapping_json); mapping = b.mapping_json.slice(0, 4096) } else if (b.mapping_json && typeof b.mapping_json === 'object') mapping = JSON.stringify(b.mapping_json).slice(0, 4096) } catch { return fail('INVALID_CONFIG', '属性映射格式无效') } const value = { team_uuid: teamUUID, approval_project_uuid: approvalProject, issue_type_uuid: issueType, approved_status_uuid: normalizeId(b.approved_status_uuid), approved_status_name: String(b.approved_status_name || '').trim(), template_uuid: template, mapping_json: mapping }; runtimeConfig[teamUUID] = value; try { await configs.set(key(teamUUID), value) } catch {} return ok(value) }
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
