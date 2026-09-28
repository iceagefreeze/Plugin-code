import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom'

const team = () => String((window as any).__ONES_MF_ENV__?.request?.headers?.['Ones-Check-Id'] || location.hash.match(/\/team\/([\w-]+)/)?.[1] || '')

const api = async (path: string, data: any = {}) => {
  const r = await fetch(`/project/api/project/team/${team()}${path}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
  const raw = await r.text()
  let j: any = {}
  try { j = raw ? JSON.parse(raw) : {} } catch { throw Error(`接口返回格式异常（${r.status}）`) }
  if (!r.ok) throw Error(j?.body?.error?.message || j?.error?.message || `请求失败（${r.status}）`)
  const p = j?.body || j?.data || j
  if (p?.ok === false) throw Error(p.error?.message || `请求失败（${r.status}）`)
  return p?.data ?? p
}

const gql = (q: string) => api('/items/graphql?t=issueTypes', { query: q, variables: {} })

const input: any = { width: '100%', boxSizing: 'border-box', height: 44, padding: '0 12px', fontSize: 16, border: '1px solid #c9cdd3', borderRadius: 4 }

function Picker({ label, value, items, onChange, placeholder }: { label: string, value: string, items: any[], onChange: (v: string) => void, placeholder?: string }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const selected = items.find(x => x.uuid === value)
  const found = items.filter(x => String(x.name || '').toLowerCase().includes(q.toLowerCase()))
  return <label style={{ display: 'block', margin: '20px 0' }}>
    <b>{label}</b>
    <div style={{ position: 'relative' }}>
      <input style={input} value={open ? q : (selected?.name || '')} placeholder={placeholder || '输入关键词搜索'} onFocus={() => setOpen(true)} onChange={e => { setQ(e.target.value); setOpen(true) }} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && <div style={{ position: 'absolute', zIndex: 10, left: 0, right: 0, maxHeight: 240, overflow: 'auto', background: '#fff', border: '1px solid #aaa', boxShadow: '0 4px 12px rgba(0,0,0,.1)' }}>
        {found.map(x => <div key={x.uuid} onMouseDown={() => { onChange(x.uuid); setQ(''); setOpen(false) }} style={{ padding: 11, cursor: 'pointer' }}>{x.name}{x.typeLabel ? <span style={{ color: '#999', fontSize: 12 }}>（{x.typeLabel}）</span> : null}</div>)}
        {found.length === 0 && <div style={{ padding: 11, color: '#999' }}>无匹配项</div>}
      </div>}
    </div>
  </label>
}

function App() {
  const [f, setF] = useState<any>({ approved_status_name: '已通过', template_uuid: 'waterfall', mapping_json: '{}' })
  const [projects, setProjects] = useState<any[]>([])
  const [types, setTypes] = useState<any[]>([])
  const [statuses, setStatuses] = useState<any[]>([])
  const [fields, setFields] = useState<any[]>([])
  const [projectFields, setProjectFields] = useState<any[]>([])
  const [step, setStep] = useState(0)
  const [msg, setMsg] = useState('')

  let maps: any = {}
  try { maps = JSON.parse(f.mapping_json || '{}') } catch {}

  useEffect(() => {
    api('/config/get').then(x => setF({ ...x, mapping_json: x.mapping_json || '{}' })).catch(() => {})
    gql('{ buckets(groupBy: { projects: {} }) { projects { uuid name } } }').then(x => setProjects((x.buckets || []).flatMap((b: any) => b.projects || []))).catch(e => setMsg('项目列表加载失败：' + e.message))
    api('/statuses/list').then((x: any) => setStatuses(x.items || [])).catch(e => setMsg('状态列表加载失败：' + e.message))
    api('/fields/list').then((x: any) => setFields(x.items || [])).catch(e => setMsg('字段列表加载失败：' + e.message))
    api('/project-fields/list').then((x: any) => setProjectFields(x.items || [])).catch(() => {})
  }, [])

  useEffect(() => {
    if (f.approval_project_uuid) gql('{ issueTypes(orderBy: { namePinyin: ASC }) { uuid name } }').then(x => setTypes(x.issueTypes || [])).catch(e => setMsg('工作项类型加载失败：' + e.message))
  }, [f.approval_project_uuid])

  const save = async () => { try { await api('/config/save', f); setMsg('配置已保存') } catch (e: any) { setMsg(`保存失败：${e.message}`) } }
  const setMap = (k: string, v: string) => setF({ ...f, mapping_json: JSON.stringify({ ...maps, [k]: v }) })

  const rows: Array<[string, string]> = [
    ['项目名称', '字段'],
    ['项目负责人', '字段'],
    ['计划开始日期', '字段'],
    ['计划完成日期', '字段'],
    ['立项说明 / 描述', '字段'],
    ['项目类型（单选）', '字段'],
  ]

  return <main style={{ maxWidth: 1100, margin: '0 auto', padding: 24, fontFamily: 'Arial,"Microsoft YaHei"', height: '100%', overflowY: 'auto' }}>
    <h1>立项审批配置</h1>
    <div style={{ display: 'flex', height: 64, margin: '24px 0 34px', borderTop: '1px solid #ddd', borderBottom: '1px solid #ddd' }}>
      {['设置新建项目触发条件', '配置工作项属性和项目属性映射'].map((x, i) => <button key={x} onClick={() => setStep(i)} style={{ flex: 1, border: 0, fontSize: 19, color: step === i ? '#1677ff' : '#777', background: step === i ? '#edf5ff' : '#fff', cursor: 'pointer' }}>{step > i ? '✓' : '●'} {x}</button>)}
    </div>
    {step === 0 ? <section>
      <Picker label="选择立项审批单所属项目" value={f.approval_project_uuid || ''} items={projects} onChange={v => setF({ ...f, approval_project_uuid: v, issue_type_uuid: '' })} placeholder="输入关键词搜索项目" />
      <Picker label="选择立项审批单对应的工作项类型" value={f.issue_type_uuid || ''} items={types} onChange={v => setF({ ...f, issue_type_uuid: v })} placeholder="输入关键词搜索类型" />
      <Picker label="触发审批单状态（审批单流转到此状态时触发创建）" value={f.approved_status_uuid || ''} items={statuses} onChange={v => { const s = statuses.find(x => x.uuid === v); setF({ ...f, approved_status_uuid: v, approved_status_name: s?.name || '' }) }} placeholder="输入关键词搜索状态" />
      <label>选择项目模板<select style={input} value={f.template_uuid || 'waterfall'} onChange={e => setF({ ...f, template_uuid: e.target.value })}><option value="waterfall">系统内置瀑布研发管理模板</option></select></label>
    </section> : <section style={{ border: '1px solid #ddd' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', padding: 16, background: '#f5f7fa', fontWeight: 700 }}><span>项目属性（新项目）</span><span>立项审批工作项属性（来源）</span></div>
      {rows.map(([target]) => <div key={target} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, padding: 14, borderTop: '1px solid #eee', alignItems: 'center' }}>
        <span>{target}</span>
        <Picker label="" value={maps[target] || ''} items={fields} onChange={v => setMap(target, v)} placeholder="选择同类型属性" />
      </div>)}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, padding: 14, borderTop: '1px solid #eee', alignItems: 'center' }}>
        <span>项目类型 → 新项目自定义属性字段</span>
        <Picker label="" value={maps['项目类型目标字段'] || ''} items={projectFields} onChange={v => setMap('项目类型目标字段', v)} placeholder="选择新项目的项目类型字段" />
      </div>
    </section>}
    <div style={{ marginTop: 24 }}>
      <button onClick={() => setStep(step ? 0 : 1)} style={{ padding: '10px 26px', background: '#1677ff', color: '#fff', border: 0, cursor: 'pointer' }}>{step ? '上一步' : '下一步'}</button>
      <button onClick={save} style={{ padding: '10px 26px', marginLeft: 10, background: '#1677ff', color: '#fff', border: 0, cursor: 'pointer' }}>保存配置</button>
    </div>
    {msg && <p style={{ color: msg.includes('失败') ? '#d4380d' : '#1677ff' }}>{msg}</p>}
  </main>
}

ReactDOM.render(<App />, document.getElementById('ones-mf-root'))
