export type Announcement = {
  id: string; project_uuid: string; title: string; content_html: string; status: 'draft'|'published'|'withdrawn';
  creator_uuid: string; creator_name: string; audience_type: 'all'|'selected'; is_pinned: boolean; is_read: boolean;
  created_at: number; published_at: number; updated_at: number; attachments: {name:string;url:string}[]; audience?: User[]
}
export type User = { uuid: string; name: string; email?: string }

export function getTeamUUID(): string {
  const w: any = window
  const env = w.__ONES_MF_ENV__
  return String(env?.request?.headers?.['Ones-Check-Id'] || env?.request?.headers?.['ones-check-id'] || env?.teamUUID || (location.pathname.match(/\/plugin\/[^/]+\/([^/]+)/) || [])[1] || (location.hash.match(/\/team\/([A-Za-z0-9]+)/) || [])[1] || '')
}
export function getProjectUUID(): string {
  const sources: string[] = []
  try { sources.push(window.parent.location.pathname + window.parent.location.hash + window.parent.location.search) } catch {}
  sources.push(location.pathname + location.hash + location.search, document.referrer)
  for (const source of sources) {
    const path = source.match(/\/project\/([A-Za-z0-9]+)/); if (path) return path[1]
    const query = source.match(/[?&]project(?:UUID|_uuid)=([^&#]+)/); if (query) return decodeURIComponent(query[1])
  }
  return ''
}
export async function currentUser(): Promise<User> {
  const res = await fetch('/project/api/project/users/me', { credentials: 'include' })
  if (!res.ok) throw new Error('无法获取当前用户')
  const j = await res.json(); const u = j?.user || j?.data || j
  return { uuid: u.uuid || u.user_uuid || '', name: u.name || u.username || '', email: u.email || '' }
}
export async function teamMembers(team: string): Promise<User[]> {
  const res = await fetch(`/project/api/project/team/${team}/members?limit=200`, { credentials: 'include' })
  if (!res.ok) throw new Error('无法获取团队成员')
  const j = await res.json(); const rows = j.members || j.data || j
  return (Array.isArray(rows) ? rows : []).map((u:any) => ({ uuid: u.uuid || '', name: u.name || u.email || u.uuid, email: u.email || '' }))
}
export async function api<T=any>(path: string, body: any = {}): Promise<T> {
  const team = getTeamUUID(); if (!team) throw new Error('无法识别团队上下文')
  const res = await fetch(`/project/api/project/team/${team}${path}`, { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ ...body, team_uuid: team }) })
  let j:any = {}; try { j = await res.json() } catch {}
  const payload = j?.body || j?.data || j
  if (!res.ok || !payload?.ok) throw new Error(payload?.error?.message || `请求失败 (${res.status})`)
  return payload.data as T
}
