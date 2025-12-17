import { useState, useEffect, useRef } from 'react'
import FlightCard from './components/FlightCard'
import ConfigScreen from './components/ConfigScreen'
import MapView from './components/MapView'
import { playChime } from './utils/chime'
import './App.css'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787'

function App() {
  const [flightData, setFlightData] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [showConfig, setShowConfig] = useState(false)
  const [showMapView, setShowMapView] = useState(false)
  const [pickPointMode, setPickPointMode] = useState(false)
  const [chimeEnabled, setChimeEnabled] = useState(false)
  const [estimatePositions, setEstimatePositions] = useState(true)
  const previousFlightIdRef = useRef(null)
  const flightFirstDetectedRef = useRef(null) // Timestamp when current flight was first detected
  const lastDisplayedFlightRef = useRef(null) // Last flight data that was displayed

  useEffect(() => {
    // Load chime preference
    const chimePref = localStorage.getItem('chimeEnabled')
    if (chimePref !== null) {
      setChimeEnabled(chimePref === 'true')
    }
    
    // Load estimate positions preference
    const estimatePref = localStorage.getItem('estimatePositions')
    if (estimatePref !== null) {
      setEstimatePositions(estimatePref === 'true')
    } else {
      // Default to true if not set
      setEstimatePositions(true)
    }
  }, [])

  useEffect(() => {
    const fetchFlightData = async () => {
      try {
        setIsLoading(true)
        setError(null)
        const url = `${API_BASE_URL}/api/check-flights`
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        })
        
        if (!response.ok) {
          throw new Error(`Server error: ${response.status} ${response.statusText}`)
        }
        
        const data = await response.json()
        
        if (data.flight && data.flight.inRegion) {
          // Check if this is a new flight (different from previous, or first detection)
          const currentFlightId = data.flight.icao24 || data.flight.callsign || 'unknown'
          const isNewFlight = previousFlightIdRef.current !== currentFlightId
          
          // If it's a new flight and chime is enabled, play chime
          // This covers both: first plane entering, and a different plane entering
          if (isNewFlight && chimeEnabled) {
            playChime()
          }
          
          // If it's a new flight, reset the detection timestamp
          if (isNewFlight) {
            flightFirstDetectedRef.current = Date.now()
            previousFlightIdRef.current = currentFlightId
          }
          
          // Always update the displayed flight data with latest information
          lastDisplayedFlightRef.current = data.flight
          setFlightData(data.flight)
        } else {
          // No flight in region currently
          // Check if we should keep showing the last flight (within 60 seconds)
          const now = Date.now()
          const timeSinceDetection = flightFirstDetectedRef.current 
            ? now - flightFirstDetectedRef.current 
            : Infinity
          
          if (timeSinceDetection < 60000 && lastDisplayedFlightRef.current) {
            // Keep showing the last flight for up to 60 seconds
            // Don't update previousFlightIdRef - we want to detect if a NEW flight enters
            setFlightData(lastDisplayedFlightRef.current)
          } else {
            // 60 seconds have passed or no flight was ever detected - clear the card
            previousFlightIdRef.current = null
            flightFirstDetectedRef.current = null
            lastDisplayedFlightRef.current = null
            setFlightData(null)
          }
        }
      } catch (err) {
        // Provide helpful error message for network issues
        let errorMessage = err.message
        if (err.message === 'Failed to fetch' || err.message.includes('fetch') || err.message.includes('Load failed')) {
          errorMessage = `Cannot connect to ${API_BASE_URL}. Make sure: 1) Worker is running, 2) Both devices on same Wi-Fi, 3) Check firewall settings.`
        }
        setError(errorMessage)
        setFlightData(null)
        console.error('API Error:', err, 'URL:', API_BASE_URL)
      } finally {
        setIsLoading(false)
      }
    }

    // Initial fetch
    fetchFlightData()

    // Poll for flight data every 5 seconds
    const pollInterval = setInterval(fetchFlightData, 5000)

    return () => clearInterval(pollInterval)
  }, [chimeEnabled])

  const handleConfigSave = (config) => {
    // Update chime preference if provided
    if (config && typeof config.chimeEnabled === 'boolean') {
      setChimeEnabled(config.chimeEnabled)
    }
    // Update estimate positions preference if provided
    if (config && typeof config.estimatePositions === 'boolean') {
      setEstimatePositions(config.estimatePositions)
    }
    console.log('Configuration saved:', config)
  }

  const handlePickPointClick = () => {
    // Switch to map view and enable pick point mode
    setShowMapView(true)
    setPickPointMode(true)
  }

  const handlePointSelected = async (point) => {
    // Get current radius from server or localStorage
    let currentRadius = 3 // default
    try {
      const regionResponse = await fetch(`${API_BASE_URL}/api/region`)
      if (regionResponse.ok) {
        const regionData = await regionResponse.json()
        if (regionData.region && regionData.region.radiusMiles) {
          currentRadius = regionData.region.radiusMiles
        }
      }
    } catch (e) {
      // Fallback to localStorage
      const saved = localStorage.getItem('monitoringRegion')
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          if (parsed.radiusMiles) {
            currentRadius = parsed.radiusMiles
          }
        } catch (err) {
          // Use default
        }
      }
    }
    
    // Update the center point via API
    try {
      const response = await fetch(`${API_BASE_URL}/api/region`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          center: { lat: point.lat, lon: point.lon },
          radiusMiles: currentRadius // Keep existing radius
        })
      })

      if (response.ok) {
        // Also update localStorage
        localStorage.setItem('monitoringRegion', JSON.stringify({ 
          lat: point.lat, 
          lon: point.lon, 
          radiusMiles: currentRadius 
        }))
        
        // Exit pick point mode
        setPickPointMode(false)
        
        // Show success message
        alert(`Center point updated to: ${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}`)
      } else {
        throw new Error('Failed to update center point')
      }
    } catch (error) {
      console.error('Error updating center point:', error)
      alert('Failed to update center point. Please try again.')
    }
  }

  // If map view is shown, render it
  if (showMapView) {
    return (
      <div className="app">
        <div className="top-buttons">
          <button 
            className="flight-card-button"
            onClick={() => {
              setShowMapView(false)
              setPickPointMode(false)
            }}
            aria-label="Flight Card"
          >
            ✈️
          </button>
          <button 
            className="map-button"
            onClick={() => {
              setShowMapView(false)
              setPickPointMode(false)
            }}
            aria-label="Map View"
            style={{ opacity: 0.5 }}
          >
            🗺️
          </button>
          <button 
            className="pick-point-button"
            onClick={() => setPickPointMode(!pickPointMode)}
            aria-label="Pick Point"
            style={{ opacity: pickPointMode ? 1 : 0.7, backgroundColor: pickPointMode ? '#4a9eff' : 'transparent' }}
          >
            📍
          </button>
          <button 
            className="config-button"
            onClick={() => setShowConfig(true)}
            aria-label="Configuration"
          >
            ⚙️
          </button>
        </div>
        <MapView 
          estimatePositions={estimatePositions} 
          pickPointMode={pickPointMode}
          onPointSelected={handlePointSelected}
          onPickPointCancel={() => setPickPointMode(false)}
        />
        {showConfig && (
          <ConfigScreen
            onClose={() => setShowConfig(false)}
            onSave={handleConfigSave}
          />
        )}
      </div>
    )
  }

  return (
    <div className="app">
      <div className="top-buttons">
        <button 
          className="flight-card-button"
          onClick={() => {}}
          aria-label="Flight Card"
          style={{ opacity: 0.5, cursor: 'default' }}
        >
          ✈️
        </button>
        <button 
          className="map-button"
          onClick={handlePickPointClick}
          aria-label="Pick Point on Map"
        >
          📍
        </button>
        <button 
          className="map-button"
          onClick={() => setShowMapView(true)}
          aria-label="Map View"
        >
          🗺️
        </button>
        <button 
          className="config-button"
          onClick={() => setShowConfig(true)}
          aria-label="Configuration"
        >
          ⚙️
        </button>
      </div>
      
      {flightData ? (
        <FlightCard flight={flightData} />
      ) : (
        <div className="waiting-screen">
          <div className="waiting-content">
            <div className="radar-icon">✈️</div>
            <h1>Monitoring Airspace</h1>
            <p>Waiting for aircraft in region...</p>
            {error && <p className="error">Error: {error}</p>}
          </div>
        </div>
      )}

      {showConfig && (
        <ConfigScreen
          onClose={() => setShowConfig(false)}
          onSave={handleConfigSave}
        />
      )}
    </div>
  )
}

export default App

