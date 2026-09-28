import { useEffect, useState, useCallback } from 'react'
import ReactDOM from 'react-dom'
import { ONES } from '@ones-open/web-sdk'

type Option = { id: string; name: string }

// 可搜索下拉：原生 select 数据多时难选，用「输入框过滤 + 下拉列表」替代
const SearchableSelect = ({
  value,
  onChange,
  options,
  placeholder,
  filter,
}: {
  value: string
  onChange: (id: string) => void
  options: Option[]
  placeholder: string
  filter?: (opt: Option) => boolean
}) => {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const filtered = options.filter((o) => {
    if (filter && !filter(o)) return false
    if (!query) return true
    return o.name.toLowerCase().includes(query.toLowerCase()) || o.id.toLowerCase().includes(query.toLowerCase())
  })
  const selected = options.find((o) => o.id === value)
  return (
    <div style={{ position: 'relative' }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          padding: '6px 8px',
          boxSizing: 'border-box',
          border: '1px solid #ddd',
          borderRadius: 4,
          cursor: 'pointer',
          background: '#fff',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span style={{ color: selected ? '#333' : '#999' }}>{selected ? selected.name : placeholder}</span>
        <span style={{ color: '#999' }}>▾</span>
      </div>
      {open && (
        <div
          style={{
            position: 'absolute',
            zIndex: 100,
            top: '100%',
            left: 0,
            width: '100%',
            background: '#fff',
            border: '1px solid #ddd',
            borderRadius: 4,
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
            maxHeight: 240,
            overflowY: 'auto',
            marginTop: 2,
          }}
        >
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索…"
            style={{
              width: '100%',
              padding: '6px 8px',
              boxSizing: 'border-box',
              border: 'none',
              borderBottom: '1px solid #eee',
              outline: 'none',
            }}
          />
          {filtered.map((o) => (
            <div
              key={o.id}
              onClick={() => {
                onChange(o.id)
                setOpen(false)
                setQuery('')
              }}
              style={{
                padding: '6px 8px',
                cursor: 'pointer',
                fontSize: 13,
                background: o.id === value ? '#eef4ff' : '#fff',
              }}
              onMouseEnter={(e) => ((e.target as HTMLElement).style.background = '#f0f5ff')}
              onMouseLeave={(e) => ((e.target as HTMLElement).style.background = o.id === value ? '#eef4ff' : '#fff')}
            >
              {o.name}
            </div>
          ))}
          {filtered.length === 0 && <div style={{ padding: 8, color: '#999', fontSize: 13 }}>无匹配项</div>}
        </div>
      )}
    </div>
  )
}

const App = () => {
  const [teamUUID, setTeamUUID] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const [statuses, setStatuses] = useState<Option[]>([])
  const [issueFields, setIssueFields] = useState<any[]>([])
  const [projectFields, setProjectFields] = useState<any[]>([])
  const [projects, setProjects] = useState<Option[]>([])
  const [issueTypes, setIssueTypes] = useState<Option[]>([])
  const [teams, setTeams] = useState<Option[]>([])
  const [errors, setErrors] = useState<string[]>([])

  const [config, setConfig] = useState<any>({
    approved_status_id: '',
    approval_project_uuid: '',
    approval_issue_type_id: '',
    project_template_id: 'comwater',
    name_field_id: '',
    owner_field_id: '',
    type_field_id: '',
    type_project_field_id: '',
    start_field_id: '',
    end_field_id: '',
  })

  // 首次：拉团队列表（组织级应用无团队上下文，需用户显式选择）
  useEffect(() => {
    const loadingEl = document.querySelector('.ones-app-loading')
    loadingEl?.remove()
    void (async () => {
      try {
        const teamsResp = await (await ONES.fetchApp('/api/options/teams')).json()
        const list: Option[] = teamsResp?.list ?? []
        setTeams(list)
        // 尝试用 Web SDK 的团队信息做默认值
        try {
          const teamInfo = await ONES.getTeamInfo()
          if (teamInfo.teamUUID && list.some((t) => t.id === teamInfo.teamUUID)) {
            setTeamUUID(teamInfo.teamUUID)
          }
        } catch {
          /* ignore */
        }
      } catch {
        setErrors(['无法获取团队列表'])
      }
    })()
  }, [])

  const load = useCallback(async () => {
    if (!teamUUID) return
    setLoading(true)
    setMessage('')
    setErrors([])
    try {
      const cfgResp = await (await ONES.fetchApp(`/api/config?team_uuid=${teamUUID}`)).json()
      if (cfgResp?.ok && cfgResp.config) setConfig((c: any) => ({ ...c, ...cfgResp.config }))

      const fetchOpt = async (path: string) => {
        try {
          return await (await ONES.fetchApp(`${path}?team_uuid=${teamUUID}`)).json()
        } catch (e: any) {
          return { ok: false, error: `${path} 请求失败: ${e?.message}` }
        }
      }
      const [statusResp, projectsResp, issueTypesResp, issueFieldsResp, projectFieldsResp] = await Promise.all([
        fetchOpt('/api/options/statuses'),
        fetchOpt('/api/options/projects'),
        fetchOpt('/api/options/issue-types'),
        fetchOpt('/api/options/issue-fields'),
        fetchOpt('/api/options/project-fields'),
      ])

      const errs: string[] = []
      if (statusResp?.ok) setStatuses((statusResp.list ?? []).map((s: any) => ({ id: s.id, name: s.name })))
      else errs.push(`状态列表：${statusResp?.error}`)
      if (projectsResp?.ok) setProjects(projectsResp.list ?? [])
      else errs.push(`项目列表：${projectsResp?.error}`)
      if (issueTypesResp?.ok) setIssueTypes(issueTypesResp.list ?? [])
      else errs.push(`工作项类型列表：${issueTypesResp?.error}`)
      if (issueFieldsResp?.ok) setIssueFields(issueFieldsResp.list ?? [])
      else errs.push(`工作项字段列表：${issueFieldsResp?.error}`)
      if (projectFieldsResp?.ok) setProjectFields(projectFieldsResp.list ?? [])
      else errs.push(`项目字段列表：${projectFieldsResp?.error}`)
      setErrors(errs)
    } catch (e: any) {
      setMessage(`加载失败：${e?.message}`)
    } finally {
      setLoading(false)
    }
  }, [teamUUID])

  useEffect(() => {
    if (teamUUID) void load()
  }, [teamUUID, load])

  const save = async () => {
    if (!teamUUID) return
    setSaving(true)
    setMessage('')
    try {
      const resp = await (
        await ONES.fetchApp('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ team_uuid: teamUUID, ...config }),
        })
      ).json()
      if (resp?.ok) setMessage('保存成功')
      else setMessage(`保存失败：${resp?.error}`)
    } catch (e: any) {
      setMessage(`保存失败：${e?.message}`)
    } finally {
      setSaving(false)
    }
  }

  const set = (key: string) => (e: any) => setConfig((c: any) => ({ ...c, [key]: e.target.value }))
  const setOpt = (key: string) => (id: string) => setConfig((c: any) => ({ ...c, [key]: id }))

  const fieldStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 8px',
    boxSizing: 'border-box',
    border: '1px solid #ddd',
    borderRadius: '4px',
  }
  const labelStyle: React.CSSProperties = { display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 13 }
  const groupStyle: React.CSSProperties = { marginBottom: 16 }

  const pickOptions = (fields: any[]) =>
    fields.map((f: any) => {
      const typeLabel = f.typeLabel || f.fieldTypeName || f.fieldType || ''
      return { id: f.id, name: `${f.name}${typeLabel ? ` (${typeLabel})` : ''}`, typeLabel }
    })

  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif', maxWidth: 720, margin: '0 auto', height: '100%', boxSizing: 'border-box', overflowY: 'auto' }}>
      <h2>立项审批配置</h2>
      <p style={{ color: '#666', fontSize: 13 }}>
        审批单流转到「通过状态」时，自动创建项目并把审批单字段映射到新项目。
      </p>

      {errors.length > 0 && (
        <div style={{ background: '#fdecea', border: '1px solid #f5c6cb', borderRadius: 6, padding: '8px 12px', fontSize: 12, marginBottom: 16 }}>
          <strong>部分选项加载失败（通常是缺少 scope 权限或安装凭据未就绪）：</strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {errors.map((e) => (
              <li key={e} style={{ color: '#c0392b' }}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div style={groupStyle}>
        <label style={labelStyle}>团队（先选团队，再配项目/状态/字段）</label>
        <SearchableSelect
          value={teamUUID}
          onChange={(id) => {
            setTeamUUID(id)
            // 切换团队后清空旧的选项和配置，重新加载
            setProjects([])
            setIssueTypes([])
            setStatuses([])
            setIssueFields([])
            setProjectFields([])
          }}
          options={teams}
          placeholder="请选择团队…"
        />
      </div>

      {!teamUUID ? (
        <p style={{ color: '#999' }}>请先在上方选择团队。</p>
      ) : loading ? (
        <p>加载中…</p>
      ) : (
        <>
          <div style={groupStyle}>
            <label style={labelStyle}>审批项目（用于定位审批单）</label>
            <SearchableSelect
              value={config.approval_project_uuid}
              onChange={setOpt('approval_project_uuid')}
              options={projects}
              placeholder="请选择…"
            />
          </div>

          <div style={groupStyle}>
            <label style={labelStyle}>审批单工作项类型（用于定位审批单）</label>
            <SearchableSelect
              value={config.approval_issue_type_id}
              onChange={setOpt('approval_issue_type_id')}
              options={issueTypes}
              placeholder="请选择…"
            />
          </div>

          <div style={groupStyle}>
            <label style={labelStyle}>审批通过状态</label>
            <SearchableSelect
              value={config.approved_status_id}
              onChange={setOpt('approved_status_id')}
              options={statuses}
              placeholder="请选择…"
            />
          </div>

          <div style={groupStyle}>
            <label style={labelStyle}>项目模板</label>
            <select style={fieldStyle} value={config.project_template_id} onChange={set('project_template_id')}>
              <option value="comwater">瀑布项目规划 (comwater)</option>
              <option value="comagile">敏捷项目管理 (comagile)</option>
              <option value="project-t1">敏捷项目管理</option>
              <option value="project-t2">通用任务管理</option>
              <option value="project-t4">瀑布项目规划</option>
              <option value="project-t5">敏捷项目管理_v2</option>
              <option value="project-t6">看板项目模板</option>
            </select>
          </div>

          <div style={groupStyle}>
            <label style={labelStyle}>项目名称 ← 审批单字段（留空用工作项标题）</label>
            <SearchableSelect
              value={config.name_field_id}
              onChange={setOpt('name_field_id')}
              options={pickOptions(issueFields)}
              placeholder="（用工作项标题）"
            />
          </div>

          <div style={groupStyle}>
            <label style={labelStyle}>项目负责人 ← 审批单字段（留空用工作项负责人）</label>
            <SearchableSelect
              value={config.owner_field_id}
              onChange={setOpt('owner_field_id')}
              options={pickOptions(issueFields)}
              placeholder="（用工作项负责人）"
            />
          </div>

          <div style={groupStyle}>
            <label style={labelStyle}>计划开始日期 ← 审批单字段（留空用系统计划开始日期）</label>
            <SearchableSelect
              value={config.start_field_id}
              onChange={setOpt('start_field_id')}
              options={pickOptions(issueFields)}
              placeholder="（用系统计划开始日期）"
            />
          </div>

          <div style={groupStyle}>
            <label style={labelStyle}>计划完成日期 ← 审批单字段（留空用系统计划完成日期）</label>
            <SearchableSelect
              value={config.end_field_id}
              onChange={setOpt('end_field_id')}
              options={pickOptions(issueFields)}
              placeholder="（用系统计划完成日期）"
            />
          </div>

          <div style={{ border: '1px solid #eee', padding: '12px 12px 0', borderRadius: 6, marginBottom: 16 }}>
            <p style={{ color: '#555', fontSize: 12, marginTop: 0 }}>
              「项目类型」：审批单里的单选字段值 → 项目上的自定义属性
            </p>
            <div style={groupStyle}>
              <label style={labelStyle}>项目类型 ← 审批单字段</label>
              <SearchableSelect
                value={config.type_field_id}
                onChange={setOpt('type_field_id')}
                options={pickOptions(issueFields)}
                placeholder="（不映射）"
                filter={(f: any) => {
                  const t = String(f.typeLabel || '').toLowerCase()
                  return t.includes('select') || t.includes('单选') || t.includes('多选') || t.includes('option')
                }}
              />
            </div>
            <div style={groupStyle}>
              <label style={labelStyle}>项目类型 → 目标项目自定义字段</label>
              <SearchableSelect
                value={config.type_project_field_id}
                onChange={setOpt('type_project_field_id')}
                options={pickOptions(projectFields)}
                placeholder="（不映射）"
                filter={(f) => (f.name || '').includes('option') || f.name.includes('单选')}
              />
            </div>
          </div>

          <button
            onClick={save}
            disabled={saving}
            style={{ padding: '8px 20px', background: '#2f6fed', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          >
            {saving ? '保存中…' : '保存配置'}
          </button>
          {message && <p style={{ color: message.includes('成功') ? '#2a7d2a' : '#c0392b', marginTop: 12 }}>{message}</p>}
        </>
      )}
    </div>
  )
}

ReactDOM.render(<App />, document.getElementById('root'))