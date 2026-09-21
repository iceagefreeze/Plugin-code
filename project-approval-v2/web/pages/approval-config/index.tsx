import { useEffect, useState, useCallback } from 'react'
import ReactDOM from 'react-dom'
import { ONES } from '@ones-open/web-sdk'

type Option = { id: string; name: string }

const App = () => {
  const [teamUUID, setTeamUUID] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const [statuses, setStatuses] = useState<Option[]>([])
  const [issueFields, setIssueFields] = useState<any[]>([])
  const [projectFields, setProjectFields] = useState<any[]>([])

  const [config, setConfig] = useState<any>({
    approved_status_id: '',
    project_template_id: 'comwater',
    name_field_id: '',
    owner_field_id: '',
    type_field_id: '',
    type_project_field_id: '',
    start_field_id: '',
    end_field_id: '',
  })

  useEffect(() => {
    const loadingEl = document.querySelector('.ones-app-loading')
    loadingEl?.remove()
    void (async () => {
      const teamInfo = await ONES.getTeamInfo()
      setTeamUUID(teamInfo.teamUUID || '')
    })()
  }, [])

  const load = useCallback(async () => {
    if (!teamUUID) return
    setLoading(true)
    setMessage('')
    try {
      const cfgResp = await (await ONES.fetchApp(`/api/config?team_uuid=${teamUUID}`)).json()
      if (cfgResp?.ok && cfgResp.config) setConfig((c: any) => ({ ...c, ...cfgResp.config }))
      const [statusResp, issueFieldsResp, projectFieldsResp] = await Promise.all([
        (await ONES.fetchApp(`/api/options/statuses?team_uuid=${teamUUID}`)).json(),
        (await ONES.fetchApp(`/api/options/issue-fields?team_uuid=${teamUUID}`)).json(),
        (await ONES.fetchApp(`/api/options/project-fields?team_uuid=${teamUUID}`)).json(),
      ])
      setStatuses((statusResp?.list ?? []).map((s: any) => ({ id: s.id, name: s.name })))
      setIssueFields(issueFieldsResp?.list ?? [])
      setProjectFields(projectFieldsResp?.list ?? [])
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
    fields.map((f: any) => ({ id: f.id, name: `${f.name}${f.typeLabel ? ` (${f.typeLabel})` : ''}` }))

  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif', maxWidth: 720 }}>
      <h2>立项审批配置</h2>
      <p style={{ color: '#666', fontSize: 13 }}>
        审批单流转到「通过状态」时，自动创建项目并把审批单字段映射到新项目。
      </p>

      {loading ? (
        <p>加载中…</p>
      ) : (
        <>
          <div style={groupStyle}>
            <label style={labelStyle}>审批通过状态</label>
            <select style={fieldStyle} value={config.approved_status_id} onChange={set('approved_status_id')}>
              <option value="">请选择…</option>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
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
            <select style={fieldStyle} value={config.name_field_id} onChange={set('name_field_id')}>
              <option value="">（用工作项标题）</option>
              {pickOptions(issueFields).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>

          <div style={groupStyle}>
            <label style={labelStyle}>项目负责人 ← 审批单字段（留空用工作项负责人）</label>
            <select style={fieldStyle} value={config.owner_field_id} onChange={set('owner_field_id')}>
              <option value="">（用工作项负责人）</option>
              {pickOptions(issueFields).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>

          <div style={groupStyle}>
            <label style={labelStyle}>计划开始日期 ← 审批单字段（留空用系统计划开始日期）</label>
            <select style={fieldStyle} value={config.start_field_id} onChange={set('start_field_id')}>
              <option value="">（用系统计划开始日期）</option>
              {pickOptions(issueFields).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>

          <div style={groupStyle}>
            <label style={labelStyle}>计划完成日期 ← 审批单字段（留空用系统计划完成日期）</label>
            <select style={fieldStyle} value={config.end_field_id} onChange={set('end_field_id')}>
              <option value="">（用系统计划完成日期）</option>
              {pickOptions(issueFields).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ border: '1px solid #eee', padding: '12px 12px 0', borderRadius: 6, marginBottom: 16 }}>
            <p style={{ color: '#555', fontSize: 12, marginTop: 0 }}>
              「项目类型」：审批单里的单选字段值 → 项目上的自定义属性
            </p>
            <div style={groupStyle}>
              <label style={labelStyle}>项目类型 ← 审批单字段</label>
              <select style={fieldStyle} value={config.type_field_id} onChange={set('type_field_id')}>
                <option value="">（不映射）</option>
                {issueFields
                  .filter((f: any) => (f.typeLabel || '').includes('select') || f.options)
                  .map((f: any) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
              </select>
            </div>
            <div style={groupStyle}>
              <label style={labelStyle}>项目类型 → 目标项目自定义字段</label>
              <select style={fieldStyle} value={config.type_project_field_id} onChange={set('type_project_field_id')}>
                <option value="">（不映射）</option>
                {projectFields
                  .filter((f: any) => !f.builtIn && (f.typeLabel || '').includes('option'))
                  .map((f: any) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
              </select>
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