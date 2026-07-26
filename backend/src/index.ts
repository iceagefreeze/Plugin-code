import { Logger } from '@ones-op/node-logger'
import { storage } from '@ones-op/sdk/node'
import type { PluginRequest, PluginResponse } from '@ones-op/node-types'

type Status = 'draft' | 'published' | 'withdrawn'
type AudienceType = 'all' | 'selected'
type Attachment = { name: string; url: string }
type Audience = { uuid: string; name?: string }

const announcements = storage.entity('announcement')
const audiences = storage.entity('announcement_audience')
const reads = storage.entity('announcement_read')

const ok = (data: unknown = null): PluginResponse => ({ body: { ok: true, data, error: null } })
const fail = (statusCode: number, code: string, message: string): PluginResponse => ({
  statusCode, body: { ok: false, data: null, error: { code, message } },
})
const bodyOf = (req: any): any => req?.body && typeof req.body === 'object' ? req.body : {}
const operatorOf = (req: any): string => {
  const h = req?.headers || {}
  return String(h['ones-user-id'] || h['Ones-User-Id'] || h['ONES-USER-ID'] || '')
}
const teamOf = (req: any): string => {
  const body = bodyOf(req)
  const h = req?.headers || {}
  return String(body.team_uuid || h['ones-check-id'] || h['Ones-Check-Id'] || '')
}
const ascii = (s: string): string => s.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64)
const uid = (): string => `ann_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`

export function sanitizeHtml(input: unknown): string {
  let html = String(input || '').slice(0, 32768)
  html = html.replace(/<!--[\s\S]*?-->/g, '')
  html = html.replace(/<(script|style|iframe|object|embed|form|input|button|svg|math)[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
  html = html.replace(/<(script|style|iframe|object|embed|form|input|button|svg|math)\b[^>]*\/?s*>/gi, '')
  html = html.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  html = html.replace(/\s(?:src|href)\s*=\s*(["'])\s*(?:javascript|data|vbscript):[\s\S]*?\1/gi, '')
  const allowed = new Set(['p','br','strong','b','em','i','u','s','ul','ol','li','blockquote','pre','code','h1','h2','h3','h4','a','span'])
  return html.replace(/<\/?([a-z0-9-]+)(?:\s[^>]*)?>/gi, (tag, name) => allowed.has(String(name).toLowerCase()) ? tag : '')
}

function textOnly(html: string): string { return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').trim() }
function parseAttachments(value: unknown): Attachment[] {
  const list = Array.isArray(value) ? value : []
  if (list.length > 20) throw new Error('附件链接最多 20 个')
  return list.map((item: any) => {
    const name = String(item?.name || '').trim().slice(0, 256)
    const url = String(item?.url || '').trim()
    if (!name || !/^https:\/\/[^\s]+$/i.test(url)) throw new Error('附件必须包含文件名和有效 HTTPS 地址')
    return { name, url: url.slice(0, 2048) }
  })
}
function parseAudience(value: unknown): Audience[] {
  const list = Array.isArray(value) ? value : []
  const seen = new Set<string>()
  return list.map((x: any) => ({ uuid: String(x?.uuid || '').trim(), name: String(x?.name || '').trim().slice(0, 128) }))
    .filter(x => x.uuid && !seen.has(x.uuid) && seen.add(x.uuid))
}
function validateDraft(input: any) {
  const title = String(input.title || '').trim().slice(0, 256)
  const content_html = sanitizeHtml(input.content_html)
  const audience_type: AudienceType = input.audience_type === 'selected' ? 'selected' : 'all'
  const audience = parseAudience(input.audience)
  if (!title) throw new Error('标题不能为空')
  if (!textOnly(content_html)) throw new Error('正文不能为空')
  if (audience_type === 'selected' && !audience.length) throw new Error('定向公告至少选择一名成员')
  return { title, content_html, audience_type, audience, attachments: parseAttachments(input.attachments), is_pinned: !!input.is_pinned }
}
async function all(entity: any): Promise<any[]> {
  const result: any[] = []; let cursor = ''; let safety = 0
  while (safety++ < 200) {
    let query = entity.query().limit(200)
    if (cursor && typeof query.cursor === 'function') query = query.cursor(cursor)
    const page = await query.getMany()
    for (const row of page?.data || []) result.push({ _key: row.key, ...(row.value || {}) })
    if (!page?.page_info?.has_more || !page?.page_info?.end_cursor) break
    cursor = page.page_info.end_cursor
  }
  return result
}
async function audienceFor(id: string): Promise<any[]> { return (await all(audiences)).filter(x => x.announcement_id === id) }
async function readsFor(id: string): Promise<any[]> { return (await all(reads)).filter(x => x.announcement_id === id) }
async function visibleTo(a: any, user: string): Promise<boolean> {
  if (a.creator_uuid === user) return true
  if (a.status !== 'published') return false
  if (a.audience_type === 'all') return true
  return (await audienceFor(a._key)).some(x => x.user_uuid === user)
}
async function replaceAudience(id: string, team: string, project: string, list: Audience[]) {
  const old = await audienceFor(id)
  if (old.length) await audiences.batchDelete(old.map(x => x._key))
  if (list.length) await audiences.batchSet(list.map((x, i) => ({ key: ascii(`${id}_u_${i}`), value: { announcement_id: id, team_uuid: team, project_uuid: project, user_uuid: x.uuid, user_name: x.name || '', created_at: Date.now() } })))
}
function publicRow(a: any, readSet: Set<string>) {
  let attachments: Attachment[] = []
  try { attachments = JSON.parse(a.attachments_json || '[]') } catch {}
  return { id: a._key, ...a, attachments, is_read: readSet.has(a._key) }
}
function sortRows(a: any, b: any) { return Number(b.is_pinned) - Number(a.is_pinned) || (b.published_at || b.updated_at) - (a.published_at || a.updated_at) }
async function requireRecord(req: any): Promise<{ user: string; team: string; record: any } | PluginResponse> {
  const user = operatorOf(req); if (!user) return fail(401, 'UNAUTHENTICATED', '未识别到登录用户')
  const team = teamOf(req); const id = String(bodyOf(req).id || '')
  const record: any = id ? await announcements.get(id) : null
  if (!record || (team && record.team_uuid !== team)) return fail(404, 'NOT_FOUND', '公告不存在')
  return { user, team, record: { _key: id, ...record } }
}

export async function Install() { Logger.info('[项目公告 v1.0.0] Install') }
export async function Enable() { Logger.info('[项目公告 v1.0.0] Enable') }
export function Disable() { Logger.info('[项目公告 v1.0.0] Disable') }
export function UnInstall() { Logger.info('[项目公告 v1.0.0] UnInstall') }
export function Upgrade(info: any) { Logger.info('[项目公告 v1.0.0] Upgrade', info?.version) }
export async function copyProjectAnnouncementData(): Promise<PluginResponse> { return ok({ copied: false }) }

export async function createAnnouncement(req: PluginRequest): Promise<PluginResponse> {
  const user = operatorOf(req); if (!user) return fail(401, 'UNAUTHENTICATED', '未识别到登录用户')
  try {
    const b = bodyOf(req), team = teamOf(req), project = String(b.project_uuid || '')
    if (!team || !project) return fail(400, 'INVALID_CONTEXT', '缺少团队或项目上下文')
    const value = validateDraft(b); const id = uid(); const now = Date.now()
    await announcements.set(id, { team_uuid: team, project_uuid: project, title: value.title, content_html: value.content_html, attachments_json: JSON.stringify(value.attachments), status: 'draft', creator_uuid: user, creator_name: String(b.creator_name || '').slice(0,128), audience_type: value.audience_type, is_pinned: value.is_pinned, created_at: now, published_at: 0, updated_at: now })
    await replaceAudience(id, team, project, value.audience)
    return ok({ id })
  } catch (e: any) { return fail(400, 'VALIDATION_ERROR', e?.message || '参数错误') }
}
export async function updateAnnouncement(req: PluginRequest): Promise<PluginResponse> {
  const found = await requireRecord(req); if ('body' in found && !('record' in found)) return found
  const { user, record } = found as any; if (record.creator_uuid !== user) return fail(403, 'FORBIDDEN', '仅创建者可编辑')
  try {
    const value = validateDraft(bodyOf(req))
    await announcements.set(record._key, { ...record, title: value.title, content_html: value.content_html, attachments_json: JSON.stringify(value.attachments), audience_type: value.audience_type, is_pinned: value.is_pinned, updated_at: Date.now() })
    await replaceAudience(record._key, record.team_uuid, record.project_uuid, value.audience); return ok({ id: record._key })
  } catch (e: any) { return fail(400, 'VALIDATION_ERROR', e?.message || '参数错误') }
}
async function transition(req: PluginRequest, target: Status): Promise<PluginResponse> {
  const found = await requireRecord(req); if ('body' in found && !('record' in found)) return found
  const { user, record } = found as any; if (record.creator_uuid !== user) return fail(403, 'FORBIDDEN', '仅创建者可操作')
  const allowed = target === 'published' ? ['draft','withdrawn'] : ['published']
  if (!allowed.includes(record.status)) return fail(409, 'INVALID_STATE', '当前状态不允许此操作')
  if (target === 'published' && record.audience_type === 'selected' && !(await audienceFor(record._key)).length) return fail(400, 'EMPTY_AUDIENCE', '定向公告没有受众')
  const now = Date.now(); await announcements.set(record._key, { ...record, status: target, published_at: target === 'published' ? (record.published_at || now) : record.published_at, updated_at: now })
  return ok({ id: record._key, status: target })
}
export const publishAnnouncement = (r: PluginRequest) => transition(r, 'published')
export const withdrawAnnouncement = (r: PluginRequest) => transition(r, 'withdrawn')
export async function pinAnnouncement(req: PluginRequest): Promise<PluginResponse> {
  const found = await requireRecord(req); if ('body' in found && !('record' in found)) return found
  const { user, record } = found as any; if (record.creator_uuid !== user) return fail(403, 'FORBIDDEN', '仅创建者可置顶')
  await announcements.set(record._key, { ...record, is_pinned: !!bodyOf(req).is_pinned, updated_at: Date.now() }); return ok({ id: record._key })
}
export async function deleteAnnouncement(req: PluginRequest): Promise<PluginResponse> {
  const found = await requireRecord(req); if ('body' in found && !('record' in found)) return found
  const { user, record } = found as any; if (record.creator_uuid !== user) return fail(403, 'FORBIDDEN', '仅创建者可删除')
  if (record.status !== 'draft') return fail(409, 'INVALID_STATE', '仅草稿可永久删除')
  const audience = await audienceFor(record._key); if (audience.length) await audiences.batchDelete(audience.map(x => x._key))
  await announcements.delete(record._key); return ok({ id: record._key })
}
async function listFor(req: PluginRequest, projectOnly: boolean): Promise<PluginResponse> {
  const user = operatorOf(req); if (!user) return fail(401, 'UNAUTHENTICATED', '未识别到登录用户')
  const b = bodyOf(req), team = teamOf(req), project = String(b.project_uuid || '')
  const readSet = new Set((await all(reads)).filter(x => x.user_uuid === user).map(x => x.announcement_id))
  const source = (await all(announcements)).filter(x => x.team_uuid === team && (!projectOnly || x.project_uuid === project))
  const rows: any[] = []; for (const item of source) if (await visibleTo(item, user)) rows.push(publicRow(item, readSet))
  return ok({ items: rows.sort(sortRows), permission_mode: 'creator_fallback' })
}
export const listAnnouncements = (r: PluginRequest) => listFor(r, true)
export const listMyAnnouncements = (r: PluginRequest) => listFor(r, false)
export async function getAnnouncement(req: PluginRequest): Promise<PluginResponse> {
  const found = await requireRecord(req); if ('body' in found && !('record' in found)) return found
  const { user, record } = found as any; if (!(await visibleTo(record, user))) return fail(404, 'NOT_FOUND', '公告不存在')
  const audience = record.creator_uuid === user ? await audienceFor(record._key) : []
  const isRead = (await readsFor(record._key)).some(x => x.user_uuid === user)
  return ok({ ...publicRow(record, new Set(isRead ? [record._key] : [])), audience: audience.map(x => ({ uuid: x.user_uuid, name: x.user_name })) })
}
export async function markAnnouncementRead(req: PluginRequest): Promise<PluginResponse> {
  const found = await requireRecord(req); if ('body' in found && !('record' in found)) return found
  const { user, record } = found as any; if (!(await visibleTo(record, user))) return fail(404, 'NOT_FOUND', '公告不存在')
  const key = ascii(`${record._key}_r_${user}`), existing: any = await reads.get(key), now = Date.now()
  await reads.set(key, { announcement_id: record._key, team_uuid: record.team_uuid, project_uuid: record.project_uuid, user_uuid: user, user_name: String(bodyOf(req).user_name || existing?.user_name || '').slice(0,128), first_read_at: existing?.first_read_at || now, last_read_at: now })
  return ok({ first_read_at: existing?.first_read_at || now, last_read_at: now })
}
export async function getAnnouncementStats(req: PluginRequest): Promise<PluginResponse> {
  const found = await requireRecord(req); if ('body' in found && !('record' in found)) return found
  const { user, record } = found as any; if (record.creator_uuid !== user) return fail(403, 'FORBIDDEN', '仅创建者可查看阅读统计')
  const readRows = await readsFor(record._key); const target = record.audience_type === 'selected' ? await audienceFor(record._key) : []
  const readIds = new Set(readRows.map(x => x.user_uuid)); const unread = target.filter(x => !readIds.has(x.user_uuid))
  return ok({ audience_type: record.audience_type, read_count: readRows.length, unread_count: record.audience_type === 'selected' ? unread.length : null, readers: readRows.map(x => ({ uuid: x.user_uuid, name: x.user_name, first_read_at: x.first_read_at, last_read_at: x.last_read_at })), unread_members: unread.map(x => ({ uuid: x.user_uuid, name: x.user_name })) })
}
export async function getCapabilities(req: PluginRequest): Promise<PluginResponse> {
  if (!operatorOf(req)) return fail(401, 'UNAUTHENTICATED', '未识别到登录用户')
  return ok({ can_create: true, permission_mode: 'creator_fallback', note: '当前环境使用项目成员可创建、仅创建者可管理的安全降级模式' })
}
