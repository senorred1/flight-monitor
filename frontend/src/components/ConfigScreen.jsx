import { useState, useEffect } from 'react'
import './ConfigScreen.css'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787'

// Default center point (Phoenix area)
const DEFAULT_CENTER = {
  lat: 33.47582267755572,
  lon: -111.70391851974681
}

const RADIUS_OPTIONS = [0.5, 1, 2, 3, 5]
const RATE_LIMIT_OPTIONS = [5, 15, 30] // in seconds

function ConfigScreen({ onClose, onSave }) {
  const [center, setCenter] = useState(DEFAULT_CENTER)
  const [radiusMiles, setRadiusMiles] = useState(3)
  const [chimeEnabled, setChimeEnabled] = useState(false)
  const [estimatePositions, setEstimatePositions] = useState(true)
  const [rateLimitSeconds, setRateLimitSeconds] = useState(30)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
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
            if (data.region.radiusMiles !== undefined && RADIUS_OPTIONS.includes(data.region.radiusMiles)) {
              setRadiusMiles(data.region.radiusMiles)
            }
          }
        }
      } catch (e) {
        console.error('Failed to load region from server:', e)
      }

      // Fallback to localStorage for region
      const saved = localStorage.getItem('monitoringRegion')
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          if (parsed.lat && parsed.lon) {
            setCenter(parsed)
          }
          if (parsed.radiusMiles !== undefined && RADIUS_OPTIONS.includes(parsed.radiusMiles)) {
            setRadiusMiles(parsed.radiusMiles)
          }
        } catch (e) {
          console.error('Failed to load saved region:', e)
        }
      }

      // Always load chime preference from localStorage
      const chimePref = localStorage.getItem('chimeEnabled')
      if (chimePref !== null) {
        setChimeEnabled(chimePref === 'true')
      } else {
        // Default to false if not set
        setChimeEnabled(false)
      }

      // Load estimate positions preference from localStorage
      const estimatePref = localStorage.getItem('estimatePositions')
      if (estimatePref !== null) {
        setEstimatePositions(estimatePref === 'true')
      } else {
        // Default to true if not set
        setEstimatePositions(true)
      }

      // Load rate limit preference from server first
      try {
        const rateLimitResponse = await fetch(`${API_BASE_URL}/api/rate-limit`)
        if (rateLimitResponse.ok) {
          const rateLimitData = await rateLimitResponse.json()
          if (rateLimitData.rateLimitSeconds && RATE_LIMIT_OPTIONS.includes(rateLimitData.rateLimitSeconds)) {
            setRateLimitSeconds(rateLimitData.rateLimitSeconds)
          }
        }
      } catch (e) {
        console.error('Failed to load rate limit from server:', e)
      }

      // Fallback to localStorage for rate limit
      const rateLimitPref = localStorage.getItem('rateLimitSeconds')
      if (rateLimitPref !== null) {
        const parsed = parseInt(rateLimitPref, 10)
        if (RATE_LIMIT_OPTIONS.includes(parsed)) {
          setRateLimitSeconds(parsed)
        }
      } else {
        // Default to 30 seconds if not set
        setRateLimitSeconds(30)
      }
    }

    loadRegion()
  }, [])

  const handleCoordinateChange = (field, value) => {
    setCenter({
      ...center,
      [field]: parseFloat(value) || 0
    })
    setError(null)
    setSuccess(false)
  }

  const handleSave = async () => {
    // Validate coordinates
    if (!center.lat || !center.lon || 
        isNaN(center.lat) || isNaN(center.lon) ||
        center.lat < -90 || center.lat > 90 ||
        center.lon < -180 || center.lon > 180) {
      setError('Invalid coordinates. Latitude must be between -90 and 90, Longitude between -180 and 180.')
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      // Save to backend
      const regionResponse = await fetch(`${API_BASE_URL}/api/region`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          center: { lat: center.lat, lon: center.lon },
          radiusMiles: radiusMiles
        })
      })

      if (!regionResponse.ok) {
        throw new Error('Failed to save region to server')
      }

      // Save rate limit to backend
      const rateLimitResponse = await fetch(`${API_BASE_URL}/api/rate-limit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          rateLimitSeconds: rateLimitSeconds
        })
      })

      if (!rateLimitResponse.ok) {
        console.warn('Failed to save rate limit to server, but continuing...')
      }

      // Save to localStorage
      localStorage.setItem('monitoringRegion', JSON.stringify({ ...center, radiusMiles }))
      localStorage.setItem('chimeEnabled', chimeEnabled.toString())
      localStorage.setItem('estimatePositions', estimatePositions.toString())
      localStorage.setItem('rateLimitSeconds', rateLimitSeconds.toString())
      
      setSuccess(true)
      if (onSave) {
        onSave({ center, radiusMiles, chimeEnabled, estimatePositions, rateLimitSeconds })
      }
      
      // Close after a short delay
      setTimeout(() => {
        onClose()
      }, 1000)
    } catch (err) {
      setError(err.message || 'Failed to save configuration')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    setCenter(DEFAULT_CENTER)
    setRadiusMiles(3)
    setError(null)
    setSuccess(false)
  }

  const handleRadiusChange = (e) => {
    setRadiusMiles(parseFloat(e.target.value))
    setError(null)
    setSuccess(false)
  }

  return (
    <div className="config-overlay" onClick={onClose}>
        <div className="config-modal" onClick={(e) => e.stopPropagation()}>
        <div className="config-header">
          <h2>Monitoring Region</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        
        <div className="config-content">
          <p className="config-description">
            Enter a GPS coordinate pair (latitude, longitude) to define the center of the monitoring region.
            Select the radius size from the dropdown. Coordinates should be in decimal degrees.
          </p>

          <div className="coordinate-input-group">
            <div className="coordinate-label">Center Point</div>
            <div className="coordinate-inputs">
              <div className="input-field">
                <label>Latitude</label>
                <input
                  type="number"
                  step="any"
                  value={center.lat}
                  onChange={(e) => handleCoordinateChange('lat', e.target.value)}
                  placeholder="33.4765"
                />
              </div>
              <div className="input-field">
                <label>Longitude</label>
                <input
                  type="number"
                  step="any"
                  value={center.lon}
                  onChange={(e) => handleCoordinateChange('lon', e.target.value)}
                  placeholder="-111.7060"
                />
              </div>
            </div>
            <div className="radius-selector">
              <label className="radius-label">Monitoring Radius:</label>
              <select
                className="radius-dropdown"
                value={radiusMiles}
                onChange={handleRadiusChange}
              >
                {RADIUS_OPTIONS.map(radius => (
                  <option key={radius} value={radius}>
                    {radius === 0.5 ? '1/2 mile' : radius === 1 ? '1 mile' : `${radius} miles`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="chime-setting">
            <div className="chime-toggle-group">
              <label className="chime-label">
                <input
                  type="checkbox"
                  checked={chimeEnabled}
                  onChange={(e) => {
                    setChimeEnabled(e.target.checked)
                    setError(null)
                    setSuccess(false)
                  }}
                  className="chime-checkbox"
                />
                <span className="chime-label-text">Chime when a plane is spotted</span>
              </label>
              <p className="chime-description">
                Play a sound notification when a new aircraft enters the monitoring region
              </p>
            </div>
          </div>

          <div className="chime-setting">
            <div className="chime-toggle-group">
              <label className="chime-label">
                <input
                  type="checkbox"
                  checked={estimatePositions}
                  onChange={(e) => {
                    setEstimatePositions(e.target.checked)
                    setError(null)
                    setSuccess(false)
                  }}
                  className="chime-checkbox"
                />
                <span className="chime-label-text">Estimate plane positions</span>
              </label>
              <p className="chime-description">
                Smoothly animate plane movement between position updates
              </p>
            </div>
          </div>

          <div className="rate-limit-setting">
            <div className="rate-limit-group">
              <label className="rate-limit-label">API Rate Limit:</label>
              <select
                className="rate-limit-dropdown"
                value={rateLimitSeconds}
                onChange={(e) => {
                  setRateLimitSeconds(parseInt(e.target.value, 10))
                  setError(null)
                  setSuccess(false)
                }}
              >
                {RATE_LIMIT_OPTIONS.map(seconds => (
                  <option key={seconds} value={seconds}>
                    {seconds} seconds
                  </option>
                ))}
              </select>
              <p className="rate-limit-description">
                Minimum time between API calls to OpenSky. Lower values provide more frequent updates but may hit rate limits.
              </p>
            </div>
          </div>

          {error && <div className="config-error">{error}</div>}
          {success && <div className="config-success">Configuration saved successfully!</div>}

          <div className="config-actions">
            <button className="reset-button" onClick={handleReset} disabled={saving}>
              Reset to Defaults
            </button>
            <button className="save-button" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ConfigScreen

