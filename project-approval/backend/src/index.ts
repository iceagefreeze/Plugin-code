import { storage } from '@ones-op/sdk/node'
import { OPFetch } from '@ones-op/fetch'
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
async function config(teamUUID: string): Promise<any> { return runtimeConfig[teamUUID] || (await configs.get(key(teamUUID))) || {} }
async function issueDetail(teamUUID: string, issueUUID: string): Promise<any> { const r: any = await OPFetch({ url: `/project/api/project/team/${teamUUID}/issues/${issueUUID}`, method: 'GET' }); return r?.data || r }
async function createProject(teamUUID: string, input: any, templateUUID: string): Promise<string> {
  const r: any = await OPFetch({ url: `/project/api/project/team/${teamUUID}/projects`, method: 'POST', headers: { 'Content-Type': 'application/json' }, data: { name: input.name, description: input.description || '', owner: input.owner, start_time: input.start_time || 0, end_time: input.end_time || 0, template_uuid: templateUUID, project_type_uuid: input.project_type_uuid || '', project_type: input.project_type_name || '' } })
  const id = r?.project_uuid || r?.uuid || r?.data?.project_uuid || r?.data?.uuid
  if (!id) throw Object.assign(new Error('创建项目接口未返回项目 UUID'), { code: 'INVALID_RESPONSE' })
  return String(id)
}
function singleSelect(value: any): { uuid: string; name: string } {
  const v = Array.isArray(value) ? value[0] : value
  if (v && typeof v === 'object') return { uuid: String(v.uuid || v.id || v.value || ''), name: String(v.name || v.label || v.displayValue || '') }
  return { uuid: '', name: String(v || '') }
}
function isApproved(c: any, s: any) { return (c.approved_status_uuid && s?.id === c.approved_status_uuid) || (!c.approved_status_uuid && String(s?.name || '').trim() === (c.approved_status_name || '已通过')) }
async function run(teamUUID: string, issueUUID: string, eventID: string, retry = false): Promise<any> {
  const c = await config(teamUUID); if (!c.approval_project_uuid || !c.issue_type_uuid || !c.template_uuid) throw new Error('插件尚未完成配置')
  const existing: any = runtimeRecords[issueUUID] || {}; if (existing?.status === 'created') return existing
  const now = Date.now(); runtimeRecords[issueUUID] = { ...(existing || {}), issue_uuid: issueUUID, team_uuid: teamUUID, event_id: eventID || existing?.event_id || '', status: 'creating', retry_count: Number(existing?.retry_count || 0) + (retry ? 1 : 0), updated_at: now }; try { await records.set(issueUUID, runtimeRecords[issueUUID]) } catch {}
  try {
    const issue = await issueDetail(teamUUID, issueUUID); const p = issue?.properties || issue?.data?.properties || {}
    const value = (name: string) => p[name]?.value ?? p[name]?.displayValue ?? p[name]
    const name = String(issue?.name || issue?.title || value('立项名称') || '').trim(); const owner = String(value('项目负责人') || issue?.assignee || '').trim(); const projectType = singleSelect(value('项目类型') || value('project_type'))
    if (!name || !owner) throw Object.assign(new Error('立项单缺少项目名称或项目负责人'), { code: 'MISSING_FIELD' })
    const projectUUID = await createProject(teamUUID, { name, owner, project_type_uuid: projectType.uuid, project_type_name: projectType.name, description: String(value('立项说明') || value('描述') || ''), start_time: value('计划开始日期'), end_time: value('计划结束日期') }, c.template_uuid)
    const done = { issue_uuid: issueUUID, team_uuid: teamUUID, event_id: eventID || existing?.event_id || '', status: 'created', project_uuid: projectUUID, project_name: name, project_type_uuid: projectType.uuid, project_type_name: projectType.name, error_code: '', error_message: '', retry_count: Number(existing?.retry_count || 0) + (retry ? 1 : 0), updated_at: Date.now() }
    runtimeRecords[issueUUID] = done; try { await records.set(issueUUID, done) } catch {}; return done
  } catch (e: any) { const failed = { ...(runtimeRecords[issueUUID] || {}), issue_uuid: issueUUID, team_uuid: teamUUID, status: 'failed', error_code: e?.code || 'CREATE_FAILED', error_message: e?.message || '创建项目失败', updated_at: Date.now() }; runtimeRecords[issueUUID] = failed; try { await records.set(issueUUID, failed) } catch {}; throw e }
}
export async function onIssueStatusChanged(req: PluginRequest): Promise<PluginResponse> { const e = eventOf(req), teamUUID = String(e.ctx.teamID || ''); if (!teamUUID || !e.data.issueID) return ok({ ignored: true }); const c = await config(teamUUID); if (!c.approval_project_uuid || !c.issue_type_uuid || !isApproved(c, e.data.newStatus)) return ok({ ignored: true }); const issue = await issueDetail(teamUUID, e.data.issueID); const issueType = String(issue?.issue_type_uuid || issue?.issueTypeUUID || issue?.type_uuid || issue?.issueType?.uuid || ''); if (issueType && issueType !== c.issue_type_uuid) return ok({ ignored: true }); if (issue?.project_uuid && issue.project_uuid !== c.approval_project_uuid) return ok({ ignored: true }); try { return ok(await run(teamUUID, String(e.data.issueID), e.id)) } catch { return ok({ status: 'failed', issue_uuid: e.data.issueID }) } }
export async function getConfig(req: PluginRequest): Promise<PluginResponse> { return ok(await config(team(req))) }
export async function saveConfig(req: PluginRequest): Promise<PluginResponse> { const teamUUID = team(req); if (!teamUUID) return fail('MISSING_TEAM', '无法识别当前团队，请从团队插件配置页打开'); const b = body(req); const approvalProject = normalizeId(b.approval_project_uuid); const issueType = normalizeId(b.issue_type_uuid); const template = normalizeId(b.template_uuid); if (!approvalProject || !issueType || !template || (!b.approved_status_uuid && !b.approved_status_name)) return fail('INVALID_CONFIG', '审批项目、工作项类型、通过状态和模板均为必填'); let mapping = '{}'; try { if (typeof b.mapping_json === 'string') { JSON.parse(b.mapping_json); mapping = b.mapping_json.slice(0, 4096) } else if (b.mapping_json && typeof b.mapping_json === 'object') mapping = JSON.stringify(b.mapping_json).slice(0, 4096) } catch { return fail('INVALID_CONFIG', '属性映射格式无效') } const value = { team_uuid: teamUUID, approval_project_uuid: approvalProject, issue_type_uuid: issueType, approved_status_uuid: normalizeId(b.approved_status_uuid), approved_status_name: String(b.approved_status_name || '已通过').trim(), template_uuid: template, mapping_json: mapping }; runtimeConfig[teamUUID] = value; try { await configs.set(key(teamUUID), value) } catch {} return ok(value) }
export async function listRecords(req: PluginRequest): Promise<PluginResponse> { const q: any = await records.query().limit(200).getMany(); return ok({ items: (q?.data || []).map((x: any) => ({ id: x.key, ...x.value })) }) }
export async function retryRecord(req: PluginRequest): Promise<PluginResponse> { if (!user(req)) return fail('UNAUTHENTICATED', '未识别到登录用户', 401); const id = String(body(req).issue_uuid || ''); if (!id) return fail('INVALID_REQUEST', '缺少 issue_uuid'); try { return ok(await run(team(req), id, `manual_${Date.now()}`, true)) } catch (e: any) { return fail(e?.code || 'CREATE_FAILED', e?.message || '创建项目失败') } }
