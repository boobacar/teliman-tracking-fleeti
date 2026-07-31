import { useEffect, useState } from 'react'
import { loadProtectedMediaObjectUrl } from '../lib/fleeti.js'

export function ProtectedImage({ source, alt, ...props }) {
  const [resolvedSource, setResolvedSource] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let objectUrl = ''
    setResolvedSource('')
    setFailed(false)

    loadProtectedMediaObjectUrl(source)
      .then((url) => {
        if (cancelled) {
          if (url.startsWith('blob:')) URL.revokeObjectURL(url)
          return
        }
        objectUrl = url.startsWith('blob:') ? url : ''
        setResolvedSource(url)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [source])

  if (failed) return <span role="status">Image protégée indisponible</span>
  if (!resolvedSource) return <span role="status">Chargement de l’image…</span>
  return <img src={resolvedSource} alt={alt} {...props} />
}
