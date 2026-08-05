import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Circle, CircleMarker, MapContainer, Marker, Popup, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { Crosshair, ExternalLink, Eye, EyeOff, LocateFixed, Maximize2, Minimize2, Navigation, Pause, Play, Search, SkipBack, SkipForward, X } from 'lucide-react'
import { loadGeofences, loadLivePositions, loadTracksBatch } from '../lib/fleeti'
import {
  buildDirectionArrows,
  clusterTrackers,
  detectStops,
  formatDurationMs,
  formatPositionAge,
  haversineDistanceMeters,
  parsePointTime,
} from '../lib/mapUtils'

const LIVE_POLL_DELAY_MS = 3000
const LIVE_STALE_AFTER_MS = 15000
const TRACK_CACHE_TTL_MS = 5 * 60 * 1000
const CLUSTER_THRESHOLD = 25

function getPinState(tracker) {
  const connection = tracker.state?.connection_status
  const movement = tracker.state?.movement_status

  if (connection === 'offline') return { color: '#ef4444', label: 'O', text: 'Offline' }
  if (movement === 'parked' || movement === 'parking') return { color: '#f59e0b', label: 'P', text: 'Parking' }
  if (connection === 'active' && movement === 'moving') return { color: '#22c55e', label: 'M', text: 'Moving' }
  if (connection === 'idle') return { color: '#f59e0b', label: 'I', text: 'Idle' }
  return { color: '#64748b', label: '?', text: 'Unknown' }
}

function getAlertColor(eventType) {
  if (eventType === 'speedup') return '#ef4444'
  if (eventType === 'excessive_parking') return '#f59e0b'
  if (eventType === 'fuel_level_leap') return '#38bdf8'
  return '#94a3b8'
}

function getAlertPriority(eventType) {
  if (eventType === 'speedup') return 'Critique'
  if (eventType === 'fuel_level_leap') return 'Surveillance'
  if (eventType === 'excessive_parking') return 'Exploitation'
  return 'Info'
}

function computeBearing(from, to) {
  if (!from || !to) return null
  const lat1 = from.lat * Math.PI / 180
  const lon1 = from.lng * Math.PI / 180
  const lat2 = to.lat * Math.PI / 180
  const lon2 = to.lng * Math.PI / 180
  const y = Math.sin(lon2 - lon1) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)
  const bearing = Math.atan2(y, x) * 180 / Math.PI
  return (bearing + 360) % 360
}

function createTrackerIcon(tracker, hasMission = false, isActive = false, bearing = null) {
  const state = getPinState(tracker)
  const heading = Number.isFinite(bearing) ? bearing : Number(tracker.state?.gps?.heading ?? tracker.state?.heading ?? 0)
  const speed = Number(tracker.state?.gps?.speed ?? 0)
  const isMoving = tracker.state?.movement_status === 'moving' || speed > 0
  const movingArrow = isMoving
    ? `<div class="pin-heading-tail ${isActive ? 'active' : ''}" style="transform: rotate(${heading}deg)"></div>`
    : ''

  return L.divIcon({
    className: 'custom-tracker-pin-wrapper',
    html: `<div class="custom-tracker-pin-shell ${isActive ? 'active' : ''}">${movingArrow}<div class="custom-tracker-pin" style="background:${state.color}">${state.label}</div>${hasMission ? '<span class="mission-dot"></span>' : ''}</div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -12],
  })
}

function createClusterIcon(count) {
  return L.divIcon({
    className: 'tracker-cluster-icon-wrap',
    html: `<div class="tracker-cluster-icon"><strong>${count}</strong><span>camions</span></div>`,
    iconSize: [54, 54],
    iconAnchor: [27, 27],
  })
}

function createDirectionArrowIcon(bearing) {
  return L.divIcon({
    className: 'track-direction-arrow-wrap',
    html: `<div class="track-direction-arrow" style="transform: rotate(${bearing}deg)">➤</div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  })
}

function createPlaybackIcon() {
  return L.divIcon({
    className: 'track-playback-wrap',
    html: '<div class="track-playback-dot"></div>',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })
}

function FleetBounds({ trackers, fitKey }) {
  const map = useMap()
  const trackersRef = useRef(trackers)

  useEffect(() => {
    trackersRef.current = trackers
  }, [trackers])

  useEffect(() => {
    const boundsPoints = trackersRef.current
      .map((tracker) => tracker?.state?.gps?.location)
      .filter((location) => Number.isFinite(location?.lat) && Number.isFinite(location?.lng))
      .map((location) => [location.lat, location.lng])

    if (boundsPoints.length === 0) return
    if (boundsPoints.length === 1) {
      map.setView(boundsPoints[0], Math.max(map.getZoom(), 12), { animate: false })
      return
    }
    map.fitBounds(boundsPoints, { padding: [50, 50], animate: false })
  }, [map, fitKey])

  return null
}

function MapInteractionGuard() {
  const map = useMap()

  useEffect(() => {
    const container = map.getContainer()
    let unlockTimer = null
    const lockMarkerAnimation = () => {
      if (unlockTimer) window.clearTimeout(unlockTimer)
      container.classList.add('leaflet-transform-lock')
    }
    const unlockMarkerAnimation = () => {
      if (unlockTimer) window.clearTimeout(unlockTimer)
      unlockTimer = window.setTimeout(() => container.classList.remove('leaflet-transform-lock'), 120)
    }

    map.on('zoomstart movestart', lockMarkerAnimation)
    map.on('zoomend moveend', unlockMarkerAnimation)

    return () => {
      if (unlockTimer) window.clearTimeout(unlockTimer)
      map.off('zoomstart movestart', lockMarkerAnimation)
      map.off('zoomend moveend', unlockMarkerAnimation)
      container.classList.remove('leaflet-transform-lock')
    }
  }, [map])

  return null
}

// Recentrage ponctuel vers un point (bouton « Recentrer » du poste de contrôle).
function FlyToTarget({ position, requestKey }) {
  const map = useMap()
  useEffect(() => {
    if (!position || !requestKey) return
    map.flyTo(position, Math.max(map.getZoom(), 12), { duration: 0.8 })
  }, [map, requestKey]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

// Suivi automatique : la carte suit le camion tant que l'utilisateur n'interagit pas.
function FollowController({ position, following, onUserInterrupt }) {
  const map = useMap()
  const lastRef = useRef(null)

  useEffect(() => {
    if (!following || !position) return
    const [lat, lng] = position
    const previous = lastRef.current
    if (!previous || Math.abs(previous[0] - lat) > 0.00005 || Math.abs(previous[1] - lng) > 0.00005) {
      map.setView([lat, lng], Math.max(map.getZoom(), 12), { animate: true })
      lastRef.current = [lat, lng]
    }
  }, [position, following, map])

  useEffect(() => {
    if (!following) return
    const stop = () => onUserInterrupt()
    map.on('dragstart zoomstart', stop)
    return () => {
      map.off('dragstart zoomstart', stop)
    }
  }, [following, map, onUserInterrupt])

  return null
}

function ZoomProbe({ onZoom }) {
  const map = useMap()
  useEffect(() => {
    onZoom(map.getZoom())
    const handle = () => onZoom(map.getZoom())
    map.on('zoomend', handle)
    return () => { map.off('zoomend', handle) }
  }, [map, onZoom])
  return null
}

function ClusterZoomer({ cluster }) {
  const map = useMap()
  return (
    <Marker
      position={[cluster.lat, cluster.lng]}
      icon={createClusterIcon(cluster.count)}
      eventHandlers={{ click: () => map.setView([cluster.lat, cluster.lng], map.getZoom() + 2) }}
    >
      <Tooltip direction="top" offset={[0, -16]} opacity={1}>{cluster.count} camions — zoomer pour afficher</Tooltip>
    </Marker>
  )
}

function formatPlaybackTime(point) {
  const time = parsePointTime(point)
  if (!time) return ''
  return new Date(time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

export function MapPage({ filteredTrackers, deliveryOrders = [] }) {
  const [mapFilter, setMapFilter] = useState('all')
  const [selectedTrackIds, setSelectedTrackIds] = useState([])
  const [focusTrackId, setFocusTrackId] = useState(null)
  const [followOn, setFollowOn] = useState(false)
  const [period, setPeriod] = useState('48h')
  const [baseMap, setBaseMap] = useState('hybrid')
  const [tileKey, setTileKey] = useState(0)
  const [trackMap, setTrackMap] = useState({})
  const [prefetchReady, setPrefetchReady] = useState(false)
  const [trackError, setTrackError] = useState('')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [trackerSearch, setTrackerSearch] = useState('')
  const [fitRequest, setFitRequest] = useState(0)
  const [recenterRequest, setRecenterRequest] = useState(0)
  const [tileLoadState, setTileLoadState] = useState('loading')
  const [mapZoom, setMapZoom] = useState(7)
  const [ageNow, setAgeNow] = useState(Date.now())
  const [playback, setPlayback] = useState(null) // { trackerId, index }
  const trackCacheRef = useRef(new Map())
  const inflightCacheRef = useRef(new Map())
  const mapShellRef = useRef(null)

  // ── Géofences (zones affichées sur la carte) ──
  const [geofences, setGeofences] = useState([])
  const [geofenceError, setGeofenceError] = useState('')

  useEffect(() => {
    let cancelled = false
    loadGeofences()
      .then((payload) => {
        if (!cancelled) setGeofences(payload.geofences || [])
      })
      .catch((err) => {
        if (!cancelled) setGeofenceError(err?.message || 'Zones indisponibles')
      })
    return () => { cancelled = true }
  }, [])

  // ── Positions live (polling récursif sans chevauchement) ──
  const [livePositions, setLivePositions] = useState({})
  const [liveUpdatedAt, setLiveUpdatedAt] = useState(null)
  const [liveError, setLiveError] = useState('')

  useEffect(() => {
    let cancelled = false
    let timerId = null
    let inFlight = false

    async function poll() {
      if (timerId) window.clearTimeout(timerId)
      timerId = null
      if (cancelled || inFlight) return
      if (document.hidden) {
        timerId = window.setTimeout(poll, LIVE_POLL_DELAY_MS)
        return
      }
      inFlight = true
      try {
        const data = await loadLivePositions()
        if (cancelled) return
        const map = {}
        for (const pos of data.positions || []) {
          map[String(pos.trackerId)] = pos
        }
        setLivePositions(map)
        setLiveUpdatedAt(Date.now())
        setLiveError('')
      } catch (error) {
        if (!cancelled) setLiveError(error?.message || 'Impossible d’actualiser les positions.')
      } finally {
        inFlight = false
        if (!cancelled) timerId = window.setTimeout(poll, LIVE_POLL_DELAY_MS)
      }
    }

    void poll()
    const handleVisibility = () => { if (!document.hidden) void poll() }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      cancelled = true
      if (timerId) window.clearTimeout(timerId)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  // Horloge d'affichage de l'âge de position (tick 1 s, seulement poste ouvert)
  useEffect(() => {
    if (!focusTrackId) return
    const timer = window.setInterval(() => setAgeNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [focusTrackId])

  // Fusionne les positions live avec les trackers enrichis
  const trackersWithLivePos = useMemo(() => {
    return filteredTrackers.map((tracker) => {
      const live = livePositions[String(tracker.id)]
      if (!live || !Number.isFinite(live.lat) || !Number.isFinite(live.lng)) return tracker
      return {
        ...tracker,
        liveGeofenceNames: Array.isArray(live.geofenceNames) ? live.geofenceNames : [],
        liveLastUpdate: live.last_update || null,
        state: {
          ...tracker.state,
          gps: {
            ...tracker.state?.gps,
            location: { lat: live.lat, lng: live.lng },
            speed: live.speed ?? tracker.state?.gps?.speed ?? 0,
            heading: live.heading ?? tracker.state?.gps?.heading ?? 0,
          },
          connection_status: live.connection_status || tracker.state?.connection_status || 'unknown',
          movement_status: live.movement_status || tracker.state?.movement_status || 'unknown',
        },
      }
    })
  }, [filteredTrackers, livePositions])

  const allVisibleTrackers = useMemo(() => trackersWithLivePos.filter((tracker) => {
    if (!tracker.state?.gps?.location) return false
    if (mapFilter === 'moving') return (tracker.state?.gps?.speed ?? 0) > 0
    if (mapFilter === 'offline') return tracker.state?.connection_status === 'offline'
    if (mapFilter === 'risk') return (tracker.eventCounts?.speedup || 0) + (tracker.eventCounts?.excessive_parking || 0) > 0
    return true
  }), [trackersWithLivePos, mapFilter])

  const visibleIdSet = useMemo(() => new Set(allVisibleTrackers.map((t) => String(t.id))), [allVisibleTrackers])
  useEffect(() => {
    setSelectedTrackIds((prev) => {
      if (prev.length === 0) return prev
      const filtered = prev.filter((id) => visibleIdSet.has(id))
      return filtered.length === prev.length ? prev : filtered
    })
  }, [visibleIdSet])

  // Focus : dernier camion cliqué ; nettoyé s'il disparaît de la sélection
  useEffect(() => {
    if (focusTrackId && !selectedTrackIds.includes(focusTrackId)) setFocusTrackId(null)
  }, [selectedTrackIds, focusTrackId])

  const selectedTrackers = useMemo(
    () => allVisibleTrackers.filter((tracker) => selectedTrackIds.includes(String(tracker.id))),
    [allVisibleTrackers, selectedTrackIds],
  )

  // Recherche étendue : camion, chauffeur, BL (référence) et client
  const activeOrderByTrackerId = useMemo(() => {
    const map = {}
    for (const order of deliveryOrders || []) {
      if (order.active) map[String(order.trackerId)] = order
    }
    return map
  }, [deliveryOrders])

  const selectableTrackers = useMemo(() => {
    const query = trackerSearch.trim().toLocaleLowerCase('fr-FR')
    if (!query) return allVisibleTrackers
    return allVisibleTrackers.filter((tracker) => {
      const haystack = [
        tracker.label || '',
        tracker.employeeName || '',
        activeOrderByTrackerId[String(tracker.id)]?.reference || '',
        activeOrderByTrackerId[String(tracker.id)]?.client || '',
      ].join(' ').toLocaleLowerCase('fr-FR')
      return haystack.includes(query)
    })
  }, [allVisibleTrackers, trackerSearch, activeOrderByTrackerId])

  const displayedTrackers = selectedTrackIds.length > 0 ? selectedTrackers : allVisibleTrackers
  const mapFitKey = `${mapFilter}|${selectedTrackIds.join(',')}|${fitRequest}`

  const center = displayedTrackers[0]?.state?.gps?.location
    ? [displayedTrackers[0].state.gps.location.lat, displayedTrackers[0].state.gps.location.lng]
    : [7.54, -5.55]

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === mapShellRef.current)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  async function toggleFullscreen() {
    if (!mapShellRef.current) return
    if (document.fullscreenElement === mapShellRef.current) {
      await document.exitFullscreen().catch(() => {})
      return
    }
    await mapShellRef.current.requestFullscreen?.().catch(() => {})
  }

  function fetchTracksForSelection(trackerIds, periodValue) {
    const key = `${trackerIds.sort().join(',')}_${periodValue}`
    const cached = trackCacheRef.current.get(key)
    if (cached && Date.now() - cached.cachedAt < TRACK_CACHE_TTL_MS) return Promise.resolve(cached.data)
    if (cached) trackCacheRef.current.delete(key)
    if (inflightCacheRef.current.has(key)) return inflightCacheRef.current.get(key)
    const request = loadTracksBatch({ trackerIds, period: periodValue })
      .then((payload) => {
        const next = Object.fromEntries((payload.items || []).map((item) => [String(item.trackerId), item]))
        trackCacheRef.current.set(key, { data: next, cachedAt: Date.now() })
        inflightCacheRef.current.delete(key)
        return next
      })
      .catch((error) => {
        inflightCacheRef.current.delete(key)
        throw error
      })
    inflightCacheRef.current.set(key, request)
    return request
  }

  useEffect(() => {
    let cancelled = false

    async function warmup() {
      if (selectedTrackIds.length === 0) {
        setTrackMap({})
        setTrackError('')
        setPrefetchReady(true)
        return
      }
      try {
        const data = await fetchTracksForSelection([...selectedTrackIds], period)
        if (!cancelled) {
          setTrackMap(data)
          setTrackError('')
          setPrefetchReady(true)
        }
      } catch (error) {
        if (!cancelled) {
          setTrackError(error?.message || 'Impossible de charger les tracés.')
          setPrefetchReady(true)
        }
      }
    }

    setPrefetchReady(false)
    warmup()
    return () => { cancelled = true }
  }, [selectedTrackIds, period])

  function toggleTrackerSelection(trackerId) {
    const key = String(trackerId)
    setSelectedTrackIds((prev) => prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key])
    setFocusTrackId(key)
  }

  function closeControlPanel() {
    setFocusTrackId(null)
    setFollowOn(false)
    setPlayback(null)
  }

  const selectedTrackData = selectedTrackIds.length > 0 ? selectedTrackIds.map((id) => trackMap[id]).filter(Boolean) : []
  const allSegments = selectedTrackData.flatMap((item) => item?.segments || [])
  const allEvents = selectedTrackData.flatMap((item) => item?.events || [])
  const totalDistanceKm = allSegments.reduce((sum, segment) => sum + (Number(segment.length) || 0), 0)
  const maxSpeed = allSegments.reduce((max, segment) => Math.max(max, Number(segment.max_speed) || 0), 0)
  const avgSpeed = allSegments.length ? Math.round(allSegments.reduce((sum, segment) => sum + (Number(segment.avg_speed) || 0), 0) / allSegments.length) : 0
  const tripCount = allSegments.length
  const alertMarkers = allEvents.map((event) => ({
    ...event,
    lat: event.lat ?? event.location?.lat ?? null,
    lng: event.lng ?? event.location?.lng ?? null,
  })).filter((event) => Number.isFinite(event.lat) && Number.isFinite(event.lng))
  const dominantAlert = alertMarkers[0]?.event || 'Aucune'
  const criticalAlerts = alertMarkers.filter((event) => getAlertPriority(event.event) === 'Critique').length
  const liveIsStale = !liveUpdatedAt || Date.now() - liveUpdatedAt > LIVE_STALE_AFTER_MS
  const tileEventHandlers = useMemo(() => ({
    loading: () => setTileLoadState('loading'),
    load: () => setTileLoadState('ready'),
    tileerror: () => setTileLoadState('error'),
  }), [])

  // Poste de contrôle : camion focalisé + zone client la plus proche (ETA)
  const focusedTracker = focusTrackId ? allVisibleTrackers.find((tracker) => String(tracker.id) === focusTrackId) : null
  const focusedLive = focusTrackId ? livePositions[focusTrackId] : null
  const focusedOrder = focusTrackId ? activeOrderByTrackerId[focusTrackId] : null

  const nearestClientZone = useMemo(() => {
    if (!focusedTracker?.state?.gps?.location) return null
    const position = focusedTracker.state.gps.location
    const zones = geofences.filter((zone) => zone.active)
    if (zones.length === 0) return null
    const withDistance = zones.map((zone) => ({
      ...zone,
      distanceMeters: haversineDistanceMeters(position.lat, position.lng, zone.lat, zone.lng),
    }))
    withDistance.sort((a, b) => {
      if ((a.type === 'client') !== (b.type === 'client')) return a.type === 'client' ? -1 : 1
      return a.distanceMeters - b.distanceMeters
    })
    return withDistance[0]
  }, [focusedTracker, geofences])

  const focusedEta = useMemo(() => {
    if (!nearestClientZone || !focusedTracker) return null
    const speedKmh = Math.max(Number(focusedTracker.state?.gps?.speed) || 0, 30)
    const distanceKm = nearestClientZone.distanceMeters / 1000
    const minutes = Math.round((distanceKm / speedKmh) * 60)
    return { distanceKm, minutes }
  }, [nearestClientZone, focusedTracker])

  // Temps d'arrêt du camion focalisé (depuis le tracé)
  const focusedStops = useMemo(() => {
    if (!focusTrackId) return []
    const points = trackMap[focusTrackId]?.points || []
    return detectStops(points)
  }, [focusTrackId, trackMap])

  // Lecture animée du trajet
  const focusedTrackPoints = focusTrackId ? (trackMap[focusTrackId]?.points || []) : []
  const playbackIndex = playback && playback.trackerId === focusTrackId ? playback.index : null

  useEffect(() => {
    if (!playback || playback.trackerId !== focusTrackId) return
    if (!playback.playing) return
    const points = focusedTrackPoints
    const timer = window.setInterval(() => {
      setPlayback((prev) => {
        if (!prev) return prev
        const next = prev.index + 1
        if (next >= points.length) return { ...prev, index: points.length - 1, playing: false }
        return { ...prev, index: next }
      })
    }, 500)
    return () => window.clearInterval(timer)
  }, [playback, focusTrackId, focusedTrackPoints])

  const bearingByTrackerId = new Map()
  displayedTrackers.forEach((tracker) => {
    const trackerPoints = trackMap[String(tracker.id)]?.points || []
    if (trackerPoints.length >= 2) {
      const previous = trackerPoints[trackerPoints.length - 2]
      const current = trackerPoints[trackerPoints.length - 1]
      const bearing = computeBearing({ lat: previous.lat, lng: previous.lng }, { lat: current.lat, lng: current.lng })
      bearingByTrackerId.set(String(tracker.id), bearing)
    }
  })

  const { clusters, singles } = clusterTrackers(displayedTrackers, mapZoom, CLUSTER_THRESHOLD)
  const hasClusterView = clusters.length > 0

  return (
    <section className="panel panel-large map-panel">
      <div className="panel-header"><div><h1>Carte temps réel</h1><p role="status">{liveIsStale ? 'Données anciennes' : 'Données à jour'}{liveUpdatedAt ? ` · actualisées à ${new Date(liveUpdatedAt).toLocaleTimeString('fr-FR')}` : ''}</p></div></div>
      {liveError && <div className="error-banner" role="alert">Positions : {liveError}</div>}
      {geofenceError && <div className="error-banner" role="alert">Zones : {geofenceError}</div>}
      <details className="map-insights-panel">
        <summary>Analyse de la sélection <span>{selectedTrackIds.length > 0 ? `${selectedTrackIds.length} camion(s)` : 'vue flotte'}</span></summary>
        <div className="map-kpi-row">
          <div className="mini-kpi"><span>Visible</span><strong>{displayedTrackers.length}</strong></div>
          <div className="mini-kpi"><span>Sélectionnés</span><strong>{selectedTrackIds.length}</strong></div>
          <div className="mini-kpi"><span>Alertes tracé</span><strong>{alertMarkers.length}</strong></div>
          <div className="mini-kpi"><span>Distance tracée</span><strong>{totalDistanceKm.toFixed(1)} km</strong></div>
          <div className="mini-kpi"><span>Vitesse max</span><strong>{Math.round(maxSpeed)} km/h</strong></div>
          <div className="mini-kpi"><span>Vitesse moy.</span><strong>{avgSpeed} km/h</strong></div>
        </div>

        {selectedTrackIds.length > 0 && <div className="map-focus-banner"><div><strong>{selectedTrackIds.length} camion(s)</strong><span>suivi multi-sélection</span></div><div><strong>{Math.max((totalDistanceKm / 45), 0).toFixed(1)} h</strong><span>Heures de conduite</span></div><div><strong>{criticalAlerts}</strong><span>alertes critiques</span></div></div>}

        <div className="map-v3-summary"><div className="map-v3-card"><strong>{tripCount}</strong><span>déplacements détectés</span></div><div className="map-v3-card"><strong>{dominantAlert}</strong><span>alerte dominante</span></div><div className="map-v3-card"><strong>{displayedTrackers.length}</strong><span>camions affichés</span></div></div>
      </details>

      {!prefetchReady && selectedTrackIds.length > 0 && <div className="empty-banner">Préchargement rapide des tracés en cours…</div>}
      {trackError && selectedTrackIds.length > 0 && <div className="error-banner" role="alert">Impossible de charger les tracés : {trackError} <button type="button" className="ghost-btn small-btn" onClick={() => { trackCacheRef.current.clear(); setSelectedTrackIds((ids) => [...ids]) }}>Réessayer</button></div>}
      {!trackError && prefetchReady && selectedTrackIds.length > 0 && alertMarkers.length === 0 && <div className="empty-banner">Aucune alerte géolocalisée sur la période sélectionnée.</div>}

      <div className="map-filter-stack">
        <div className="filters filter-row map-status-row"><button type="button" aria-pressed={mapFilter === 'all'} className={`chip ${mapFilter === 'all' ? 'selected' : ''}`} onClick={() => setMapFilter('all')}>Toutes</button><button type="button" aria-pressed={mapFilter === 'moving'} className={`chip ${mapFilter === 'moving' ? 'selected' : ''}`} onClick={() => setMapFilter('moving')}>En mouvement</button><button type="button" aria-pressed={mapFilter === 'offline'} className={`chip ${mapFilter === 'offline' ? 'selected' : ''}`} onClick={() => setMapFilter('offline')}>Offline</button><button type="button" aria-pressed={mapFilter === 'risk'} className={`chip ${mapFilter === 'risk' ? 'selected' : ''}`} onClick={() => setMapFilter('risk')}>Avec alertes</button></div>
        <div className="map-tracker-toolbar">
          <label className="map-search-field"><Search size={18} aria-hidden="true" /><input value={trackerSearch} onChange={(event) => setTrackerSearch(event.target.value)} aria-label="Rechercher un camion sur la carte" placeholder="Camion, chauffeur, BL ou client" />{trackerSearch && <button type="button" className="map-search-clear" onClick={() => setTrackerSearch('')} aria-label="Effacer la recherche"><X size={18} /></button>}</label>
          <button type="button" className="ghost-btn map-show-all" onClick={() => { setSelectedTrackIds([]); setFocusTrackId(null); setFollowOn(false); setPlayback(null); setFitRequest((value) => value + 1) }} disabled={selectedTrackIds.length === 0}>Tout afficher</button>
        </div>
        <div className="filters filter-row map-tracker-strip" aria-label="Sélection rapide des camions">{selectableTrackers.slice(0, 20).map((tracker) => <button type="button" key={tracker.id} aria-pressed={selectedTrackIds.includes(String(tracker.id))} className={`chip ${selectedTrackIds.includes(String(tracker.id)) ? 'selected' : ''}`} onClick={() => toggleTrackerSelection(tracker.id)}>{tracker.label}<small>{tracker.employeeName || 'Non assigné'}</small></button>)}{selectableTrackers.length === 0 && <span className="map-no-result">Aucun camion trouvé</span>}</div>
        {selectedTrackIds.length > 0 && <div className="filters filter-row map-period-row" aria-label="Période du tracé">{[{ value: 'today', label: "Aujourd'hui" }, { value: '12h', label: '12h' }, { value: '24h', label: '24h' }, { value: '48h', label: '48h' }].map((item) => <button type="button" key={item.value} aria-pressed={period === item.value} className={`chip ${period === item.value ? 'selected' : ''}`} onClick={() => setPeriod(item.value)}>{item.label}</button>)}</div>}
      </div>

      <div className="map-legend-row"><span><i className="legend-dot" style={{ background: '#22c55e' }}></i> Moving</span><span><i className="legend-dot" style={{ background: '#f59e0b' }}></i> Parking / Idle</span><span><i className="legend-dot" style={{ background: '#ef4444' }}></i> Offline</span><span><i className="legend-dot mission-legend-dot"></i> Mission active</span><span><i className="legend-line"></i> Tracé trajet</span><span><i className="legend-dot" style={{ background: '#ef4444' }}></i> Critique</span><span><i className="legend-dot" style={{ background: '#38bdf8' }}></i> Surveillance</span><span><i className="legend-dot" style={{ background: '#f59e0b', borderRadius: '50%' }}></i> Arrêt</span>{geofences.some((zone) => zone.active) && <span><i className="legend-circle"></i> Zone géofence</span>}</div>

      <div ref={mapShellRef} className={`leaflet-wrap large-map map-shell ${isFullscreen ? 'map-shell-fullscreen' : ''}`}>
        <div className="map-overlay-controls">
          <div className="map-overlay-group"><div className="map-overlay-buttons"><button type="button" className={`chip ${baseMap === 'plan' ? 'selected' : ''}`} onClick={() => { setTileLoadState('loading'); setBaseMap('plan') }}>Plan</button><button type="button" className={`chip ${baseMap === 'satellite' ? 'selected' : ''}`} onClick={() => { setTileLoadState('loading'); setBaseMap('satellite') }}>Satellite</button><button type="button" className={`chip ${baseMap === 'hybrid' ? 'selected' : ''}`} onClick={() => { setTileLoadState('loading'); setBaseMap('hybrid') }}>Hybride</button></div></div>
          <div className="map-overlay-actions"><button type="button" className="ghost-btn map-overlay-action" onClick={() => setFitRequest((value) => value + 1)}><LocateFixed size={18} />Recentrer</button><button type="button" className="ghost-btn map-overlay-action" onClick={toggleFullscreen}>{isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}{isFullscreen ? 'Quitter' : 'Plein écran'}</button></div>
          <span className={`map-tile-state is-${tileLoadState}`} role="status">{tileLoadState === 'loading' ? 'Chargement du fond…' : tileLoadState === 'error' ? <>Fond cartographique incomplet <button type="button" className="ghost-btn small-btn" onClick={() => { setTileLoadState('loading'); setTileKey((value) => value + 1) }}>Réessayer</button></> : 'Fond chargé'}</span>
        </div>
        <MapContainer center={center} zoom={7} scrollWheelZoom className="leaflet-map">
          <MapInteractionGuard />
          <FleetBounds trackers={displayedTrackers} fitKey={mapFitKey} />
          <ZoomProbe onZoom={setMapZoom} />
          <FlyToTarget position={focusedTracker?.state?.gps?.location ? [focusedTracker.state.gps.location.lat, focusedTracker.state.gps.location.lng] : null} requestKey={focusedTracker && recenterRequest > 0 ? `${focusTrackId}:${recenterRequest}` : null} />
          <FollowController position={focusedTracker?.state?.gps?.location ? [focusedTracker.state.gps.location.lat, focusedTracker.state.gps.location.lng] : null} following={followOn && !!focusedTracker} onUserInterrupt={() => setFollowOn(false)} />
          {baseMap === 'plan' && <TileLayer key={`plan-${tileKey}`} eventHandlers={tileEventHandlers} attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />}
          {baseMap === 'satellite' && <TileLayer key={`satellite-${tileKey}`} eventHandlers={tileEventHandlers} attribution='&copy; Esri' url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />}
          {baseMap === 'hybrid' && <><TileLayer key={`hybrid-imagery-${tileKey}`} eventHandlers={tileEventHandlers} attribution='&copy; Esri' url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" /><TileLayer key={`hybrid-labels-${tileKey}`} eventHandlers={tileEventHandlers} attribution='&copy; Esri' url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}" opacity={1} /></>}

          {geofences.filter((zone) => zone.active).map((zone) => (
            <Circle
              key={`zone-${zone.id}`}
              center={[zone.lat, zone.lng]}
              radius={Number(zone.radiusMeters) || 1000}
              pathOptions={{ color: zone.color || '#946239', weight: 2, fillColor: zone.color || '#946239', fillOpacity: 0.14 }}
            >
              <Tooltip className="geofence-zone-tooltip" direction="top" offset={[0, -6]} opacity={1}>
                <strong>{zone.name}</strong>
                <br />
                Rayon: {Number(zone.radiusMeters).toLocaleString('fr-FR')} m
              </Tooltip>
            </Circle>
          ))}
          {geofences.filter((zone) => zone.active).map((zone) => (
            <CircleMarker
              key={`zone-center-${zone.id}`}
              center={[zone.lat, zone.lng]}
              radius={5}
              pathOptions={{ color: '#07090c', weight: 2, fillColor: zone.color || '#946239', fillOpacity: 1 }}
            />
          ))}

          {/* Itinéraire direct vers la zone client la plus proche (destination du BL) */}
          {focusedTracker && nearestClientZone && (
            <Polyline
              key={`eta-line-${focusTrackId}`}
              positions={[[focusedTracker.state.gps.location.lat, focusedTracker.state.gps.location.lng], [nearestClientZone.lat, nearestClientZone.lng]]}
              pathOptions={{ color: '#946239', weight: 2, dashArray: '6 8', opacity: 0.85 }}
            >
              <Tooltip direction="top" offset={[0, -4]} opacity={1}>
                {nearestClientZone.distanceMeters >= 1000
                  ? `${(nearestClientZone.distanceMeters / 1000).toFixed(1)} km`
                  : `${Math.round(nearestClientZone.distanceMeters)} m`}
                {focusedEta ? ` · ETA ${focusedEta.minutes} min` : ''}
              </Tooltip>
            </Polyline>
          )}

          {selectedTrackIds.length > 0 && selectedTrackIds.map((trackerId) => {
            const track = trackMap[String(trackerId)]
            const positions = (track?.points || []).map((point) => [point.lat, point.lng])
            if (positions.length <= 1) return null
            return <Polyline key={`poly-${trackerId}`} positions={positions} pathOptions={{ color: '#22d3ee', weight: 5, opacity: 0.95 }} />
          })}

          {/* Sens de circulation le long des tracés sélectionnés */}
          {selectedTrackIds.length > 0 && selectedTrackIds.map((trackerId) => {
            const points = trackMap[String(trackerId)]?.points || []
            const arrows = buildDirectionArrows(points)
            return arrows.map((arrow, index) => (
              <Marker
                key={`arrow-${trackerId}-${index}`}
                position={[arrow.lat, arrow.lng]}
                icon={createDirectionArrowIcon(arrow.bearing)}
                interactive={false}
                keyboard={false}
              />
            ))
          })}

          {/* Temps d'arrêt du camion focalisé */}
          {focusedStops.map((stop, index) => (
            <CircleMarker
              key={`stop-${focusTrackId}-${index}`}
              center={[stop.lat, stop.lng]}
              radius={9}
              pathOptions={{ color: '#f59e0b', weight: 2, fillColor: '#f59e0b', fillOpacity: 0.45, dashArray: '4 4' }}
            >
              <Tooltip direction="top" offset={[0, -6]} opacity={1}>
                Arrêt {formatDurationMs(stop.durationMs)}
                {stop.startIndex != null ? ` · ${formatPlaybackTime(focusedTrackPoints[stop.startIndex])}` : ''}
              </Tooltip>
            </CircleMarker>
          ))}

          {/* Marqueur de lecture animée */}
          {playbackIndex != null && focusedTrackPoints[playbackIndex] && (
            <Marker position={[focusedTrackPoints[playbackIndex].lat, focusedTrackPoints[playbackIndex].lng]} icon={createPlaybackIcon()} zIndexOffset={2000} interactive={false} keyboard={false}>
              <Tooltip direction="top" offset={[0, -14]} opacity={1}>
                {formatPlaybackTime(focusedTrackPoints[playbackIndex])} — {Number(focusedTrackPoints[playbackIndex].speed || 0).toFixed(0)} km/h
              </Tooltip>
            </Marker>
          )}

          {selectedTrackIds.length > 0 && alertMarkers.map((event, index) => <CircleMarker key={`${event.time}-${index}`} center={[event.lat, event.lng]} radius={getAlertPriority(event.event) === 'Critique' ? 9 : 7} pathOptions={{ color: getAlertColor(event.event), fillColor: getAlertColor(event.event), fillOpacity: 0.95, weight: getAlertPriority(event.event) === 'Critique' ? 3 : 2 }}><Popup><strong>{event.event}</strong><br />Priorité: {getAlertPriority(event.event)}<br />{event.message}<br />{event.time ? new Date(event.time).toLocaleString() : '-'}</Popup></CircleMarker>)}

          {hasClusterView ? clusters.map((cluster, index) => <ClusterZoomer key={`cluster-${index}`} cluster={cluster} />) : singles.map((tracker) => {
            const state = getPinState(tracker)
            const isActive = selectedTrackIds.includes(String(tracker.id))
            const activeOrder = activeOrderByTrackerId[String(tracker.id)]
            const computedBearing = bearingByTrackerId.get(String(tracker.id))
            const zoneNames = tracker.liveGeofenceNames || []
            return <Marker key={tracker.id} position={[tracker.state.gps.location.lat, tracker.state.gps.location.lng]} icon={createTrackerIcon(tracker, !!activeOrder, isActive, computedBearing)} opacity={isActive || selectedTrackIds.length === 0 ? 1 : 0.72} eventHandlers={{ click: () => toggleTrackerSelection(tracker.id) }}><Tooltip className="truck-hover-tooltip" direction="top" offset={[0, -18]} opacity={1} sticky><div className="truck-hover-card"><strong>{tracker.label}</strong><span>{tracker.employeeName}</span><span>État: {state.text}</span><span>Vitesse: {tracker.state.gps.speed ?? 0} km/h</span><span>Connexion: {tracker.state.connection_status}</span><span>Direction: {Math.round(computedBearing ?? tracker.state.gps.heading ?? 0)}°</span>{zoneNames.length > 0 ? <span className="truck-zone-badge">Dans zone: {zoneNames.join(', ')}</span> : null}{activeOrder ? <span>BL: {activeOrder.reference} • {activeOrder.client}</span> : <span>Aucun bon actif</span>}</div></Tooltip><Popup><strong>{tracker.label}</strong><br />{tracker.employeeName}<br />Etat: {state.text}<br />Connexion: {tracker.state.connection_status}<br />Mouvement: {tracker.state.movement_status}<br />Vitesse: {tracker.state.gps.speed ?? 0} km/h<br />Direction: {Math.round(computedBearing ?? tracker.state.gps.heading ?? 0)}°<br />{zoneNames.length > 0 ? <><strong>Zone:</strong> {zoneNames.join(', ')}<br /></> : null}{activeOrder ? <><br /><strong>BL:</strong> {activeOrder.reference}<br /><strong>Client:</strong> {activeOrder.client}<br /><strong>Destination:</strong> {activeOrder.destination}<br /><strong>Marchandise:</strong> {activeOrder.goods || '-'}<br /><strong>Quantité:</strong> {activeOrder.quantity || '-'}<br /><strong>Statut:</strong> {activeOrder.status}<br /><strong>Fiche mission:</strong> /delivery-order/{activeOrder.id}</> : <><br />Aucun bon actif</>}</Popup></Marker>
          })}
        </MapContainer>

        {/* ── Poste de contrôle : panneau latéral (desktop) / bottom sheet (mobile) ── */}
        {focusedTracker && (
          <aside className="map-control-panel" role="complementary" aria-label="Poste de contrôle">
            <div className="map-control-head">
              <div><strong>{focusedTracker.label}</strong><span>{focusedTracker.employeeName || 'Chauffeur non assigné'}</span></div>
              <button type="button" className="ghost-btn map-control-close" onClick={closeControlPanel} aria-label="Fermer le poste de contrôle"><X size={18} /></button>
            </div>
            <div className="map-control-body">
              <div className="map-control-kpis">
                <div className={`map-control-kpi state-${getPinState(focusedTracker).text.toLowerCase()}`}><span>État</span><strong>{getPinState(focusedTracker).text}</strong></div>
                <div className="map-control-kpi"><span>Vitesse</span><strong>{focusedTracker.state?.gps?.speed ?? 0} km/h</strong></div>
                <div className="map-control-kpi"><span>Connexion</span><strong>{focusedTracker.state?.connection_status}</strong></div>
                <div className="map-control-kpi"><span>Dernière position</span><strong>{formatPositionAge(focusedLive?.last_update || focusedTracker.liveLastUpdate || liveUpdatedAt, ageNow)}</strong></div>
              </div>

              {focusedOrder ? (
                <div className="map-control-block">
                  <h3>Mission active</h3>
                  <p><strong>BL</strong> {focusedOrder.reference}</p>
                  <p><strong>Client</strong> {focusedOrder.client}</p>
                  <p><strong>Destination</strong> {focusedOrder.destination}</p>
                  <p><strong>Marchandise</strong> {focusedOrder.goods || '-'} · {focusedOrder.quantity || '-'}</p>
                  <p><strong>Statut</strong> {focusedOrder.status}</p>
                </div>
              ) : <div className="map-control-block"><h3>Mission</h3><p className="map-control-muted">Aucun bon actif pour ce camion.</p></div>}

              {focusedEta && nearestClientZone && (
                <div className="map-control-block map-control-eta">
                  <h3>Destination / ETA</h3>
                  <p><strong>Zone la plus proche</strong> {nearestClientZone.name} ({nearestClientZone.type})</p>
                  <p><strong>Distance</strong> {focusedEta.distanceKm >= 10 ? `${focusedEta.distanceKm.toFixed(1)} km` : `${Math.round(focusedEta.distanceKm * 1000)} m`}</p>
                  <p><strong>ETA estimée</strong> {focusedEta.minutes} min</p>
                </div>
              )}

              {focusedStops.length > 0 && (
                <div className="map-control-block">
                  <h3>Temps d'arrêt <span className="map-control-count">{focusedStops.length}</span></h3>
                  <ul className="map-control-stops">{focusedStops.slice(0, 6).map((stop, index) => (
                    <li key={index}><Navigation size={13} aria-hidden="true" /><span>{formatDurationMs(stop.durationMs)}</span><small>{formatPlaybackTime(focusedTrackPoints[stop.startIndex])}</small></li>
                  ))}</ul>
                </div>
              )}

              {focusedTrackPoints.length > 1 && (
                <div className="map-control-block">
                  <h3>Lecture du trajet <span className="map-control-count">{focusedTrackPoints.length} pts</span></h3>
                  <div className="map-playback-bar">
                    <button type="button" className="ghost-btn small-btn" aria-label="Revenir au début" onClick={() => setPlayback({ trackerId: focusTrackId, index: 0, playing: false })}><SkipBack size={16} /></button>
                    <button type="button" className="ghost-btn small-btn" aria-label={playback?.playing ? 'Pause' : 'Lire le trajet'} onClick={() => setPlayback((prev) => (prev && prev.trackerId === focusTrackId ? { ...prev, playing: !prev.playing } : { trackerId: focusTrackId, index: 0, playing: true }))}>{playback?.playing ? <Pause size={16} /> : <Play size={16} />}</button>
                    <input
                      type="range"
                      min={0}
                      max={focusedTrackPoints.length - 1}
                      value={playbackIndex ?? 0}
                      aria-label="Position dans le trajet"
                      onChange={(event) => setPlayback({ trackerId: focusTrackId, index: Number(event.target.value), playing: false })}
                    />
                    <button type="button" className="ghost-btn small-btn" aria-label="Fin du trajet" onClick={() => setPlayback({ trackerId: focusTrackId, index: focusedTrackPoints.length - 1, playing: false })}><SkipForward size={16} /></button>
                  </div>
                  <p className="map-control-muted">{playbackIndex != null ? formatPlaybackTime(focusedTrackPoints[playbackIndex]) : formatPlaybackTime(focusedTrackPoints[0])}</p>
                </div>
              )}

              <div className="map-control-actions">
                <button type="button" className="ghost-btn" onClick={() => setRecenterRequest((value) => value + 1)}><Crosshair size={16} />Recentrer</button>
                <button type="button" className={`ghost-btn ${followOn ? 'selected' : ''}`} aria-pressed={followOn} onClick={() => setFollowOn((value) => !value)}>{followOn ? <Eye size={16} /> : <EyeOff size={16} />}{followOn ? 'Suivi en cours' : 'Suivre le camion'}</button>
                <button type="button" className="ghost-btn" onClick={() => { window.location.hash = `#/tracker/${focusedTracker.id}` }}><ExternalLink size={16} />Fiche camion</button>
                {focusedOrder && <button type="button" className="ghost-btn" onClick={() => { window.location.hash = `#/delivery-order/${focusedOrder.id}` }}><ExternalLink size={16} />Fiche mission</button>}
              </div>
            </div>
          </aside>
        )}
      </div>
      <details className="panel map-accessible-list" aria-label="Liste accessible des véhicules affichés">
        <summary>Véhicules affichés ({allVisibleTrackers.length})</summary>
        {allVisibleTrackers.length ? <ul>{allVisibleTrackers.map((tracker) => {
          const state = getPinState(tracker)
          const selected = selectedTrackIds.includes(String(tracker.id))
          return <li key={`accessible-${tracker.id}`}><button type="button" className={`ghost-btn ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={() => toggleTrackerSelection(tracker.id)}>{tracker.label} — {tracker.employeeName || 'Chauffeur non assigné'} — {state.text} — {tracker.state?.gps?.speed ?? 0} km/h</button></li>
        })}</ul> : <div className="empty-banner">Aucun véhicule géolocalisé pour ce filtre.</div>}
      </details>
    </section>
  )
}
