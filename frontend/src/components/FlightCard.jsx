import './FlightCard.css'

function FlightCard({ flight }) {
  if (!flight) return null

  return (
    <div className="flight-card">
      <div className="card-content">
        <div className="card-header">
          <div className="aircraft-icon">✈️</div>
          <h1 className="tail-number">{flight.callsign || flight.icao24 || 'N/A'}</h1>
        </div>
        
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

