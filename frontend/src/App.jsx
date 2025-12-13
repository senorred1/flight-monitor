import { useState, useEffect, useRef } from 'react'
import FlightCard from './components/FlightCard'
import ConfigScreen from './components/ConfigScreen'
import { playChime } from './utils/chime'
import './App.css'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787'

function App() {
  const [flightData, setFlightData] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [showConfig, setShowConfig] = useState(false)
  const [chimeEnabled, setChimeEnabled] = useState(false)
  const previousFlightIdRef = useRef(null)

  useEffect(() => {
    // Load chime preference
    const chimePref = localStorage.getItem('chimeEnabled')
    if (chimePref !== null) {
      setChimeEnabled(chimePref === 'true')
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
          
          previousFlightIdRef.current = currentFlightId
          setFlightData(data.flight)
        } else {
          // No flight in region - reset the previous flight ID
          previousFlightIdRef.current = null
          setFlightData(null)
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
    console.log('Configuration saved:', config)
  }

  return (
    <div className="app">
      <button 
        className="config-button"
        onClick={() => setShowConfig(true)}
        aria-label="Configuration"
      >
        ⚙️
      </button>
      
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

