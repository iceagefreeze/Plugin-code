import { storage } from '@ones-op/sdk/node'
import { OPFetch } from '@ones-op/fetch'
import type { PluginRequest, PluginResponse } from '@ones-op/node-types'

const configs = storage.entity('approval_config')
const records = storage.entity('approval_record')
const ok = (data: unknown = null): PluginResponse => ({ body: { ok: true, data, error: null } })
const fail = (code: string, message: string, statusCode = 400): PluginResponse => ({ statusCode, body: { ok: false, data: null, error: { code, message } } })
const body = (r: any) => r?.body && typeof r.body === 'object' ? r.body : {}
const user = (r: any) => String(r?.headers?.['ones-user-id'] || r?.headers?.['Ones-User-Id'] || '')
const team = (r: any) => {
  const fromParams = r?.params?.teamUUID || r?.params?.team_uuid
  const fromUrl = String(r?.url || r?.path || '').split('?')[0].match(/\/team\/([A-Za-z0-9_-]+)/)?.[1]
  return String(fromParams || fromUrl || body(r).team_uuid || r?.headers?.['ones-check-id'] || r?.headers?.['Ones-Check-Id'] || '')
}
const key = (teamUUID: string) => `team_${teamUUID}`
const eventOf = (r: any) => { const e = r?.body?.eventID ? r.body : r; return { id: String(e?.eventID || ''), ctx: e?.eventContext || {}, data: e?.eventData || {} } }
async function config(teamUUID: string): Promise<any> { return (await configs.get(key(teamUUID))) || {} }
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
  const existing: any = await records.get(issueUUID); if (existing?.status === 'created') return existing
  const now = Date.now(); await records.set(issueUUID, { ...(existing || {}), issue_uuid: issueUUID, team_uuid: teamUUID, event_id: eventID || existing?.event_id || '', status: 'creating', retry_count: Number(existing?.retry_count || 0) + (retry ? 1 : 0), updated_at: now })
  try {
    const issue = await issueDetail(teamUUID, issueUUID); const p = issue?.properties || issue?.data?.properties || {}
    const value = (name: string) => p[name]?.value ?? p[name]?.displayValue ?? p[name]
    const name = String(issue?.name || issue?.title || value('立项名称') || '').trim(); const owner = String(value('项目负责人') || issue?.assignee || '').trim(); const projectType = singleSelect(value('项目类型') || value('project_type'))
    if (!name || !owner) throw Object.assign(new Error('立项单缺少项目名称或项目负责人'), { code: 'MISSING_FIELD' })
    const projectUUID = await createProject(teamUUID, { name, owner, project_type_uuid: projectType.uuid, project_type_name: projectType.name, description: String(value('立项说明') || value('描述') || ''), start_time: value('计划开始日期'), end_time: value('计划结束日期') }, c.template_uuid)
    const done = { issue_uuid: issueUUID, team_uuid: teamUUID, event_id: eventID || existing?.event_id || '', status: 'created', project_uuid: projectUUID, project_name: name, project_type_uuid: projectType.uuid, project_type_name: projectType.name, error_code: '', error_message: '', retry_count: Number(existing?.retry_count || 0) + (retry ? 1 : 0), updated_at: Date.now() }
    await records.set(issueUUID, done); return done
  } catch (e: any) { const failed = { ...(await records.get(issueUUID) || {}), issue_uuid: issueUUID, team_uuid: teamUUID, status: 'failed', error_code: e?.code || 'CREATE_FAILED', error_message: e?.message || '创建项目失败', updated_at: Date.now() }; await records.set(issueUUID, failed); throw e }
}
export async function onIssueStatusChanged(req: PluginRequest): Promise<PluginResponse> { const e = eventOf(req), teamUUID = String(e.ctx.teamID || ''); if (!teamUUID || !e.data.issueID) return ok({ ignored: true }); const c = await config(teamUUID); if (!c.approval_project_uuid || !c.issue_type_uuid || !isApproved(c, e.data.newStatus)) return ok({ ignored: true }); const issue = await issueDetail(teamUUID, e.data.issueID); const issueType = String(issue?.issue_type_uuid || issue?.issueTypeUUID || issue?.type_uuid || issue?.issueType?.uuid || ''); if (issueType && issueType !== c.issue_type_uuid) return ok({ ignored: true }); if (issue?.project_uuid && issue.project_uuid !== c.approval_project_uuid) return ok({ ignored: true }); try { return ok(await run(teamUUID, String(e.data.issueID), e.id)) } catch { return ok({ status: 'failed', issue_uuid: e.data.issueID }) } }
export async function getConfig(req: PluginRequest): Promise<PluginResponse> { return ok(await config(team(req))) }
export async function saveConfig(req: PluginRequest): Promise<PluginResponse> { if (!user(req)) return fail('UNAUTHENTICATED', '未识别到登录用户', 401); const b = body(req); if (!b.approval_project_uuid || !b.issue_type_uuid || !b.template_uuid || (!b.approved_status_uuid && !b.approved_status_name)) return fail('INVALID_CONFIG', '审批项目、工作项类型、通过状态和模板均为必填'); await configs.set(key(team(req)), { team_uuid: team(req), approval_project_uuid: String(b.approval_project_uuid), issue_type_uuid: String(b.issue_type_uuid), approved_status_uuid: String(b.approved_status_uuid || ''), approved_status_name: String(b.approved_status_name || '已通过'), template_uuid: String(b.template_uuid) }); return ok(await config(team(req))) }
export async function listRecords(req: PluginRequest): Promise<PluginResponse> { const q: any = await records.query().limit(200).getMany(); return ok({ items: (q?.data || []).map((x: any) => ({ id: x.key, ...x.value })) }) }
export async function retryRecord(req: PluginRequest): Promise<PluginResponse> { if (!user(req)) return fail('UNAUTHENTICATED', '未识别到登录用户', 401); const id = String(body(req).issue_uuid || ''); if (!id) return fail('INVALID_REQUEST', '缺少 issue_uuid'); try { return ok(await run(team(req), id, `manual_${Date.now()}`, true)) } catch (e: any) { return fail(e?.code || 'CREATE_FAILED', e?.message || '创建项目失败') } }
