// Rate limiting: Track last API call time
let lastApiCall = 0
const API_CALL_INTERVAL = 30000 // 30 seconds in milliseconds

// Default monitoring region (Phoenix area)
const DEFAULT_REGION = {
  center: {
    lat: 33.481252177897346,
    lon: -111.70670272771451
  },
  radiusMiles: 3
}

// Store monitoring region in memory (in production, use Cloudflare KV or Durable Objects)
let MONITORING_REGION = DEFAULT_REGION

// Test mode flag - set to false when ready to use real OpenSky API
const USE_SYNTHETIC_DATA = true

// Synthetic flight data for testing (Phoenix area)
const SYNTHETIC_FLIGHTS = [
  {
    icao24: 'abc123',
    callsign: 'TEST01',
    origin: 'KPHX',
    destination: 'KLAX',
    latitude: 33.481252177897346,
    longitude: -111.70670272771451,
    baroAltitude: 35000,
    velocity: 250, // m/s (~560 mph)
    heading: 180, // degrees (south)
    verticalRate: -5 // m/s (descending)
  }
]

/**
 * Calculate distance between two points using Haversine formula
 * Returns distance in miles
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 3959 // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * Check if a point is within the monitoring region (circle)
 */
function isPointInRegion(latitude, longitude, region) {
  const distance = calculateDistance(
    region.center.lat,
    region.center.lon,
    latitude,
    longitude
  )
  return distance <= region.radiusMiles
}

/**
 * Fetch flight data from OpenSky API
 */
async function fetchOpenSkyData(username, password) {
  const now = Date.now()
  
  // Rate limiting check
  if (now - lastApiCall < API_CALL_INTERVAL) {
    console.log('Rate limit: Skipping API call')
    return null
  }

  try {
    const url = 'https://opensky-network.org/api/states/all'
    const auth = btoa(`${username}:${password}`)
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Basic ${auth}`
      }
    })

    if (!response.ok) {
      throw new Error(`OpenSky API error: ${response.status}`)
    }

    const data = await response.json()
    lastApiCall = now
    return data.states || []
  } catch (error) {
    console.error('Error fetching OpenSky data:', error)
    return null
  }
}

/**
 * Get airport code from ICAO24 (simplified - in production, use a proper database)
 */
function getAirportInfo(icao24, callsign) {
  // This is a placeholder - in production, you'd query a database
  // or use another API to get origin/destination from flight data
  return {
    origin: callsign ? callsign.substring(0, 4) : 'Unknown',
    destination: 'Unknown'
  }
}

/**
 * Process flight states and check if any are in the monitoring region
 */
function processFlights(flights) {
  if (!flights || flights.length === 0) {
    return null
  }

  for (const flight of flights) {
    // Flight state format from OpenSky:
    // [icao24, callsign, origin_country, time_position, last_contact, longitude, latitude, 
    //  baro_altitude, on_ground, velocity, heading, vertical_rate, sensors, geo_altitude, 
    //  squawk, spi, position_source]
    
    const latitude = flight[6]
    const longitude = flight[5]
    
    if (latitude && longitude) {
      const inRegion = isPointInRegion(latitude, longitude, MONITORING_REGION)
      
      if (inRegion) {
        const airportInfo = getAirportInfo(flight[0], flight[1])
        return {
          icao24: flight[0],
          callsign: flight[1] || null,
          origin: airportInfo.origin,
          destination: airportInfo.destination,
          latitude,
          longitude,
          baroAltitude: flight[7],
          velocity: flight[9], // m/s
          heading: flight[10], // degrees
          verticalRate: flight[11], // m/s
          inRegion: true
        }
      }
    }
  }

  return null
}

/**
 * Generate synthetic flight data for testing
 * Creates a flight position within the configured monitoring region radius
 */
function getSyntheticFlight() {
  // Randomly decide if a synthetic flight should be in region (for testing)
  const shouldShow = Math.random() > 0.3 // 70% chance to show
  
  if (shouldShow) {
    const flight = SYNTHETIC_FLIGHTS[0]
    const center = MONITORING_REGION.center
    const radiusMiles = MONITORING_REGION.radiusMiles
    
    // Generate a random point within the circle radius
    // Use polar coordinates approach: random angle and random distance within radius
    const angle = Math.random() * 2 * Math.PI
    const distanceRatio = Math.sqrt(Math.random()) // sqrt for uniform distribution in circle
    const distanceMiles = distanceRatio * radiusMiles * 0.9 // Use 90% of radius to ensure it's well within
    
    // Convert distance to approximate lat/lon offset
    // 1 degree latitude ≈ 69 miles, 1 degree longitude ≈ 69 * cos(latitude) miles
    const latOffset = distanceMiles / 69 * Math.cos(angle)
    const lonOffset = distanceMiles / (69 * Math.cos(center.lat * Math.PI / 180)) * Math.sin(angle)
    
    const randomLat = center.lat + latOffset
    const randomLon = center.lon + lonOffset
    
    // Verify it's actually in the region (should always be, but double-check)
    const inRegion = isPointInRegion(randomLat, randomLon, MONITORING_REGION)
    
    return {
      ...flight,
      latitude: randomLat,
      longitude: randomLon,
      inRegion: inRegion
    }
  }
  
  return null
}

export default {
  async fetch(request, env) {
    // Handle CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      })
    }

    const url = new URL(request.url)
    
    // Health check endpoint
    if (url.pathname === '/api/health') {
      return new Response(
        JSON.stringify({ 
          status: 'ok', 
          timestamp: new Date().toISOString(),
          usingSyntheticData: USE_SYNTHETIC_DATA
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      )
    }
    
    // API endpoint to check for flights in region
    if (url.pathname === '/api/check-flights') {
      let flight = null

      if (USE_SYNTHETIC_DATA) {
        // Use synthetic data for testing
        flight = getSyntheticFlight()
      } else {
        // Use real OpenSky API
        const username = env.OPENSKY_USERNAME || ''
        const password = env.OPENSKY_PASSWORD || ''
        
        if (!username || !password) {
          return new Response(
            JSON.stringify({ error: 'OpenSky credentials not configured' }),
            {
              status: 500,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            }
          )
        }

        const flights = await fetchOpenSkyData(username, password)
        if (flights) {
          flight = processFlights(flights)
        }
      }

      return new Response(
        JSON.stringify({
          flight,
          timestamp: new Date().toISOString(),
          usingSyntheticData: USE_SYNTHETIC_DATA
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      )
    }

    // Endpoint to update monitoring region
    if (url.pathname === '/api/region' && request.method === 'POST') {
      try {
        const body = await request.json()
        const { center, radiusMiles } = body

        if (!center || typeof center.lat !== 'number' || typeof center.lon !== 'number') {
          return new Response(
            JSON.stringify({ error: 'Invalid center: must have lat and lon properties' }),
            {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            }
          )
        }

        // Validate coordinates
        if (center.lat < -90 || center.lat > 90 || center.lon < -180 || center.lon > 180) {
          return new Response(
            JSON.stringify({ error: 'Invalid coordinates: lat must be -90 to 90, lon must be -180 to 180' }),
            {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            }
          )
        }

        // Validate radius
        const radius = radiusMiles || 3
        if (radius <= 0 || radius > 100) {
          return new Response(
            JSON.stringify({ error: 'Invalid radius: must be between 0 and 100 miles' }),
            {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            }
          )
        }

        MONITORING_REGION = {
          center: {
            lat: center.lat,
            lon: center.lon
          },
          radiusMiles: radius
        }

        return new Response(
          JSON.stringify({ 
            message: 'Monitoring region updated successfully',
            region: MONITORING_REGION
          }),
          {
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          }
        )
      } catch (err) {
        return new Response(
          JSON.stringify({ error: 'Failed to parse request: ' + err.message }),
          {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          }
        )
      }
    }

    // Endpoint to get current monitoring region
    if (url.pathname === '/api/region' && request.method === 'GET') {
      return new Response(
        JSON.stringify({ region: MONITORING_REGION }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      )
    }

    return new Response('Not Found', { status: 404 })
  },
}

