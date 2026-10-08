import React, { useCallback, useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'

const team = () => {
  const w: any = window
  return String(w.__ONES_MF_ENV__?.request?.headers?.['Ones-Check-Id'] || w.__ONES_MF_ENV__?.request?.headers?.['ones-check-id'] || location.hash.match(/\/team\/([A-Za-z0-9_-]+)/)?.[1] || '')
}

const json = async (response: Response, label: string) => {
  const text = await response.text()
  let value: any = {}
  try { value = text ? JSON.parse(text) : {} } catch { throw Error(`${label}返回了无法识别的结果（${response.status}）`) }
  if (!response.ok) throw Error(value?.desc || value?.message || value?.errcode || `${label}失败（${response.status}）`)
  return value?.body || (value?.data && typeof value.data === 'object' && ('ok' in value.data || 'error' in value.data) ? value.data : value)
}

const api = async (path: string, data: any = {}) => {
  const id = team()
  if (!id) throw Error('无法识别团队上下文，请从 ONES 侧边栏重新打开立项审批记录')
  const bases = [
    `/project/api/project/team/${id}`,
    `/project/api/project/team/${id}/plugin/dev_project_approval_v2/api`,
    `/project/api/project/team/${id}/plugin/project_approval_v2`,
    `/project/api/project/team/${id}/plugin/project_approval_v2/api`,
    `/api/plugin/project_approval_v2/team/${id}`,
    `/api/plugin/project_approval_v2`,
  ]
  let last: any
  for (const base of bases) {
    try {
      const response = await fetch(`${base}${path}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, team_uuid: id }) })
      const value = await json(response, '立项审批接口')
      const payload = value
      if (payload?.ok) return payload.data
      last = Error(payload?.error?.message || '立项审批接口返回失败')
    } catch (error: any) { last = error }
  }
  throw Error(last?.message || '立项审批接口不可用')
}

const dateValue = (value: any) => { if (!value) return ''; if (typeof value === 'number' || /^\d{10,}$/.test(String(value))) { const d = new Date(Number(value)); if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10) } return String(value).slice(0, 10) }

// ---- 项目创建与验证（走前端同源内部接口，老版本已验证可靠）----
const native = async (path: string, data: any) => json(await fetch(`/project/api/ones-project/team/${team()}${path}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }), '项目创建接口')
const uuid = () => Array.from({ length: 16 }, () => '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 36)]).join('')
// 内部模板枚举：配置页已直接存内部枚举；兜底回退瀑布（已验证）防止误配
const KNOWN_TEMPLATES = new Set(['waterfall_development', 'agile_development', 'task_management'])
const verifyProject = async (projectUUID: string) => { const id = team(); const paths = [`/project/api/project/team/${id}/project/${projectUUID}`, `/project/api/project/team/${id}/project/${projectUUID}/browse`]; for (const path of paths) for (const method of ['GET', 'POST']) try { const r = await fetch(path, { method, credentials: 'include', headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined, body: method === 'POST' ? '{}' : undefined }); if (!r.ok) continue; const value: any = await r.json(); const data: any = value?.body || value?.data || value; if (data && typeof data === 'object' && (data.uuid || data.project_uuid || data.name || data.project)) return true } catch {} return false }

// ---- 从配置读字段映射（消除硬编码字段 UUID）----
let cachedConfig: any = null
const loadConfig = async () => {
  if (cachedConfig?.maps) return cachedConfig
  try {
    const c = await api('/config/get')
    let maps: any = {}
    try { maps = JSON.parse(c?.mapping_json || '{}') } catch {}
    cachedConfig = { ...c, maps }
  } catch { cachedConfig = { maps: {} } }
  return cachedConfig
}

const resolveTypeOption = async (record: any) => { const typeUuid = String(record.project_type_uuid || record.source_type || ''); const typeName = String(record.project_type_name || record.source_type_name || ''); if (!typeName && !typeUuid) return ''; const { maps } = await loadConfig(); const typeProjectField = String(maps['项目类型目标字段'] || ''); const wanted = typeName.trim(); try { const data = await api('/project-fields/list'); const fields = Array.isArray(data?.items) ? data.items : []; const field = fields.find((f: any) => f.uuid === typeProjectField); const options = Array.isArray(field?.options) ? field.options : []; const match = options.find((o: any) => String(o?.value ?? o?.name ?? o?.id ?? o?.uuid ?? o?.label ?? '').trim() === wanted); if (match) return String(match.uuid || match.id || '') } catch {} return typeUuid }
const doUpdate = async (projectUUID: string, item: any) => {
  try {
    const r = await fetch(`/project/api/project/team/${team()}/item/project-${projectUUID}/update`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item }) })
    const raw = await r.text()
    let value: any = {}
    try { value = raw ? JSON.parse(raw) : {} } catch {}
    const failed = !r.ok || value?.error || value?.data?.error || value?.body?.error
    return { ok: !failed, detail: `status=${r.status} ${raw.slice(0, 260)}` }
  } catch (e: any) {
    return { ok: false, detail: String(e?.message || e) }
  }
}
const updateProject = async (projectUUID: string, record: any) => {
  const { maps } = await loadConfig()
  const typeProjectField = String(maps['项目类型目标字段'] || '')
  const typeOption = await resolveTypeOption(record)
  const builtin: any = {}
  if (record.owner_uuid) builtin.assign = record.owner_uuid
  if (record.start_date) builtin.plan_start_time = new Date(dateValue(record.start_date)).getTime() / 1000
  if (record.end_date) builtin.plan_end_time = new Date(dateValue(record.end_date)).getTime() / 1000
  const custom: any = {}
  if (typeProjectField && typeOption) custom[typeProjectField] = typeOption

  // 内置字段 + 自定义字段一起写
  const all = { ...builtin, ...custom }
  if (Object.keys(all).length) {
    const r1 = await doUpdate(projectUUID, all)
    if (r1.ok) return { ok: true, detail: '全部字段更新成功', item: all }
    // 若因自定义字段 NotFound 失败，降级只写内置字段
    if (Object.keys(builtin).length) {
      const r2 = await doUpdate(projectUUID, builtin)
      if (r2.ok) return { ok: true, detail: `内置字段成功；自定义字段(${typeProjectField})失败：${r1.detail}`, item: builtin }
      return { ok: false, detail: `内置字段也失败：${r2.detail}`, item: builtin }
    }
    return { ok: false, detail: r1.detail, item: all }
  }
  return { ok: true, detail: '无字段可更新', item: {} }
}

function App() {
  const [items, setItems] = useState<any[]>([])
  const [message, setMessage] = useState('正在检查待创建项目…')
  const [busy, setBusy] = useState('')
  const attempted = useRef(new Set<string>())

  const load = useCallback(async () => { const data = await api('/records/list'); const records = data.items || []; setItems(records); return records }, [])
  const create = useCallback(async (record: any, automatic = false) => {
    const creatingKey = `ones-project-approval:create:${record.issue_uuid}:creating`
    const now = Date.now()

    // 「创建中」全局锁（30 秒）→ 防止并发/刷新导致重复创建
    const creating = localStorage.getItem(creatingKey)
    if (creating && now - Number(creating) < 30000) return

    localStorage.setItem(creatingKey, String(now))
    setBusy(record.issue_uuid); setMessage(automatic ? '检测到待创建记录，正在创建项目…' : '正在创建项目…')
    try {
      const record2 = { ...record, project_name: record.project_name, owner_uuid: record.owner_uuid, start_date: record.start_date, end_date: record.end_date, project_type_uuid: record.project_type_uuid, project_type_name: record.project_type_name }
      const cfg2 = await loadConfig()
      const name = String(record2.project_name || record2.name || `立项项目-${String(record.issue_uuid).slice(-8)}`).trim()
      const configuredTemplate = String(cfg2.template_uuid || 'waterfall_development')
      // 兜底：不认识/误配的模板回退到已验证的瀑布
      const templateId = KNOWN_TEMPLATES.has(configuredTemplate) ? configuredTemplate : 'waterfall_development'
      const generated = await native('/identifier', { name })
      const identifier = String(generated.identifier || '')
      if (!identifier) throw Error('未取得项目标识')
      const checked = await native('/identifier/check', { identifier })
      if (checked.is_duplicate) throw Error(`项目标识重复：${identifier}`)
      const myUuid = uuid()
      const result = await native('/projects/add2', { uuid: myUuid, name, icon: 'i-ProjectFilled', identifier, keep_sample_data: true, members: record.trigger_user_uuid ? [record.trigger_user_uuid] : [], template_id: templateId })
      // 健壮解析返回的项目 UUID（add2 用的就是客户端传入的 myUuid，兜底用它）
      const p: any = result || {}
      const projectUUID = String(p.project_uuid || p.uuid || p.project?.uuid || p.project?.project_uuid || p.data?.project_uuid || p.data?.uuid || myUuid)
      const up = await updateProject(projectUUID, record2)
      await api('/records/confirm', { issue_uuid: record.issue_uuid, project_uuid: projectUUID, project_identifier: identifier })
      const upInfo = up.ok ? '' : `（⚠ 字段映射失败：${up.detail}）`
      setMessage(`项目“${name}”已创建${upInfo}；更新字段：${JSON.stringify(up.item)}`); await load()
    } catch (error: any) {
      setMessage(`创建失败：${error?.message || '未知错误'}。请先刷新确认项目是否已生成。`)
    } finally {
      localStorage.removeItem(creatingKey)
      setBusy('')
    }
  }, [load])

  useEffect(() => { load().then((records) => {
    const pending = records.find((record: any) => record.status === 'pending')
    if (!pending) { setMessage('当前没有待创建项目'); return }
    if (!attempted.current.has(pending.issue_uuid)) { attempted.current.add(pending.issue_uuid); create(pending, true) }
  }).catch((error) => setMessage(`加载失败：${error.message}`)) }, [create, load])

  const open = (id: string) => { window.open(`/project/#/home/project/view/${id}`, '_blank') }
  return <main><h1>立项审批记录</h1><p>{message}</p><button onClick={() => load().catch((error) => setMessage(`刷新失败：${error.message}`))}>刷新</button>{items.map((record) => <section key={record.id || record.issue_uuid}><b>{record.project_name || record.issue_uuid}</b><span> 状态：{record.status === 'pending' ? '待创建' : record.status === 'created' ? '已创建' : record.status}</span>{record.status === 'pending' && <button disabled={busy === record.issue_uuid} onClick={() => create(record)}>{busy === record.issue_uuid ? '正在创建' : '重新创建'}</button>}{record.project_uuid && <><span> 项目：{record.project_uuid}</span><button onClick={() => open(record.project_uuid)}>打开项目</button></>}{record.error_message && <p>{record.error_message}</p>}</section>)}</main>
}

ReactDOM.render(<App />, document.getElementById('ones-mf-root'))
