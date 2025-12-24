import './FlightCard.css'

function FlightCard({ flight }) {
  if (!flight) return null

  return (
    <div className="flight-card">
      <div className="card-content">
        <div className="card-header">
          <div className="aircraft-icon">✈️</div>
          <h1 className="tail-number">{flight.registration || flight.callsign || flight.icao24 || 'N/A'}</h1>
          {flight.callsign && flight.callsign !== (flight.registration || flight.icao24) && (
            <div className="callsign-subtitle">{flight.callsign}</div>
          )}
          {/* Prominently display aircraft registration fields */}
          {(flight.aircraftType || flight.typecode) && (
            <div className="aircraft-type-header">
              {flight.aircraftType || flight.typecode}
            </div>
          )}
          {flight.operator && (
            <div className="operator-header">{flight.operator}</div>
          )}
          {(flight.manufacturer || flight.model) && (
            <div className="aircraft-model-header">
              {[flight.manufacturer, flight.model].filter(Boolean).join(' ')}
            </div>
          )}
        </div>
        
        {/* Aircraft Information Section */}
        {(flight.registration || flight.aircraftType || flight.manufacturer || flight.model || flight.owner || flight.operator) && (
          <>
            <div className="aircraft-details">
              <h2 className="section-title">Aircraft Details</h2>
              {flight.operator && (
                <div className="info-row">
                  <div className="info-label">Operator</div>
                  <div className="info-value">{flight.operator}</div>
                </div>
              )}
              {flight.manufacturer && (
                <div className="info-row">
                  <div className="info-label">Manufacturer</div>
                  <div className="info-value">{flight.manufacturer}</div>
                </div>
              )}
              {flight.model && (
                <div className="info-row">
                  <div className="info-label">Model</div>
                  <div className="info-value">{flight.model}</div>
                </div>
              )}
              {(flight.aircraftType || flight.typecode) && (
                <div className="info-row">
                  <div className="info-label">Type Code</div>
                  <div className="info-value">{flight.aircraftType || flight.typecode}</div>
                </div>
              )}
              {flight.registration && (
                <div className="info-row">
                  <div className="info-label">Registration</div>
                  <div className="info-value">{flight.registration}</div>
                </div>
              )}
              {flight.owner && flight.owner !== flight.operator && (
                <div className="info-row">
                  <div className="info-label">Owner</div>
                  <div className="info-value">{flight.owner}</div>
                </div>
              )}
              {flight.built && (
                <div className="info-row">
                  <div className="info-label">Year Built</div>
                  <div className="info-value">{flight.built}</div>
                </div>
              )}
            </div>
            <div className="info-divider"></div>
          </>
        )}
        
        <div className="flight-info">
          <div className="info-row">
            <div className="info-label">Origin</div>
            <div className="info-value">{flight.origin || 'Unknown'}</div>
          </div>
          
          <div className="info-divider"></div>
          
          <div className="info-row">
            <div className="info-label">Destination</div>
            <div className="info-value">{flight.destination || 'Unknown'}</div>
          </div>
        </div>

        <div className="card-footer">
          <div className="footer-grid">
            <div className="footer-item">
              <span className="footer-label">Altitude</span>
              <span className="footer-value">
                {flight.baroAltitude ? `${Math.round(flight.baroAltitude * 3.28084)} ft` : 'N/A'}
              </span>
            </div>
            <div className="footer-item">
              <span className="footer-label">Velocity</span>
              <span className="footer-value">
                {flight.velocity ? `${Math.round(flight.velocity * 2.237)} mph` : 'N/A'}
              </span>
            </div>
            <div className="footer-item">
              <span className="footer-label">Heading</span>
              <span className="footer-value">
                {flight.heading !== null && flight.heading !== undefined ? `${Math.round(flight.heading)}°` : 'N/A'}
              </span>
            </div>
            <div className="footer-item">
              <span className="footer-label">Vertical Rate</span>
              <span className="footer-value">
                {flight.verticalRate !== null && flight.verticalRate !== undefined 
                  ? `${flight.verticalRate > 0 ? '+' : ''}${Math.round(flight.verticalRate * 196.85)} fpm`
                  : 'N/A'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default FlightCard

