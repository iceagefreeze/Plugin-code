import { useEffect, useState, useCallback } from 'react'
import ReactDOM from 'react-dom'
import { ONES } from '@ones-open/web-sdk'

type ApprovalRecordRow = {
  issue_uuid: string
  status: string
  project_uuid: string
  project_name: string
  error_message?: string
  updated_at: number
}

const statusText: Record<string, string> = {
  pending: '待创建',
  creating: '创建中',
  created: '已创建',
  failed: '失败',
}

const App = () => {
  const [teamUUID, setTeamUUID] = useState('')
  const [records, setRecords] = useState<ApprovalRecordRow[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    if (!teamUUID) return
    setLoading(true)
    try {
      const resp = await (await ONES.fetchApp(`/api/records?team_uuid=${teamUUID}`)).json()
      if (resp?.ok) setRecords(resp.records ?? [])
      else setMessage(resp?.error)
    } catch (e: any) {
      setMessage(`加载失败：${e?.message}`)
    } finally {
      setLoading(false)
    }
  }, [teamUUID])

  useEffect(() => {
    const loadingEl = document.querySelector('.ones-app-loading')
    loadingEl?.remove()
    void (async () => {
      const teamInfo = await ONES.getTeamInfo()
      setTeamUUID(teamInfo.teamUUID || '')
    })()
  }, [])

  useEffect(() => {
    if (teamUUID) void load()
  }, [teamUUID, load])

  const open = (projectUUID: string) => {
    if (projectUUID) window.open(`/project/#/home/project/view/${projectUUID}`, '_blank')
  }

  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif', maxWidth: 860 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>创建记录</h2>
        <button
          onClick={load}
          disabled={loading}
          style={{ padding: '5px 14px', background: '#f0f0f0', border: '1px solid #ddd', borderRadius: 4, cursor: 'pointer' }}
        >
          刷新
        </button>
      </div>

      {loading ? (
        <p>加载中…</p>
      ) : records.length === 0 ? (
        <p style={{ color: '#888' }}>暂无记录。审批单流转到「通过状态」后会自动创建项目并记录在这里。</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {['审批单', '项目名称', '状态', '操作', '更新时间'].map((h) => (
                <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #eee', padding: '8px 6px' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.issue_uuid} style={{ borderBottom: '1px solid #f5f5f5' }}>
                <td style={{ padding: '8px 6px', fontFamily: 'monospace' }}>{r.issue_uuid}</td>
                <td style={{ padding: '8px 6px' }}>{r.project_name || '-'}</td>
                <td style={{ padding: '8px 6px' }}>
                  <span
                    style={{
                      color: r.status === 'failed' ? '#c0392b' : r.status === 'created' ? '#2a7d2a' : '#b8860b',
                      fontWeight: 600,
                    }}
                  >
                    {statusText[r.status] ?? r.status}
                  </span>
                  {r.error_message && (
                    <div style={{ color: '#c0392b', fontSize: 12, marginTop: 4 }}>{r.error_message}</div>
                  )}
                </td>
                <td style={{ padding: '8px 6px' }}>
                  {r.project_uuid && (
                    <a href="#" onClick={() => open(r.project_uuid)} style={{ color: '#2f6fed' }}>
                      打开项目
                    </a>
                  )}
                </td>
                <td style={{ padding: '8px 6px', color: '#888' }}>{new Date(r.updated_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {message && <p style={{ color: '#c0392b' }}>{message}</p>}
    </div>
  )
}

ReactDOM.render(<App />, document.getElementById('root'))