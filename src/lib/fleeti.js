import { employeeFallback, trackerMileageFallback } from '../data/mock'

const API_BASE = import.meta.env.VITE_FLEETI_API_BASE || 'https://tracking.ci.fleeti.co/api-v2'
const LOGIN = import.meta.env.VITE_FLEETI_LOGIN || 'boubsfal@gmail.com'
const PASSWORD = import.meta.env.VITE_FLEETI_PASSWORD || 'Azerty123456#'
const DEALER_ID = Number(import.meta.env.VITE_FLEETI_DEALER_ID || 23241)
const LOCALE = import.meta.env.VITE_FLEETI_LOCALE || 'fr'
const TRACKER_IDS = [3487533, 3487539, 3488325, 3488326, 3511635, 3537761, 3537762, 3537766]

async function apiCall(endpoint, payload = {}) {
  const response = await fetch(`${API_BASE}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'NVX-ISO-DateTime': 'true' },
    body: JSON.stringify(payload),
  })
  const data = await response.json()
  if (!response.ok || data.success === false) throw new Error(data?.status?.description || 'API error')
  return data
}

export async function loadFleetData() {
  const auth = await apiCall('user/auth', {
    login: LOGIN,
    password: PASSWORD,
    dealer_id: DEALER_ID,
    locale: LOCALE,
  })

  const hash = auth.hash
  const [trackers, states, employees, unreadCount, rules, tariffs, history, mileage] = await Promise.all([
    apiCall('tracker/list', { hash }),
    apiCall('tracker/get_states', { hash, trackers: TRACKER_IDS }),
    apiCall('employee/list', { hash }).catch(() => ({ list: employeeFallback })),
    apiCall('history/unread/count', { hash }).catch(() => ({ value: 0 })),
    apiCall('tracker/rule/list', { hash }).catch(() => ({ list: [] })),
    apiCall('tariff/list', { hash }).catch(() => ({ list: [] })),
    apiCall('history/tracker/list', { hash, trackers: TRACKER_IDS, from: '2026-04-01 00:00:00', to: '2026-04-02 23:59:59', limit: 200 }).catch(() => ({ list: [] })),
    apiCall('tracker/stats/mileage/read', { hash, trackers: TRACKER_IDS, from: '2026-04-01 00:00:00', to: '2026-04-02 23:59:59' }).catch(() => ({ result: trackerMileageFallback })),
  ])

  return {
    hash,
    trackers: trackers.list ?? [],
    states: states.states ?? {},
    employees: employees.list ?? employeeFallback,
    unreadCount: unreadCount.value ?? unreadCount.count ?? 0,
    rules: rules.list ?? [],
    tariffs: tariffs.list ?? [],
    history: history.list ?? [],
    mileage: mileage.result ?? trackerMileageFallback,
  }
}
