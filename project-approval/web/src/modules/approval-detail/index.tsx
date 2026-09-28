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
const updateProject = async (projectUUID: string, record: any) => {
  const { maps } = await loadConfig()
  const typeProjectField = String(maps['项目类型目标字段'] || '')
  const typeOption = await resolveTypeOption(record)
  const customField: any = {}
  if (typeProjectField && typeOption) customField[typeProjectField] = typeOption
  const data: any = { project_uuid: projectUUID }
  if (record.owner_uuid) data.owner = record.owner_uuid
  if (record.start_date) data.planned_start_date = dateValue(record.start_date)
  if (record.end_date) data.planned_end_date = dateValue(record.end_date)
  if (Object.keys(customField).length) data.custom_field = customField
  if (!data.owner && !data.planned_start_date && !data.planned_end_date && !Object.keys(customField).length) return
  await api('/project/update', data)
}

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
    if (knownProject) {
      const v = await api('/project/verify', { project_uuid: knownProject })
      if (v.exists) { await api('/records/confirm', { issue_uuid: record.issue_uuid, project_uuid: knownProject }); await load(); return }
      localStorage.removeItem(lockKey)
    }
    sessionStorage.setItem(lockKey, '1')
    setBusy(record.issue_uuid); setMessage(automatic ? '检测到待创建记录，正在创建项目…' : '正在创建项目…')
    try {
      const record2 = { ...record, project_name: record.project_name, owner_uuid: record.owner_uuid, start_date: record.start_date, end_date: record.end_date, project_type_uuid: record.project_type_uuid, project_type_name: record.project_type_name }
      const cfg2 = await loadConfig()
      const name = String(record2.project_name || record2.name || `立项项目-${String(record.issue_uuid).slice(-8)}`).trim()
      const members = record.trigger_user_uuid ? [record.trigger_user_uuid] : []
      const created = await api('/project/create', { name, template_uuid: cfg2.template_uuid || 'comwater', members })
      const projectUUID = String(created.project_uuid || '')
      if (!projectUUID) throw Error('创建接口未返回项目 UUID')
      const projectIdentifier = String(created.identifier || '')
      localStorage.setItem(lockKey, projectUUID)
      await updateProject(projectUUID, record2)
      await api('/records/confirm', { issue_uuid: record.issue_uuid, project_uuid: projectUUID, project_identifier: projectIdentifier })
      setMessage(`项目“${name}”已创建`); await load()
    } catch (error: any) { setMessage(`创建失败：${error?.message || '未知错误'}。请先刷新确认项目是否已生成。`) } finally { setBusy(''); sessionStorage.removeItem(lockKey) }
  }, [load])

  useEffect(() => { load().then((records) => {
    const pending = records.find((record: any) => record.status === 'pending')
    if (!pending) { setMessage('当前没有待创建项目'); return }
    if (!attempted.current.has(pending.issue_uuid)) { attempted.current.add(pending.issue_uuid); create(pending, true) }
  }).catch((error) => setMessage(`加载失败：${error.message}`)) }, [create, load])

  const open = (id: string) => { window.parent.location.assign(`/project/#/home/project/view/${id}`) }
  return <main><h1>立项审批记录</h1><p>{message}</p><button onClick={() => load().catch((error) => setMessage(`刷新失败：${error.message}`))}>刷新</button>{items.map((record) => <section key={record.id || record.issue_uuid}><b>{record.project_name || record.issue_uuid}</b><span> 状态：{record.status === 'pending' ? '待创建' : record.status === 'created' ? '已创建' : record.status}</span>{record.status === 'pending' && <button disabled={busy === record.issue_uuid} onClick={() => create(record)}>{busy === record.issue_uuid ? '正在创建' : '重新创建'}</button>}{record.project_uuid && <><span> 项目：{record.project_uuid}</span><button onClick={() => open(record.project_uuid)}>打开项目</button></>}{record.error_message && <p>{record.error_message}</p>}</section>)}</main>
}

ReactDOM.render(<App />, document.getElementById('ones-mf-root'))
