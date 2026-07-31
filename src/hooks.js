import { useCallback, useEffect, useRef, useState } from 'react'

export function useAutoRefresh(callback, delay = 60000) {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    if (!callback) return undefined
    let cancelled = false
    let inFlight = false
    let timerId = null

    const schedule = () => {
      if (!cancelled) timerId = window.setTimeout(run, delay)
    }

    async function run() {
      if (timerId) window.clearTimeout(timerId)
      timerId = null
      if (cancelled || inFlight || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) {
        schedule()
        return
      }
      inFlight = true
      try {
        await callbackRef.current?.()
      } finally {
        inFlight = false
        schedule()
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') void run()
    }
    schedule()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      cancelled = true
      if (timerId) window.clearTimeout(timerId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [callback, delay])
}

export function useAsyncLoader(loader) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const run = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setData(await loader())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [loader])

  useEffect(() => { void run() }, [run])
  return { data, loading, error, run }
}
