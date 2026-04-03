const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8787'

async function request(path) {
  const response = await fetch(`${BACKEND_URL}${path}`)
  const data = await response.json()
  if (!response.ok) throw new Error(data?.error || 'Backend error')
  return data
}

export const fleetiService = {
  dashboard: () => request('/api/dashboard'),
  trackers: () => request('/api/trackers'),
  drivers: () => request('/api/drivers'),
  alerts: () => request('/api/alerts'),
  reports: () => request('/api/reports'),
  search: (query) => request(`/api/fleeti/search?q=${encodeURIComponent(query)}`),
  summary: () => request('/api/fleeti/summary'),
  tracker: (id) => request(`/api/fleeti/tracker/${id}`),
  analytics: () => request('/api/fleeti/analytics'),
  todayQuestions: () => request('/api/fleeti/questions/today'),
  ask: (query) => request(`/api/fleeti/ask?q=${encodeURIComponent(query)}`),
  live: () => request('/api/fleeti/live'),
}
