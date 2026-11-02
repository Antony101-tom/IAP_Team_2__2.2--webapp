import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch, errorMessage, SERVER_DOWN_MESSAGE } from '../utils/api';
import { cap, fmtRange, toLocalInput } from '../utils/artisans';
import { ArtisanModal } from './ArtisanFinder';
import '../styles/artisans.css';

// Everything this pharmacy has booked through Find My Artisan. The list comes from Meditrac's own
// database (the partner cannot tell which pharmacy booked whom).
export default function BookedArtisans({ onToast, onFind }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState('upcoming'); // 'upcoming' | 'past'
  const [details, setDetails] = useState(null); // { id, finished } of the artisan whose profile is open
  const [rescheduling, setRescheduling] = useState(null); // the booking being moved

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    apiFetch('/api/artisans/bookings/mine', { auth: true })
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) { setBookings([]); setError(errorMessage(data, 'Could not load your bookings.')); }
        else setBookings(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
        setBookings([]);
        setError(SERVER_DOWN_MESSAGE);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [tick]);

  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const up = bookings.filter((b) => new Date(b.end).getTime() > now)
      .sort((a, b) => new Date(a.start) - new Date(b.start)); // soonest first
    const done = bookings.filter((b) => new Date(b.end).getTime() <= now)
      .sort((a, b) => new Date(b.start) - new Date(a.start)); // most recent first
    return { upcoming: up, past: done };
  }, [bookings]);

  const shown = tab === 'upcoming' ? upcoming : past;
  const statusOf = (b) => {
    const now = Date.now();
    if (new Date(b.end).getTime() <= now) return ['Completed', 'neutral'];
    if (new Date(b.start).getTime() <= now) return ['In progress', 'low'];
    return ['Upcoming', 'high'];
  };

  async function cancel(b) {
    if (!window.confirm(`Cancel ${b.artisan_name}'s booking on ${fmtRange(b.start, b.end)}?`)) return;
    try {
      const { ok, data } = await apiFetch(`/api/artisans/bookings/${encodeURIComponent(b.id)}`, { method: 'DELETE', auth: true });
      if (!ok) return onToast(errorMessage(data, 'Could not cancel the booking.'));
      onToast(data && data.released === false
        ? 'Booking removed from your list. Its time could not be freed at Find My Artisan.'
        : `Booking with ${b.artisan_name} cancelled.`);
      refresh();
    } catch (err) {
      console.error(err);
      onToast(SERVER_DOWN_MESSAGE);
    }
  }

  return (
    <>
      <div className="welcome-banner">
        <h1>Booked Artisans</h1>
        <p>The tradespeople your pharmacy has booked for maintenance and repair work.</p>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="artisan-tabs">
            <button className={tab === 'upcoming' ? 'active' : ''} onClick={() => setTab('upcoming')}>Upcoming &amp; current ({upcoming.length})</button>
            <button className={tab === 'past' ? 'active' : ''} onClick={() => setTab('past')}>Past ({past.length})</button>
          </div>
          <div className="panel-actions"><button onClick={onFind}>+ Book an artisan</button></div>
        </div>

        {loading ? (
          <p className="artisan-empty">Loading your bookings…</p>
        ) : error ? (
          <p className="artisan-empty" style={{ color: '#e53e3e' }}>
            {error} <button className="action-edit-btn" onClick={refresh}>Try again</button>
          </p>
        ) : shown.length === 0 ? (
          <p className="artisan-empty">
            {bookings.length === 0
              ? 'You have not booked any artisans yet. Use “Book an artisan” to find an electrician, plumber, carpenter or painter.'
              : tab === 'upcoming' ? 'No upcoming bookings.' : 'No past bookings yet.'}
          </p>
        ) : (
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr><th>Artisan</th><th>Trade</th><th>When</th><th>Job</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {shown.map((b) => {
                  const [label, kind] = statusOf(b);
                  const isPast = label === 'Completed';
                  return (
                    <tr key={b.id}>
                      <td>
                        <strong>{b.artisan_name}</strong>
                        <small className="artisan-sub">{[b.area, b.county].filter(Boolean).join(', ')}</small>
                      </td>
                      <td>{cap(b.trade)}</td>
                      <td>{fmtRange(b.start, b.end)}</td>
                      <td>{b.note || <span className="artisan-muted">—</span>}</td>
                      <td><span className={`status-badge ${kind}`}>{label}</span></td>
                      <td className="artisan-actions">
                        <button className="action-edit-btn" onClick={() => setDetails({ id: b.artisan_id, finished: isPast })}>{isPast ? 'Contact & review' : 'Contact'}</button>
                        {!isPast && <button className="action-edit-btn" onClick={() => setRescheduling(b)}>Reschedule</button>}
                        {!isPast && <button className="action-edit-btn danger" onClick={() => cancel(b)}>Cancel</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {details !== null && (
        <ArtisanModal id={details.id} canReview={details.finished} onClose={() => setDetails(null)} onChanged={refresh} onToast={onToast} />
      )}
      {rescheduling && (
        <RescheduleModal
          booking={rescheduling}
          onClose={() => setRescheduling(null)}
          onDone={() => { setRescheduling(null); onToast('Booking rescheduled.'); refresh(); }}
        />
      )}
    </>
  );
}

function RescheduleModal({ booking, onClose, onDone }) {
  const [start, setStart] = useState(toLocalInput(booking.start));
  const [end, setEnd] = useState(toLocalInput(booking.end));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    setError('');
    if (!start || !end) return setError('Choose when the work starts and ends.');
    const s = new Date(start), e = new Date(end);
    if (e <= s) return setError('The end must be after the start.');
    if (e < new Date()) return setError('That time is in the past.');
    setSaving(true);
    try {
      const { ok, data } = await apiFetch(`/api/artisans/bookings/${encodeURIComponent(booking.id)}`, {
        method: 'PATCH',
        auth: true,
        body: { start: s.toISOString(), end: e.toISOString() },
      });
      if (!ok) { setError(errorMessage(data, 'Could not change the booking.')); setSaving(false); return; }
      onDone();
    } catch (err) {
      console.error(err);
      setError(SERVER_DOWN_MESSAGE);
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box">
        <h3>Reschedule {booking.artisan_name}</h3>
        <p className="modal-sub">Currently {fmtRange(booking.start, booking.end)}. Confirm the new time with the artisan too.</p>
        <div className="form-row two-col">
          <div><label>From</label><input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div><label>Until</label><input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Close</button>
          <button className="btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save new time'}</button>
        </div>
      </div>
    </div>
  );
}
