import { useEffect, useState, useRef, useMemo } from 'react'
import { MapContainer, TileLayer, Circle, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './MapView.css'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787'

// Default center point (Phoenix area)
const DEFAULT_CENTER = {
  lat: 33.47582267755572,
  lon: -111.70391851974681
}

// Create airplane icon function
function createAirplaneIcon(heading = 0) {
  // Create a simple SVG airplane icon that rotates based on heading
  // OpenSky heading: 0° = North, 90° = East, 180° = South, 270° = West
  // CSS transform rotate: 0° = no rotation, positive = clockwise
  // The SVG airplane icon points to the right (East) by default
  // Rotate 90° clockwise from previous calculation: rotation = (heading - 90) + 90 = heading
  const rotation = heading
  
  const svgIcon = `
    <svg width="36" height="36" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" 
         style="transform: rotate(${rotation}deg); transform-origin: center center;">
      <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" 
            fill="#2563eb" 
            stroke="#ffffff" 
            stroke-width="1" 
            stroke-linejoin="round" 
            stroke-linecap="round"/>
    </svg>
  `
  
  return L.divIcon({
    html: svgIcon,
    className: 'airplane-marker',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  })
}

// Component to handle map centering when center/radius changes
function MapCenter({ center, radiusMiles }) {
  const map = useMap()
  
  useEffect(() => {
    if (center && center.lat && center.lon) {
      // Convert radius from miles to meters for Leaflet
      const radiusMeters = radiusMiles * 1609.34
      // Set zoom level based on radius to show the full circle
      const zoom = radiusMiles <= 0.5 ? 14 : radiusMiles <= 1 ? 13 : radiusMiles <= 2 ? 12 : radiusMiles <= 3 ? 11 : 10
      
      map.setView([center.lat, center.lon], zoom)
    }
  }, [center, radiusMiles, map])
  
  return null
}

// Component to handle map clicks when in pick point mode
function MapPointPicker({ pickPointMode, onPointSelected, onCancel }) {
  const map = useMap()
  
  useEffect(() => {
    if (!pickPointMode) {
      // Reset cursor when not in pick mode
      const mapContainer = map.getContainer()
      if (mapContainer) {
        mapContainer.style.cursor = ''
      }
      return
    }
    
    // Change cursor to crosshair when in pick mode
    const mapContainer = map.getContainer()
    if (mapContainer) {
      mapContainer.style.cursor = 'crosshair'
    }
    
    const handleClick = (e) => {
      const latlng = e.latlng
      if (latlng && onPointSelected) {
        // Show confirmation dialog
        const confirmed = window.confirm(
          `Set this location as the new center point?\n\n` +
          `Latitude: ${latlng.lat.toFixed(6)}\n` +
          `Longitude: ${latlng.lng.toFixed(6)}`
        )
        
        if (confirmed) {
          onPointSelected({
            lat: latlng.lat,
            lon: latlng.lng
          })
        }
      }
    }
    
    map.on('click', handleClick)
    
    return () => {
      map.off('click', handleClick)
      if (mapContainer) {
        mapContainer.style.cursor = ''
      }
    }
  }, [map, pickPointMode, onPointSelected])
  
  return null
}

// Component to get map bounds and trigger flight updates
function MapBoundsTracker({ onBoundsChange, onMapChange }) {
  const map = useMap()
  const lastZoomRef = useRef(null)
  const isInitialMount = useRef(true)
  
  useEffect(() => {
    const updateBounds = (isMapChange = false) => {
      const bounds = map.getBounds()
      if (bounds.isValid()) {
        const currentZoom = map.getZoom()
        const zoomChanged = lastZoomRef.current !== null && lastZoomRef.current !== currentZoom
        
        // Always update bounds
        onBoundsChange({
          north: bounds.getNorth(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          west: bounds.getWest()
        })
        
        // If zoom changed or map moved (and not initial mount), trigger map change callback
        if (!isInitialMount.current && (zoomChanged || isMapChange)) {
          if (onMapChange) {
            onMapChange(true)
          }
        }
        
        if (zoomChanged) {
          lastZoomRef.current = currentZoom
        }
        
        if (lastZoomRef.current === null) {
          lastZoomRef.current = currentZoom
        }
        
        // Mark that initial mount is complete
        if (isInitialMount.current) {
          isInitialMount.current = false
        }
      }
    }
    
    // Initial bounds (not a map change)
    updateBounds(false)
    
    // Update bounds on move/zoom - these are map changes
    const handleMoveEnd = () => updateBounds(true)
    const handleZoomEnd = () => updateBounds(true)
    
    map.on('moveend', handleMoveEnd)
    map.on('zoomend', handleZoomEnd)
    
    return () => {
      map.off('moveend', handleMoveEnd)
      map.off('zoomend', handleZoomEnd)
    }
  }, [map, onBoundsChange, onMapChange])
  
  return null
}

/**
 * Calculate estimated position after a given time based on velocity and heading
 * @param {number} lat - Current latitude
 * @param {number} lon - Current longitude
 * @param {number} velocity - Velocity in m/s
 * @param {number} heading - Heading in degrees (0 = North, 90 = East)
 * @param {number} timeSeconds - Time in seconds to project forward
 * @returns {Object} {lat, lon} - Estimated position
 */
function calculateEstimatedPosition(lat, lon, velocity, heading, timeSeconds) {
  if (!velocity || velocity === 0) {
    return { lat, lon }
  }
  
  // Convert heading to radians (0° = North, 90° = East)
  // Heading uses compass directions: 0° = North, 90° = East, 180° = South, 270° = West
  // In standard math: 0° = East, 90° = North, 180° = West, 270° = South
  // So we convert: math_angle = 90° - heading
  const headingRad = ((90 - heading) * Math.PI) / 180
  
  // Calculate distance traveled in meters
  const distanceMeters = velocity * timeSeconds
  
  // Convert distance to degrees
  // 1 degree latitude ≈ 111,000 meters
  // 1 degree longitude ≈ 111,000 * cos(latitude) meters
  // Latitude (North/South) uses sin (y-component)
  // Longitude (East/West) uses cos (x-component)
  const latOffset = (distanceMeters * Math.sin(headingRad)) / 111000
  const lonOffset = (distanceMeters * Math.cos(headingRad)) / (111000 * Math.cos(lat * Math.PI / 180))
  
  return {
    lat: lat + latOffset,
    lon: lon + lonOffset
  }
}

// Animated marker component that smoothly animates planes based on estimated position
function AnimatedMarker({ flight }) {
  const markerRef = useRef(null)
  const animationRef = useRef(null)
  const startTimeRef = useRef(null)
  const startPosRef = useRef(null)
  const estimatedPosRef = useRef(null)
  const currentHeadingRef = useRef(null)
  
  useEffect(() => {
    if (!markerRef.current) return
    
    const marker = markerRef.current
    const currentPos = [flight.latitude, flight.longitude]
    const currentHeading = flight.heading || 0
    const velocity = flight.velocity || 0 // m/s
    
    // Calculate estimated position after 30 seconds (API polling interval)
    const estimated = calculateEstimatedPosition(
      flight.latitude,
      flight.longitude,
      velocity,
      currentHeading,
      30 // 30 seconds
    )
    const estimatedPos = [estimated.lat, estimated.lon]
    
    // If this is a new flight, position changed, or heading changed, update and reset animation
    const positionChanged = !startPosRef.current || 
        Math.abs(startPosRef.current[0] - currentPos[0]) > 0.0001 || 
        Math.abs(startPosRef.current[1] - currentPos[1]) > 0.0001
    const headingChanged = !currentHeadingRef.current || 
        Math.abs(currentHeadingRef.current - currentHeading) > 1 // More than 1 degree change
    
    if (positionChanged || headingChanged) {
      // New position or heading received - reset animation
      marker.setLatLng(currentPos)
      marker.setIcon(createAirplaneIcon(currentHeading))
      startPosRef.current = currentPos
      estimatedPosRef.current = estimatedPos
      currentHeadingRef.current = currentHeading
      startTimeRef.current = Date.now()
    }
    
    // Animation duration: 30 seconds (matching API polling interval)
    const duration = 30000
    
    const animate = () => {
      if (!startTimeRef.current || !markerRef.current) return
      
      const elapsed = Date.now() - startTimeRef.current
      const progress = Math.min(elapsed / duration, 1)
      
      // Linear interpolation for smooth constant-speed animation
      const startLat = startPosRef.current[0]
      const startLon = startPosRef.current[1]
      const targetLat = estimatedPosRef.current[0]
      const targetLon = estimatedPosRef.current[1]
      
      const currentLat = startLat + (targetLat - startLat) * progress
      const currentLon = startLon + (targetLon - startLon) * progress
      
      // Keep heading constant (or could interpolate if heading changes)
      const currentHeading = currentHeadingRef.current
      
      marker.setLatLng([currentLat, currentLon])
      marker.setIcon(createAirplaneIcon(currentHeading))
      
      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate)
      } else {
        // Animation complete - hold at estimated position until new data arrives
        marker.setLatLng(estimatedPos)
      }
    }
    
    // Cancel any existing animation
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
    }
    
    // Start animation
    animationRef.current = requestAnimationFrame(animate)
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [flight])
  
  return (
    <Marker
      ref={markerRef}
      position={[flight.latitude, flight.longitude]}
      icon={createAirplaneIcon(flight.heading || 0)}
    >
      <Popup>
        <div className="flight-popup">
          <div className="popup-header">
            <strong>{flight.callsign || flight.icao24 || 'Unknown'}</strong>
          </div>
          <div className="popup-info">
            {flight.baroAltitude && (
              <div>Altitude: {Math.round(flight.baroAltitude * 3.28084).toLocaleString()} ft</div>
            )}
            {flight.velocity && (
              <div>Speed: {Math.round(flight.velocity * 2.237)} mph</div>
            )}
            {flight.heading !== null && flight.heading !== undefined && (
              <div>Heading: {Math.round(flight.heading)}°</div>
            )}
          </div>
        </div>
      </Popup>
    </Marker>
  )
}

function MapView({ estimatePositions = true, pickPointMode = false, onPointSelected, onPickPointCancel }) {
  const [center, setCenter] = useState(DEFAULT_CENTER)
  const [radiusMiles, setRadiusMiles] = useState(3)
  const [loading, setLoading] = useState(true)
  const [flights, setFlights] = useState([])
  const [mapBounds, setMapBounds] = useState(null)
  const [mapChanged, setMapChanged] = useState(false)

  const loadRegion = async () => {
    try {
      // Try to load from server first
      const response = await fetch(`${API_BASE_URL}/api/region`)
      if (response.ok) {
        const data = await response.json()
        if (data.region && data.region.center && data.region.center.lat && data.region.center.lon) {
          setCenter({
            lat: data.region.center.lat,
            lon: data.region.center.lon
          })
          if (data.region.radiusMiles !== undefined) {
            setRadiusMiles(data.region.radiusMiles)
          }
        }
      }
    } catch (e) {
      console.error('Failed to load region from server:', e)
    }

    // Fallback to localStorage
    const saved = localStorage.getItem('monitoringRegion')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        if (parsed.lat && parsed.lon) {
          setCenter(parsed)
        }
        if (parsed.radiusMiles !== undefined) {
          setRadiusMiles(parsed.radiusMiles)
        }
      } catch (e) {
        console.error('Failed to load saved region:', e)
      }
    }
    
    setLoading(false)
  }

  useEffect(() => {
    loadRegion()
  }, [])

  // Listen for storage changes to update map immediately when config is saved
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === 'monitoringRegion' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue)
          if (parsed.lat && parsed.lon) {
            setCenter(parsed)
          }
          if (parsed.radiusMiles !== undefined) {
            setRadiusMiles(parsed.radiusMiles)
          }
        } catch (err) {
          console.error('Failed to parse updated region:', err)
        }
      }
    }

    // Listen for storage events (works when storage changes in other tabs/windows)
    window.addEventListener('storage', handleStorageChange)

    // Also poll localStorage periodically to catch changes in the same tab
    // (storage event doesn't fire in the same tab)
    const pollInterval = setInterval(() => {
      const saved = localStorage.getItem('monitoringRegion')
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          const currentRegion = JSON.stringify({ lat: center.lat, lon: center.lon, radiusMiles })
          const newRegion = JSON.stringify({ lat: parsed.lat, lon: parsed.lon, radiusMiles: parsed.radiusMiles })
          
          if (currentRegion !== newRegion) {
            if (parsed.lat && parsed.lon) {
              setCenter(parsed)
            }
            if (parsed.radiusMiles !== undefined) {
              setRadiusMiles(parsed.radiusMiles)
            }
          }
        } catch (err) {
          // Ignore parse errors
        }
      }
    }, 500) // Check every 500ms

    return () => {
      window.removeEventListener('storage', handleStorageChange)
      clearInterval(pollInterval)
    }
  }, [center, radiusMiles])

  // Fetch flights for map display
  useEffect(() => {
    if (!mapBounds) return // Wait for map bounds
    
    const fetchFlights = async (isMapChange = false) => {
      try {
        // Build URL with map bounds
        const params = new URLSearchParams({
          north: mapBounds.north.toString(),
          south: mapBounds.south.toString(),
          east: mapBounds.east.toString(),
          west: mapBounds.west.toString()
        })
        
        // Add mapChanged parameter if this is a map change (zoom/pan)
        if (isMapChange) {
          params.append('mapChanged', 'true')
        }
        
        const response = await fetch(`${API_BASE_URL}/api/map-flights?${params}`)
        if (response.ok) {
          const data = await response.json()
          if (data.flights && Array.isArray(data.flights)) {
            // Backend will return cached flights when rate-limited, so we can trust the response
            setFlights(data.flights)
          }
        }
      } catch (e) {
        console.error('Failed to fetch flights for map:', e)
      }
    }

    // Initial fetch (not a map change)
    fetchFlights(false)

    // Poll for flights every 5 seconds (normal polling, not map change)
    const flightInterval = setInterval(() => fetchFlights(false), 5000)

    return () => clearInterval(flightInterval)
  }, [mapBounds])
  
  // Handle immediate fetch when map changes (zoom/pan)
  useEffect(() => {
    if (mapChanged && mapBounds) {
      // Reset the flag and trigger immediate fetch
      setMapChanged(false)
      const fetchFlights = async () => {
        try {
          const params = new URLSearchParams({
            north: mapBounds.north.toString(),
            south: mapBounds.south.toString(),
            east: mapBounds.east.toString(),
            west: mapBounds.west.toString(),
            mapChanged: 'true'
          })
          
          const response = await fetch(`${API_BASE_URL}/api/map-flights?${params}`)
          if (response.ok) {
            const data = await response.json()
            if (data.flights && Array.isArray(data.flights)) {
              setFlights(data.flights)
            }
          }
        } catch (e) {
          console.error('Failed to fetch flights for map after change:', e)
        }
      }
      fetchFlights()
    }
  }, [mapChanged, mapBounds])

  if (loading) {
    return (
      <div className="map-view-loading">
        <div className="loading-content">
          <div className="loading-icon">🗺️</div>
          <p>Loading map...</p>
        </div>
      </div>
    )
  }

  // Convert radius from miles to meters for Leaflet
  const radiusMeters = radiusMiles * 1609.34
  // Calculate zoom level based on radius
  const zoom = radiusMiles <= 0.5 ? 14 : radiusMiles <= 1 ? 13 : radiusMiles <= 2 ? 12 : radiusMiles <= 3 ? 11 : 10

  return (
    <div className="map-view">
      {pickPointMode && (
        <div className="pick-point-banner">
          <div className="pick-point-message">
            <span className="pick-point-icon">📍</span>
            <span>Click on the map to select a new center point</span>
            <button className="pick-point-cancel" onClick={onPickPointCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <MapContainer
        center={[center.lat, center.lon]}
        zoom={zoom}
        style={{ height: '100%', width: '100%' }}
        zoomControl={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapCenter center={center} radiusMiles={radiusMiles} />
        <MapBoundsTracker onBoundsChange={setMapBounds} onMapChange={setMapChanged} />
        {pickPointMode && (
          <MapPointPicker 
            pickPointMode={pickPointMode}
            onPointSelected={onPointSelected}
            onCancel={onPickPointCancel}
          />
        )}
        <Circle
          center={[center.lat, center.lon]}
          radius={radiusMeters}
          pathOptions={{
            color: '#4caf50',
            fillColor: '#4caf50',
            fillOpacity: 0.2,
            weight: 2
          }}
        />
        {flights.map((flight, index) => {
          // Use AnimatedMarker if estimation is enabled and flight has velocity/heading data
          if (estimatePositions && flight.velocity && flight.velocity > 0 && flight.heading !== null && flight.heading !== undefined) {
            return (
              <AnimatedMarker
                key={flight.icao24 || `flight-${index}`}
                flight={flight}
              />
            )
          } else {
            return (
              <Marker
                key={flight.icao24 || `flight-${index}`}
                position={[flight.latitude, flight.longitude]}
                icon={createAirplaneIcon(flight.heading || 0)}
              >
                <Popup>
                  <div className="flight-popup">
                    <div className="popup-header">
                      <strong>{flight.callsign || flight.icao24 || 'Unknown'}</strong>
                    </div>
                    <div className="popup-info">
                      {flight.baroAltitude && (
                        <div>Altitude: {Math.round(flight.baroAltitude * 3.28084).toLocaleString()} ft</div>
                      )}
                      {flight.velocity && (
                        <div>Speed: {Math.round(flight.velocity * 2.237)} mph</div>
                      )}
                      {flight.heading !== null && flight.heading !== undefined && (
                        <div>Heading: {Math.round(flight.heading)}°</div>
                      )}
                    </div>
                  </div>
                </Popup>
              </Marker>
            )
          }
        })}
      </MapContainer>
      <div className="map-legend">
        <div className="legend-item">
          <div className="legend-circle"></div>
          <span>Monitoring Region ({radiusMiles === 0.5 ? '1/2 mile' : radiusMiles === 1 ? '1 mile' : `${radiusMiles} miles`})</span>
        </div>
      </div>
    </div>
  )
}

export default MapView

