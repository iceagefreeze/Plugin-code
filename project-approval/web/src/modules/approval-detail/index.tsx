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
  // Team API responses are wrapped as { data: { ok, data, error } }.
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

const native = async (path: string, data: any) => json(await fetch(`/project/api/ones-project/team/${team()}${path}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }), '项目创建接口')
const verifyProject = async (projectUUID: string) => { const id = team(); const paths = [`/project/api/project/team/${id}/project/${projectUUID}`, `/project/api/project/team/${id}/project/${projectUUID}/browse`]; for (const path of paths) for (const method of ['GET', 'POST']) try { const r = await fetch(path, { method, credentials: 'include', headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined, body: method === 'POST' ? '{}' : undefined }); if (!r.ok) continue; const value: any = await r.json(); const data: any = value?.body || value?.data || value; if (data && typeof data === 'object' && (data.uuid || data.project_uuid || data.name || data.project)) return true } catch {} return false }
const formName = (value: any, wanted?: string): string => { if (!value || typeof value !== 'object') return ''; if (wanted && Object.prototype.hasOwnProperty.call(value, wanted)) { const v: any = value[wanted]; const text = typeof v === 'object' ? (v.value || v.displayValue || v.text || v.name) : v; if (String(text || '').trim()) return String(text).trim() } for (const key of ['project_name', '项目名称', '立项名称', 'name', 'title']) if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim(); for (const item of Object.values(value)) { const found = formName(item, wanted); if (found) return found } return '' }
const dateValue = (value: any) => { if (!value) return ''; if (typeof value === 'number' || /^\d{10,}$/.test(String(value))) { const d = new Date(Number(value)); if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10) } return String(value).slice(0, 10) }
const enrich = async (record: any) => { const id = team(); try { const response = await fetch(`/project/api/ones-project/team/${id}/workitems/onesql`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: `select uid(field001,Bukbqjpm,field027,field028,QE8d8KfA,field003,field004,cA3wKBQs,v$issue_path) from issue where uid(uuid) = uid('${record.issue_uuid}');` }) }); if (response.ok) { const json: any = await response.json(); const item = json?.data?.[0]?.item || json?.body?.data?.[0]?.item; const name = item?.Bukbqjpm || formName(item); const type = item?.cA3wKBQs; const typeName = typeof type === 'object' ? (type.name || type.value || type.text || '') : String(type || ''); const ownerValue: any = item?.QE8d8KfA || item?.field003 || item?.field004; const owner = typeof ownerValue === 'object' ? ownerValue.uuid : (typeof ownerValue === 'string' ? ownerValue : ''); if (name) { await api('/records/enrich', { issue_uuid: record.issue_uuid, project_name: String(name) }); return { ...record, project_name: String(name), source_start: item?.field027 || '', source_end: item?.field028 || '', source_type: typeof type === 'object' ? (type.uuid || '') : '', source_type_name: typeName, source_owner: owner || 'RXbUNSu8' } } } } catch {} return record }
const findOptions = (value: any): any[] => { if (!value || typeof value !== 'object') return []; if (Array.isArray(value.options)) return value.options; for (const child of Object.values(value)) { const found = findOptions(child); if (found.length) return found } return [] }
const resolveTypeOption = async (projectUUID: string, record: any) => { if (!record.source_type_name && !record.source_type) return ''; const id = team(); const paths = [`/item/project-${projectUUID}/fields`, `/item/project-${projectUUID}`, `/projects/${projectUUID}/fields`]; for (const path of paths) for (const method of ['GET', 'POST']) try { const r = await fetch(`/project/api/project/team/${id}${path}`, { method, credentials: 'include', headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined, body: method === 'POST' ? '{}' : undefined }); if (!r.ok) continue; const value = await r.json(); const options = findOptions(value?.body || value?.data || value); const wanted = String(record.source_type_name || '').trim(); const match = options.find((o: any) => String(o?.value || o?.name || o?.label || '').trim() === wanted); if (match?.uuid) return String(match.uuid) } catch {} return String(record.source_type || '') }
const updateProject = async (projectUUID: string, record: any) => { const item: any = {}; if (record.source_start) item.plan_start_time = dateValue(record.source_start); if (record.source_end) item.plan_end_time = dateValue(record.source_end); if (record.source_owner) item.assign = record.source_owner; const typeOption = await resolveTypeOption(projectUUID, record) || ({ '研发类': 'PGk2ztpj' } as any)[String(record.source_type_name || '').trim()] || ''; if (typeOption) item.EdUDpRTR = typeOption; if (!Object.keys(item).length) return; const r = await fetch(`/project/api/project/team/${team()}/item/project-${projectUUID}/update`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item }) }); const raw = await r.text(); let value: any = {}; try { value = raw ? JSON.parse(raw) : {} } catch {} if (!r.ok || value?.error || value?.data?.error) throw Error(`项目属性更新失败（${r.status}）`) }
const uuid = () => Array.from({ length: 16 }, () => '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 36)]).join('')

function App() {
  const [items, setItems] = useState<any[]>([])
  const [message, setMessage] = useState('正在检查待创建项目…')
  const [busy, setBusy] = useState('')
  const attempted = useRef(new Set<string>())

  const load = useCallback(async () => { const data = await api('/records/list'); const records = data.items || []; setItems(records); return records }, [])
  const create = useCallback(async (record: any, automatic = false) => {
    const lockKey = `ones-project-approval:create:${record.issue_uuid}`
    if (sessionStorage.getItem(lockKey) === '1') return
    const knownProject = localStorage.getItem(lockKey)
    if (knownProject && await verifyProject(knownProject)) { await api('/records/confirm', { issue_uuid: record.issue_uuid, project_uuid: knownProject }); await load(); return } localStorage.removeItem(lockKey)
    sessionStorage.setItem(lockKey, '1')
    setBusy(record.issue_uuid); setMessage(automatic ? '检测到待创建记录，正在创建项目…' : '正在创建项目…')
    try {
      const enriched = await enrich(record); const name = String(enriched.project_name || `立项项目-${String(record.issue_uuid).slice(-8)}`)
      const generated = await native('/identifier', { name })
      const identifier = String(generated.identifier || '')
      if (!identifier) throw Error('未取得项目标识')
      const checked = await native('/identifier/check', { identifier })
      if (checked.is_duplicate) throw Error(`项目标识重复：${identifier}`)
      const result = await native('/projects/add2', { uuid: uuid(), name, icon: 'i-ProjectFilled', identifier, keep_sample_data: true, members: record.trigger_user_uuid ? [record.trigger_user_uuid] : [], template_id: 'waterfall_development' })
      const projectUUID = String(result.project_uuid || '')
      if (!projectUUID) throw Error('创建接口未返回项目 UUID')
      localStorage.setItem(lockKey, projectUUID)
      await updateProject(projectUUID, enriched)
      await api('/records/confirm', { issue_uuid: record.issue_uuid, project_uuid: projectUUID, project_identifier: identifier })
      setMessage(`项目“${name}”已创建并验证可访问`); await load()
    } catch (error: any) { setMessage(`创建失败：${error?.message || '未知错误'}。请先刷新确认项目是否已生成。`) } finally { setBusy(''); sessionStorage.removeItem(lockKey) }
  }, [load])

  useEffect(() => { load().then((records) => {
    const pending = records.find((record: any) => record.status === 'pending')
    if (!pending) { setMessage('当前没有待创建项目'); return }
    if (!attempted.current.has(pending.issue_uuid)) { attempted.current.add(pending.issue_uuid); create(pending, true) }
  }).catch((error) => setMessage(`加载失败：${error.message}`)) }, [create, load])

  const open = (id: string, identifier?: string) => { window.parent.location.assign(`/project/#/home/project/view/${identifier || id}`) }
  return <main><h1>立项审批记录</h1><p>{message}</p><button onClick={() => load().catch((error) => setMessage(`刷新失败：${error.message}`))}>刷新</button>{items.map((record) => <section key={record.id || record.issue_uuid}><b>{record.project_name || record.issue_uuid}</b><span> 状态：{record.status === 'pending' ? '待创建' : record.status === 'created' ? '已创建' : record.status}</span>{record.status === 'pending' && <button disabled={busy === record.issue_uuid} onClick={() => create(record)}>{busy === record.issue_uuid ? '正在创建' : '重新创建'}</button>}{record.project_uuid && <><span> 项目：{record.project_uuid}</span><button onClick={() => open(record.project_uuid, record.project_identifier)}>打开项目</button></>}{record.error_message && <p>{record.error_message}</p>}</section>)}</main>
}

ReactDOM.render(<App />, document.getElementById('ones-mf-root'))
