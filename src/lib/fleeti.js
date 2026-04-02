const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8787'

export async function loadFleetData() {
  const response = await fetch(`${BACKEND_URL}/api/dashboard`)
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data?.error || 'Backend error')
  }
  return data
}
