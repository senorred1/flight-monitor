// Rate limiting: Track last API call time
let lastApiCall = 0
let lastMapChangeApiCall = 0
let API_CALL_INTERVAL = 30000 // 30 seconds in milliseconds (normal polling) - configurable
const MAP_CHANGE_API_INTERVAL = 3000 // 3 seconds in milliseconds (map zoom/pan changes)

// OAuth2 token cache (in-memory)
let tokenCache = {
  token: null,
  expiresAt: 0 // Timestamp when token expires
}
const TOKEN_EXPIRY_BUFFER = 5 * 60 * 1000 // Refresh token 5 minutes before expiry (in milliseconds)
const TOKEN_EXPIRY_TIME = 30 * 60 * 1000 // Tokens expire after 30 minutes (in milliseconds)

// Default monitoring region (Phoenix area)
const DEFAULT_REGION = {
  center: {
    lat: 33.47582267755572,
    lon: -111.70391851974681
  },
  radiusMiles: 3
}

// Store monitoring region in memory (in production, use Cloudflare KV or Durable Objects)
let MONITORING_REGION = DEFAULT_REGION

// Cache last successful flights data for map display (to prevent disappearing during rate limits)
let lastFlightsCache = {
  flights: [],
  timestamp: 0,
  bounds: null
}
const FLIGHTS_CACHE_MAX_AGE = 30 * 1000 // Cache flights for up to 30 seconds

// Aircraft database cache (per-record cache for on-demand lookups)
let aircraftRecordCache = {
  // Structure: { [icao24]: { data: {...}, timestamp: number } }
  records: {},
  maxSize: 1000 // Maximum number of records to cache
}
const AIRCRAFT_RECORD_CACHE_MAX_AGE = 60 * 60 * 1000 // Cache each record for 1 hour

// Test mode flag - set to false when ready to use real OpenSky API
const USE_SYNTHETIC_DATA = false

// Synthetic flight data for testing (Phoenix area)
const SYNTHETIC_FLIGHTS = [
  {
    icao24: 'abc123',
    callsign: 'TEST01',
    origin: 'KPHX',
    destination: 'KLAX',
    latitude: 33.47582267755572,
    longitude: -111.70391851974681,
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
  if (!region || !region.center || typeof region.radiusMiles !== 'number') {
    console.error('Invalid region provided to isPointInRegion:', region)
    return false
  }
  
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || isNaN(latitude) || isNaN(longitude)) {
    console.error('Invalid coordinates provided to isPointInRegion:', { latitude, longitude })
    return false
  }
  
  const distance = calculateDistance(
    region.center.lat,
    region.center.lon,
    latitude,
    longitude
  )
  return distance <= region.radiusMiles
}

/**
 * Get OAuth2 access token from OpenSky authentication server
 * Uses client credentials flow and caches the token in memory
 */
async function getAccessToken(clientId, clientSecret) {
  const now = Date.now()
  
  // Check if we have a valid token (not expired and not within buffer time)
  if (tokenCache.token && tokenCache.expiresAt > (now + TOKEN_EXPIRY_BUFFER)) {
    return tokenCache.token
  }

  // Token expired or doesn't exist, fetch a new one
  try {
    console.log('Fetching new OAuth2 access token from OpenSky...')
    
    const tokenUrl = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret
    })

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`OAuth2 token error: ${response.status} ${response.statusText}`, errorText)
      throw new Error(`Failed to obtain OAuth2 token: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    const accessToken = data.access_token

    if (!accessToken) {
      throw new Error('No access_token in OAuth2 response')
    }

    // Cache the token with expiration time
    tokenCache.token = accessToken
    tokenCache.expiresAt = now + TOKEN_EXPIRY_TIME

    console.log('OAuth2 token obtained and cached')
    return accessToken
  } catch (error) {
    console.error('Error obtaining OAuth2 token:', error.message || error)
    // Clear invalid cache
    tokenCache.token = null
    tokenCache.expiresAt = 0
    throw error
  }
}

/**
 * Fetch flight data from OpenSky API using OAuth2 Bearer token
 * @param {string} clientId - OAuth2 client ID
 * @param {string} clientSecret - OAuth2 client secret
 * @param {boolean} isMapChange - Whether this is triggered by a map zoom/pan change
 */
async function fetchOpenSkyData(clientId, clientSecret, isMapChange = false) {
  const now = Date.now()
  
  // Use different rate limits based on whether this is a map change
  const rateLimitInterval = isMapChange ? MAP_CHANGE_API_INTERVAL : API_CALL_INTERVAL
  const lastCallTime = isMapChange ? lastMapChangeApiCall : lastApiCall
  
  // Rate limiting check
  if (now - lastCallTime < rateLimitInterval) {
    const timeSince = Math.round((now - lastCallTime) / 1000)
    console.log(`Rate limit: Skipping API call (last ${isMapChange ? 'map change' : 'normal'} call was ${timeSince} seconds ago)`)
    return null
  }

  try {
    // Get access token (will use cached token if valid)
    const accessToken = await getAccessToken(clientId, clientSecret)
    
    const url = 'https://opensky-network.org/api/states/all'
    
    console.log('Fetching OpenSky data...')
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    })

    // Always update appropriate lastApiCall to enforce rate limiting, even on errors
    if (isMapChange) {
      lastMapChangeApiCall = now
    } else {
      lastApiCall = now
    }

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`OpenSky API error: ${response.status} ${response.statusText}`, errorText)
      
      // For unauthorized (401), try refreshing token and retry once
      if (response.status === 401) {
        console.log('Token expired or invalid, refreshing token and retrying...')
        // Clear cache to force token refresh
        tokenCache.token = null
        tokenCache.expiresAt = 0
        
        // Get a new token
        const newToken = await getAccessToken(clientId, clientSecret)
        
        // Retry the request with new token
        const retryResponse = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${newToken}`
          }
        })

        if (!retryResponse.ok) {
          const retryErrorText = await retryResponse.text()
          console.error(`OpenSky API retry error: ${retryResponse.status} ${retryResponse.statusText}`, retryErrorText)
          throw new Error(`OpenSky API error after token refresh: ${retryResponse.status} ${retryResponse.statusText}`)
        }

        const data = await retryResponse.json()
        const flightCount = data.states ? data.states.length : 0
        console.log(`OpenSky API returned ${flightCount} flights (after token refresh)`)
        return data.states || []
      }
      
      throw new Error(`OpenSky API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    const flightCount = data.states ? data.states.length : 0
    console.log(`OpenSky API returned ${flightCount} flights`)
    return data.states || []
  } catch (error) {
    console.error('Error fetching OpenSky data:', error.message || error)
    // lastApiCall already updated above, so rate limiting will work
    return null
  }
}

/**
 * Get aircraft information on-demand from R2 storage
 * Fetches individual JSON files per icao24 with caching
 * @param {Object} r2Bucket - R2 bucket binding
 * @param {string} icao24 - ICAO24 address (will be normalized to lowercase)
 * @returns {Promise<Object|null>} - Aircraft information object or null if not found
 */
async function getAircraftInfoOnDemand(r2Bucket, icao24) {
  if (!r2Bucket || !icao24) {
    return null
  }
  
  const now = Date.now()
  const normalizedIcao24 = icao24.toLowerCase()
  
  // Check cache first
  const cached = aircraftRecordCache.records[normalizedIcao24]
  if (cached && (now - cached.timestamp) < AIRCRAFT_RECORD_CACHE_MAX_AGE) {
    return cached.data
  }
  
  // Cache miss or expired - fetch from R2
  try {
    const objectKey = `aircraft/${normalizedIcao24}.json`
    const object = await r2Bucket.get(objectKey)
    
    if (!object) {
      // Record not found - cache null to avoid repeated lookups
      aircraftRecordCache.records[normalizedIcao24] = {
        data: null,
        timestamp: now
      }
      return null
    }
    
    // Parse the JSON file
    const jsonText = await object.text()
    const aircraftInfo = JSON.parse(jsonText)
    
    // Cache the result
    // Implement simple LRU: if cache is full, remove oldest entries
    const cacheKeys = Object.keys(aircraftRecordCache.records)
    if (cacheKeys.length >= aircraftRecordCache.maxSize && !aircraftRecordCache.records[normalizedIcao24]) {
      // Remove oldest 10% of entries
      const entriesToRemove = Math.floor(cacheKeys.length * 0.1)
      const sortedByTime = cacheKeys
        .map(key => ({ key, timestamp: aircraftRecordCache.records[key].timestamp }))
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(0, entriesToRemove)
      
      sortedByTime.forEach(({ key }) => {
        delete aircraftRecordCache.records[key]
      })
    }
    
    aircraftRecordCache.records[normalizedIcao24] = {
      data: aircraftInfo,
      timestamp: now
    }
    
    return aircraftInfo
  } catch (error) {
    console.error(`Error fetching aircraft info for ${normalizedIcao24}:`, error.message || error)
    return null
  }
}

/**
 * Decompress gzip data
 * @param {ArrayBuffer} compressedData - Gzipped data
 * @returns {Promise<Uint8Array>} - Decompressed data
 */
async function decompressGzip(compressedData) {
  // Use the built-in DecompressionStream API (available in Cloudflare Workers)
  const stream = new DecompressionStream('gzip')
  const writer = stream.writable.getWriter()
  const reader = stream.readable.getReader()
  
  // Write the compressed data
  await writer.write(compressedData)
  await writer.close()
  
  // Read all chunks
  const chunks = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
    }
  }
  
  // Combine chunks into a single Uint8Array
  if (chunks.length === 0) {
    return new Uint8Array(0)
  }
  
  if (chunks.length === 1) {
    return new Uint8Array(chunks[0])
  }
  
  // Multiple chunks - combine them
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  
  return result
}

/**
 * Get aircraft information from database by ICAO24 (legacy function - kept for compatibility)
 * Now uses on-demand lookups via getAircraftInfoOnDemand
 * @param {Object} r2Bucket - R2 bucket binding (replaces aircraftDb parameter)
 * @param {string} icao24 - ICAO24 address
 * @returns {Promise<Object|null>} - Aircraft information or null if not found
 */
async function getAircraftInfo(r2Bucket, icao24) {
  return await getAircraftInfoOnDemand(r2Bucket, icao24)
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
 * @param {Array} flights - Array of flight state arrays from OpenSky
 * @param {Object} r2Bucket - R2 bucket binding for on-demand aircraft lookups
 */
async function processFlights(flights, r2Bucket = null) {
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
    const onGround = flight[8] // on_ground flag
    
    // Skip aircraft that are on the ground
    if (onGround === true) {
      continue
    }
    
    if (latitude && longitude) {
      // Always verify the flight is actually in the monitoring region
      const inRegion = isPointInRegion(latitude, longitude, MONITORING_REGION)
      
      if (inRegion) {
        const airportInfo = getAirportInfo(flight[0], flight[1])
        const icao24 = flight[0]
        
        // Enrich with aircraft database information (on-demand lookup)
        const aircraftInfo = r2Bucket ? await getAircraftInfoOnDemand(r2Bucket, icao24) : null
        
        const flightData = {
          icao24: icao24,
          callsign: flight[1] || null,
          origin: airportInfo.origin,
          destination: airportInfo.destination,
          latitude,
          longitude,
          baroAltitude: flight[7],
          velocity: flight[9], // m/s
          heading: flight[10], // degrees
          verticalRate: flight[11], // m/s
          inRegion: true // Verified above - flight is in monitoring region
        }
        
        // Add aircraft database fields if available
        if (aircraftInfo) {
          if (aircraftInfo.registration) flightData.registration = aircraftInfo.registration
          if (aircraftInfo.typecode) flightData.aircraftType = aircraftInfo.typecode
          if (aircraftInfo.owner) flightData.owner = aircraftInfo.owner
          if (aircraftInfo.operator) flightData.operator = aircraftInfo.operator
          if (aircraftInfo.manufacturerName) flightData.manufacturer = aircraftInfo.manufacturerName
          if (aircraftInfo.model) flightData.model = aircraftInfo.model
          if (aircraftInfo.serialNumber) flightData.serialNumber = aircraftInfo.serialNumber
          if (aircraftInfo.operatorCallsign) flightData.operatorCallsign = aircraftInfo.operatorCallsign
          if (aircraftInfo.built) flightData.built = aircraftInfo.built
        }
        
        return flightData
      }
    }
  }

  return null
}

/**
 * Check if a point is within map bounds
 */
function isPointInBounds(latitude, longitude, bounds) {
  if (!bounds || !bounds.north || !bounds.south || !bounds.east || !bounds.west) {
    return false
  }
  
  // Handle longitude wrapping (east might be less than west if crossing 180/-180)
  const lonInBounds = bounds.west <= bounds.east
    ? (longitude >= bounds.west && longitude <= bounds.east)
    : (longitude >= bounds.west || longitude <= bounds.east)
  
  return latitude >= bounds.south && latitude <= bounds.north && lonInBounds
}

/**
 * Process flight states and return up to maxFlights that are within the map bounds
 * @param {Array} flights - Array of flight state arrays from OpenSky
 * @param {number} maxFlights - Maximum number of flights to return
 * @param {Object} bounds - Map bounds object {minLat, maxLat, minLon, maxLon}
 * @param {Object} r2Bucket - R2 bucket binding for on-demand aircraft lookups
 */
async function processMultipleFlights(flights, maxFlights = 10, bounds = null, r2Bucket = null) {
  if (!flights || flights.length === 0) {
    return []
  }

  const flightsInBounds = []
  
  // Collect all icao24s that need lookup (for potential batch optimization)
  const icao24sToLookup = []
  const flightMap = new Map() // Map icao24 to flight data (before enrichment)

  // First pass: filter flights and collect icao24s
  for (const flight of flights) {
    // Flight state format from OpenSky:
    // [icao24, callsign, origin_country, time_position, last_contact, longitude, latitude, 
    //  baro_altitude, on_ground, velocity, heading, vertical_rate, sensors, geo_altitude, 
    //  squawk, spi, position_source]
    
    const latitude = flight[6]
    const longitude = flight[5]
    const onGround = flight[8] // on_ground flag
    
    // Skip aircraft that are on the ground
    if (onGround === true) {
      continue
    }
    
    if (latitude && longitude) {
      // Always check if flight is in monitoring region (for card display)
      const inRegion = isPointInRegion(latitude, longitude, MONITORING_REGION)
      
      // If bounds provided, check if flight is in map bounds (for map display)
      // Otherwise, only show flights in monitoring region
      const inArea = bounds 
        ? isPointInBounds(latitude, longitude, bounds)
        : inRegion
      
      if (inArea) {
        const airportInfo = getAirportInfo(flight[0], flight[1])
        const icao24 = flight[0]
        
        const flightData = {
          icao24: icao24,
          callsign: flight[1] || null,
          origin: airportInfo.origin,
          destination: airportInfo.destination,
          latitude,
          longitude,
          baroAltitude: flight[7],
          velocity: flight[9], // m/s
          heading: flight[10], // degrees
          verticalRate: flight[11], // m/s
          inRegion: inRegion // Always correctly indicate if in monitoring region
        }
        
        flightMap.set(icao24, flightData)
        if (r2Bucket && icao24) {
          icao24sToLookup.push(icao24)
        }
        
        flightsInBounds.push(flightData)

        if (flightsInBounds.length >= maxFlights) {
          break
        }
      }
    }
  }

  // Second pass: enrich with aircraft database information (fetch in parallel)
  if (r2Bucket && icao24sToLookup.length > 0) {
    const lookupPromises = icao24sToLookup.map(icao24 => 
      getAircraftInfoOnDemand(r2Bucket, icao24).then(info => ({ icao24, info }))
    )
    
    const lookupResults = await Promise.all(lookupPromises)
    const infoMap = new Map(lookupResults.map(({ icao24, info }) => [icao24.toLowerCase(), info]))
    
    // Enrich flight data with aircraft information
    for (const flightData of flightsInBounds) {
      const aircraftInfo = infoMap.get(flightData.icao24?.toLowerCase())
      if (aircraftInfo) {
        if (aircraftInfo.registration) flightData.registration = aircraftInfo.registration
        if (aircraftInfo.typecode) flightData.aircraftType = aircraftInfo.typecode
        if (aircraftInfo.owner) flightData.owner = aircraftInfo.owner
        if (aircraftInfo.operator) flightData.operator = aircraftInfo.operator
        if (aircraftInfo.manufacturerName) flightData.manufacturer = aircraftInfo.manufacturerName
        if (aircraftInfo.model) flightData.model = aircraftInfo.model
        if (aircraftInfo.serialNumber) flightData.serialNumber = aircraftInfo.serialNumber
        if (aircraftInfo.operatorCallsign) flightData.operatorCallsign = aircraftInfo.operatorCallsign
        if (aircraftInfo.built) flightData.built = aircraftInfo.built
      }
    }
  }

  return flightsInBounds
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

/**
 * Generate multiple synthetic flights for map display (up to maxFlights)
 */
function getSyntheticFlights(maxFlights = 10, bounds = null) {
  const flights = []
  
  let minLat, maxLat, minLon, maxLon
  
  if (bounds) {
    // Use map bounds
    minLat = bounds.south
    maxLat = bounds.north
    minLon = bounds.west
    maxLon = bounds.east
  } else {
    // Fallback to monitoring region
    const center = MONITORING_REGION.center
    const radiusMiles = MONITORING_REGION.radiusMiles
    // Approximate bounds from center and radius
    const latOffset = radiusMiles / 69
    const lonOffset = radiusMiles / (69 * Math.cos(center.lat * Math.PI / 180))
    minLat = center.lat - latOffset
    maxLat = center.lat + latOffset
    minLon = center.lon - lonOffset
    maxLon = center.lon + lonOffset
  }
  
  // Generate 1-10 synthetic flights
  const numFlights = Math.floor(Math.random() * maxFlights) + 1
  
  for (let i = 0; i < numFlights; i++) {
    // Generate random position within bounds
    const randomLat = minLat + Math.random() * (maxLat - minLat)
    const randomLon = minLon + Math.random() * (maxLon - minLon)
    
    // Check if in monitoring region
    const inRegion = isPointInRegion(randomLat, randomLon, MONITORING_REGION)
    
    // Add some variation to flight data
    flights.push({
      icao24: `abc${String(i + 1).padStart(3, '0')}`,
      callsign: `TEST${String(i + 1).padStart(2, '0')}`,
      origin: 'KPHX',
      destination: 'KLAX',
      latitude: randomLat,
      longitude: randomLon,
      baroAltitude: 30000 + Math.random() * 10000,
      velocity: 200 + Math.random() * 100, // m/s
      heading: Math.random() * 360, // degrees
      verticalRate: (Math.random() - 0.5) * 10, // m/s
      inRegion: inRegion
    })
  }
  
  return flights
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

    // Debug endpoint to test R2 access
    if (url.pathname === '/api/debug-r2') {
      // Helper function to show last 4 digits
      const last4 = (str) => {
        if (!str || typeof str !== 'string') return null
        return str.length >= 4 ? str.slice(-4) : str
      }
      
      // Get R2 configuration info (from env vars if available, or from known config)
      const accountId = env.R2_ACCOUNT_ID || 'f4ff7aa620b854de61e0e3d9254fd1d1'
      const accessKeyId = env.R2_ACCESS_KEY_ID || '604a89c12dc65b1dbb11ed40088b7e80'
      const secretAccessKey = env.R2_SECRET_ACCESS_KEY || '9c4fe281cc7c101088e05cec9cefea3812af386bf47b38d8ff685d7317644430'
      const bucketName = env.R2_BUCKET_NAME || 'flight-monitor'
      
      const debugInfo = {
        hasR2Binding: !!env.AIRCRAFT_DB,
        r2BindingType: typeof env.AIRCRAFT_DB,
        r2BindingMethods: env.AIRCRAFT_DB ? Object.keys(env.AIRCRAFT_DB).filter(k => typeof env.AIRCRAFT_DB[k] === 'function') : [],
        r2Configuration: {
          accountIdLast4: last4(accountId),
          accessKeyIdLast4: last4(accessKeyId),
          secretAccessKeyLast4: last4(secretAccessKey),
          bucketName: bucketName,
          accountIdFromEnv: !!env.R2_ACCOUNT_ID,
          accessKeyIdFromEnv: !!env.R2_ACCESS_KEY_ID,
          secretAccessKeyFromEnv: !!env.R2_SECRET_ACCESS_KEY,
          bucketNameFromEnv: !!env.R2_BUCKET_NAME
        },
        cacheStatus: {
          cacheType: 'per-record',
          cachedRecords: Object.keys(aircraftRecordCache.records).length,
          maxCacheSize: aircraftRecordCache.maxSize,
          cacheTTLMinutes: AIRCRAFT_RECORD_CACHE_MAX_AGE / 1000 / 60,
          sampleCachedKeys: Object.keys(aircraftRecordCache.records).slice(0, 5)
        }
      }

      if (env.AIRCRAFT_DB) {
        try {
          // Try to list objects in the bucket
          let listResult = null
          let listError = null
          
          try {
            listResult = await env.AIRCRAFT_DB.list({
              limit: 10
            })
          } catch (listErr) {
            listError = {
              message: listErr.message,
              name: listErr.name,
              stack: listErr.stack
            }
            // Continue even if listing fails - we'll try direct access
            listResult = { objects: [], truncated: false, cursor: null }
          }
          
          debugInfo.bucketListing = {
            objects: listResult.objects.map(obj => ({
              key: obj.key,
              size: obj.size,
              uploaded: obj.uploaded ? new Date(obj.uploaded).toISOString() : null,
              etag: obj.etag || null,
              httpEtag: obj.httpEtag || null
            })),
            truncated: listResult.truncated || false,
            cursor: listResult.cursor || null,
            totalObjects: listResult.objects.length,
            allKeys: listResult.objects.map(obj => obj.key),
            listError: listError,
            note: listError ? 'Listing failed, but will try direct file access' : null
          }
          
          // Try to find and load the aircraft database
          // First, try the expected key directly (even if listing failed or returned empty)
          const expectedKey = 'aircraft-db.json.gz'
          let targetKey = null
          let foundObject = null
          
          // Check if expected key exists in the listing (if listing worked)
          const expectedKeyExists = listResult.objects.length > 0 && listResult.objects.some(obj => obj.key === expectedKey)
          
          if (expectedKeyExists) {
            targetKey = expectedKey
          } else if (listResult.objects.length > 0) {
            // Try to find any file that looks like an aircraft database
            // Look for files containing 'aircraft' (case-insensitive) and ending with .gz, .json.gz, or .json
            const aircraftDbKeys = listResult.objects
              .map(obj => obj.key)
              .filter(key => {
                const lowerKey = key.toLowerCase()
                return (lowerKey.includes('aircraft') || lowerKey.includes('db')) && 
                       (lowerKey.endsWith('.json.gz') || lowerKey.endsWith('.json') || lowerKey.endsWith('.gz'))
              })
            
            if (aircraftDbKeys.length > 0) {
              targetKey = aircraftDbKeys[0]
            } else {
              // If no obvious match, try the first file (might be the database with a different name)
              targetKey = listResult.objects[0].key
            }
          } else {
            // Listing returned empty or failed - try the expected key directly anyway
            // This handles the case where listing doesn't work but direct access does
            targetKey = expectedKey
          }
          
          debugInfo.searchStrategy = {
            expectedKey: expectedKey,
            expectedKeyFound: expectedKeyExists,
            targetKey: targetKey,
            allKeysInBucket: listResult.objects.map(obj => obj.key),
            listingWorked: !listError && listResult.objects.length >= 0,
            note: listResult.objects.length === 0 ? 'Listing returned empty - trying direct file access anyway' : null
          }
          
          // Always try to access the file, even if listing was empty
          if (targetKey) {
            try {
              foundObject = await env.AIRCRAFT_DB.get(targetKey)
              if (foundObject) {
                debugInfo.foundObject = {
                  key: targetKey,
                  size: foundObject.size,
                  uploaded: foundObject.uploaded ? new Date(foundObject.uploaded).toISOString() : null
                }
                
                // Try to load the database
                try {
                  const compressedData = await foundObject.arrayBuffer()
                  const decompressedData = await decompressGzip(compressedData)
                  const jsonText = new TextDecoder().decode(decompressedData)
                  const aircraftDb = JSON.parse(jsonText)
                  
                  debugInfo.loadTest = {
                    success: true,
                    entryCount: Object.keys(aircraftDb).length,
                    sampleEntries: Object.keys(aircraftDb).slice(0, 3).map(key => ({
                      icao24: key,
                      hasRegistration: !!aircraftDb[key].registration,
                      hasType: !!aircraftDb[key].typecode
                    })),
                    note: 'Legacy database format loaded. Individual files should be used for on-demand lookups.'
                  }
                  
                  // Also test on-demand lookup with a sample icao24
                  if (Object.keys(aircraftDb).length > 0) {
                    const sampleIcao24 = Object.keys(aircraftDb)[0]
                    try {
                      const onDemandResult = await getAircraftInfoOnDemand(env.AIRCRAFT_DB, sampleIcao24)
                      debugInfo.onDemandTest = {
                        sampleIcao24: sampleIcao24,
                        success: !!onDemandResult,
                        found: onDemandResult ? {
                          hasRegistration: !!onDemandResult.registration,
                          hasType: !!onDemandResult.typecode
                        } : null
                      }
                    } catch (onDemandError) {
                      debugInfo.onDemandTest = {
                        sampleIcao24: sampleIcao24,
                        success: false,
                        error: onDemandError.message
                      }
                    }
                  }
                } catch (loadError) {
                  debugInfo.loadTest = {
                    success: false,
                    error: loadError.message,
                    errorType: loadError.name,
                    note: 'File found but could not be loaded/decompressed. May not be a gzipped JSON file.'
                  }
                }
              } else {
                debugInfo.loadTest = {
                  success: false,
                  error: `Object ${targetKey} not found after listing`,
                  note: 'Key was in listing but get() returned null'
                }
              }
            } catch (getError) {
              debugInfo.loadTest = {
                success: false,
                error: getError.message,
                errorType: getError.name
              }
            }
          } else {
            debugInfo.loadTest = {
              success: false,
              error: 'No objects found in bucket to test',
              note: 'Bucket appears to be empty'
            }
          }
          
        } catch (error) {
          debugInfo.r2Error = {
            message: error.message,
            stack: error.stack,
            name: error.name
          }
        }
      } else {
        debugInfo.error = 'R2 binding not configured. Check wrangler.toml for [[r2_buckets]] binding.'
      }

      return new Response(
        JSON.stringify(debugInfo, null, 2),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      )
    }

    // Debug endpoint to test OpenSky API connectivity
    if (url.pathname === '/api/debug-opensky') {
      const clientId = env.OPENSKY_CLIENT_ID || ''
      const clientSecret = env.OPENSKY_CLIENT_SECRET || ''
      
      const debugInfo = {
        hasCredentials: !!(clientId && clientSecret),
        credentialsLength: {
          clientId: clientId ? clientId.length : 0,
          clientSecret: clientSecret ? clientSecret.length : 0
        },
        usingSyntheticData: USE_SYNTHETIC_DATA,
        monitoringRegion: MONITORING_REGION,
        lastApiCall: lastApiCall,
        timeSinceLastCall: lastApiCall ? Math.round((Date.now() - lastApiCall) / 1000) : null,
        rateLimitInterval: API_CALL_INTERVAL / 1000,
        tokenCache: {
          hasToken: !!tokenCache.token,
          expiresAt: tokenCache.expiresAt ? new Date(tokenCache.expiresAt).toISOString() : null,
          expiresIn: tokenCache.expiresAt ? Math.round((tokenCache.expiresAt - Date.now()) / 1000) : null
        }
      }

      if (clientId && clientSecret) {
        try {
          const testFlights = await fetchOpenSkyData(clientId, clientSecret)
          debugInfo.openSkyTest = {
            success: testFlights !== null,
            flightCount: testFlights ? testFlights.length : 0,
            sampleFlight: testFlights && testFlights.length > 0 ? {
              icao24: testFlights[0][0],
              callsign: testFlights[0][1],
              latitude: testFlights[0][6],
              longitude: testFlights[0][5]
            } : null
          }
        } catch (error) {
          debugInfo.openSkyTest = {
            success: false,
            error: error.message
          }
        }
      }

      return new Response(
        JSON.stringify(debugInfo, null, 2),
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
        const clientId = env.OPENSKY_CLIENT_ID || ''
        const clientSecret = env.OPENSKY_CLIENT_SECRET || ''
        
        if (!clientId || !clientSecret) {
          // Return empty result instead of error when credentials not configured
          return new Response(
            JSON.stringify({
              flight: null,
              timestamp: new Date().toISOString(),
              usingSyntheticData: false,
              error: 'OpenSky credentials not configured. Please set OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET secrets.'
            }),
            {
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            }
          )
        }

        const flights = await fetchOpenSkyData(clientId, clientSecret)
        if (flights) {
          console.log(`Processing ${flights.length} flights from OpenSky`)
          // Load aircraft database
          flight = await processFlights(flights, env.AIRCRAFT_DB)
          if (flight) {
            // Verify the flight is actually in region before returning
            const verifiedInRegion = isPointInRegion(flight.latitude, flight.longitude, MONITORING_REGION)
            if (!verifiedInRegion) {
              console.warn(`WARNING: Flight ${flight.callsign || flight.icao24} marked as inRegion but verification failed!`)
              flight = null
            } else {
              console.log(`Found flight in region: ${flight.callsign || flight.icao24} (lat: ${flight.latitude.toFixed(4)}, lon: ${flight.longitude.toFixed(4)})`)
            }
          } else {
            console.log('No flights found in monitoring region')
          }
        } else {
          console.log('No flights data returned from OpenSky (may be rate limited or error)')
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

    // API endpoint to get multiple flights for map display (up to 10)
    if (url.pathname === '/api/map-flights') {
      let flights = []
      
      // Get map bounds from query parameters
      let bounds = null
      const north = url.searchParams.get('north')
      const south = url.searchParams.get('south')
      const east = url.searchParams.get('east')
      const west = url.searchParams.get('west')
      
      if (north && south && east && west) {
        bounds = {
          north: parseFloat(north),
          south: parseFloat(south),
          east: parseFloat(east),
          west: parseFloat(west)
        }
      }

      if (USE_SYNTHETIC_DATA) {
        // Use synthetic data for testing
        flights = getSyntheticFlights(10, bounds)
      } else {
        // Use real OpenSky API
        const clientId = env.OPENSKY_CLIENT_ID || ''
        const clientSecret = env.OPENSKY_CLIENT_SECRET || ''
        
        if (!clientId || !clientSecret) {
          // Return empty flights array instead of error when credentials not configured
          return new Response(
            JSON.stringify({
              flights: [],
              timestamp: new Date().toISOString(),
              usingSyntheticData: false,
              error: 'OpenSky credentials not configured. Please set OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET secrets.'
            }),
            {
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            }
          )
        }

        // Check if this is a map change (zoom/pan) request
        const mapChanged = url.searchParams.get('mapChanged') === 'true'
        const openSkyFlights = await fetchOpenSkyData(clientId, clientSecret, mapChanged)
        if (openSkyFlights) {
          console.log(`Processing ${openSkyFlights.length} flights from OpenSky for map`)
          // Load aircraft database
          flights = await processMultipleFlights(openSkyFlights, 50, bounds, env.AIRCRAFT_DB)
          console.log(`Found ${flights.length} flights within map bounds`)
          
          // Cache the successful flights response
          lastFlightsCache = {
            flights: flights,
            timestamp: Date.now(),
            bounds: bounds
          }
        } else {
          console.log('No flights data returned from OpenSky for map (may be rate limited or error)')
          
          // If we have cached flights that are still valid, use them
          const cacheAge = Date.now() - lastFlightsCache.timestamp
          if (lastFlightsCache.flights.length > 0 && cacheAge < FLIGHTS_CACHE_MAX_AGE) {
            // Check if bounds are similar (within reasonable range)
            const boundsMatch = !bounds || !lastFlightsCache.bounds || 
              (Math.abs(bounds.north - lastFlightsCache.bounds.north) < 1 &&
               Math.abs(bounds.south - lastFlightsCache.bounds.south) < 1 &&
               Math.abs(bounds.east - lastFlightsCache.bounds.east) < 1 &&
               Math.abs(bounds.west - lastFlightsCache.bounds.west) < 1)
            
            if (boundsMatch) {
              console.log(`Using cached flights (${lastFlightsCache.flights.length} flights, ${Math.round(cacheAge / 1000)}s old)`)
              flights = lastFlightsCache.flights
            }
          }
        }
      }

      return new Response(
        JSON.stringify({
          flights,
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

    // Endpoint to update rate limit
    if (url.pathname === '/api/rate-limit' && request.method === 'POST') {
      try {
        const body = await request.json()
        const { rateLimitSeconds } = body

        // Validate rate limit
        if (typeof rateLimitSeconds !== 'number' || rateLimitSeconds < 1 || rateLimitSeconds > 300) {
          return new Response(
            JSON.stringify({ error: 'Invalid rate limit: must be between 1 and 300 seconds' }),
            {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            }
          )
        }

        // Update rate limit (convert seconds to milliseconds)
        API_CALL_INTERVAL = rateLimitSeconds * 1000

        return new Response(
          JSON.stringify({ 
            message: 'Rate limit updated successfully',
            rateLimitSeconds: rateLimitSeconds,
            rateLimitMilliseconds: API_CALL_INTERVAL
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

    // Endpoint to get current rate limit
    if (url.pathname === '/api/rate-limit' && request.method === 'GET') {
      return new Response(
        JSON.stringify({ 
          rateLimitSeconds: API_CALL_INTERVAL / 1000,
          rateLimitMilliseconds: API_CALL_INTERVAL
        }),
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

