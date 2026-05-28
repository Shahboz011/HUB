import { useState, useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { serverNow, syncServerTime, getClockDriftSecs } from '../lib/serverTime'

const NY = 'America/New_York'

// Full clock — used in EmployeeView sidebar
export function ServerClockFull() {
  const [time, setTime] = useState('')
  const [date, setDate] = useState('')
  const [drift, setDrift] = useState(0)

  useEffect(() => {
    syncServerTime()
    const syncId = setInterval(syncServerTime, 5 * 60 * 1000)

    function tick() {
      const now = new Date(serverNow())
      setTime(now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: NY }))
      setDate(now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: NY }))
      setDrift(getClockDriftSecs())
    }
    tick()
    const tickId = setInterval(tick, 1000)
    return () => { clearInterval(tickId); clearInterval(syncId) }
  }, [])

  const warn = drift > 120

  return (
    <div className={`srv-clock-full ${warn ? 'srv-clock-warn' : ''}`}>
      <div className="srv-clock-label-row">
        <span className="srv-clock-label">Server Time</span>
        {warn && (
          <span className="srv-clock-drift">
            <AlertTriangle size={10} />
            Clock off by {Math.round(drift / 60)}m — hours may be affected
          </span>
        )}
      </div>
      <div className="srv-clock-time-big">{time}</div>
      <div className="srv-clock-date-row">{date} · ET</div>
    </div>
  )
}

// Compact inline clock — used in AdminDashboard header
export function ServerClockCompact() {
  const [time, setTime] = useState('')
  const [date, setDate] = useState('')
  const [drift, setDrift] = useState(0)

  useEffect(() => {
    syncServerTime()
    const syncId = setInterval(syncServerTime, 5 * 60 * 1000)

    function tick() {
      const now = new Date(serverNow())
      setTime(now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: NY }))
      setDate(now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: NY }))
      setDrift(getClockDriftSecs())
    }
    tick()
    const tickId = setInterval(tick, 1000)
    return () => { clearInterval(tickId); clearInterval(syncId) }
  }, [])

  const warn = drift > 120

  return (
    <div className={`srv-clock-compact ${warn ? 'srv-clock-compact-warn' : ''}`}>
      <div className="srv-clock-compact-inner">
        <span className="srv-clock-compact-label">Server Time</span>
        <span className="srv-clock-compact-time">{time}</span>
        <span className="srv-clock-compact-date">{date}</span>
      </div>
      {warn && (
        <span className="srv-clock-compact-drift" title={`System clock is ${Math.round(drift / 60)} min off server time`}>
          <AlertTriangle size={11} />
          Clock mismatch
        </span>
      )}
    </div>
  )
}
