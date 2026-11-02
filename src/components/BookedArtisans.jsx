import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch, errorMessage, SERVER_DOWN_MESSAGE } from '../utils/api';
import { cap, fmtRange, toLocalInput } from '../utils/artisans';
import { ArtisanModal } from './ArtisanFinder';
import '../styles/artisans.css';

// Everything this pharmacy has booked through Find My Artisan. The list comes from Meditrac's own
// database (the partner cannot tell which pharmacy booked whom).
//
// A booking is "active" until the pharmacy says how it went: Done (the review unlocks) or Not done.
// The clock alone never marks a job as done, because only the pharmacy knows whether the work happened.
export default function BookedArtisans({ onToast, onFind }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [tab, setTab] = useState('active'); // 'active' | 'history'
  const [details, setDetails] = useState(null); // { id, canReview } of the artisan whose profile is open
  const [rescheduling, setRescheduling] = useState(null); // the booking being moved
  const [busyId, setBusyId] = useState(null); // booking with a request in flight

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

  const { active, history } = useMemo(() => {
    const act = bookings.filter((b) => b.status === 'booked')
      .sort((a, b) => new Date(a.start) - new Date(b.start)); // soonest first
    const done = bookings.filter((b) => b.status !== 'booked')
      .sort((a, b) => new Date(b.start) - new Date(a.start)); // most recent first
    return { active: act, history: done };
  }, [bookings]);

  const awaiting = active.filter((b) => new Date(b.end).getTime() <= Date.now()).length;
  const shown = tab === 'active' ? active : history;

  const hasStarted = (b) => new Date(b.start).getTime() <= Date.now();

  // [label, badge style]
  const statusOf = (b) => {
    if (b.status === 'done') return ['Done', 'high'];
    if (b.status === 'not_done') return ['Not done', 'neutral'];
    const now = Date.now();
    if (new Date(b.end).getTime() <= now) return ['Awaiting confirmation', 'low'];
    if (new Date(b.start).getTime() <= now) return ['In progress', 'low'];
    return ['Upcoming', 'high'];
  };

  async function setStatus(b, status) {
    setBusyId(b.id);
    try {
      const { ok, data } = await apiFetch(`/api/artisans/bookings/${encodeURIComponent(b.id)}/status`, {
        method: 'PATCH',
        auth: true,
        body: { status },
      });
      if (!ok) return onToast(errorMessage(data, 'Could not update the booking.'));
      onToast(
        status === 'done' ? `Marked as done. You can now review ${b.artisan_name} from History.`
          : status === 'not_done' ? 'Marked as not done.'
          : 'Moved back to Active.'
      );
      refresh();
    } catch (err) {
      console.error(err);
      onToast(SERVER_DOWN_MESSAGE);
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(b) {
    if (!window.confirm(`Cancel ${b.artisan_name}'s booking on ${fmtRange(b.start, b.end)}?`)) return;
    setBusyId(b.id);
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
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="welcome-banner">
        <h1>Booked Artisans</h1>
        <p>The tradespeople your pharmacy has booked for maintenance and repair work. Mark a job as done to review the artisan.</p>
      </div>

      {awaiting > 0 && (
        <div className="artisan-notice">
          {awaiting === 1 ? '1 booking is' : `${awaiting} bookings are`} past its end time and waiting for you to say how it went.
        </div>
      )}

      <div className="panel">
        <div className="panel-header">
          <div className="artisan-tabs">
            <button className={tab === 'active' ? 'active' : ''} onClick={() => setTab('active')}>Active ({active.length})</button>
            <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>History ({history.length})</button>
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
              : tab === 'active' ? 'No active bookings.' : 'Nothing in your history yet. Jobs you mark as done appear here.'}
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
                  const busy = busyId === b.id;
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
                        {b.status === 'booked' ? (
                          <>
                            {/* Can be marked from the start time on, so a job that finishes early can be closed early. */}
                            {hasStarted(b) && <button className="action-edit-btn primary" disabled={busy} onClick={() => setStatus(b, 'done')}>Mark done</button>}
                            {hasStarted(b) && <button className="action-edit-btn" disabled={busy} onClick={() => setStatus(b, 'not_done')}>Not done</button>}
                            <button className="action-edit-btn" onClick={() => setDetails({ id: b.artisan_id, canReview: false })}>Contact</button>
                            <button className="action-edit-btn" disabled={busy} onClick={() => setRescheduling(b)}>Reschedule</button>
                            <button className="action-edit-btn danger" disabled={busy} onClick={() => cancel(b)}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button className="action-edit-btn" onClick={() => setDetails({ id: b.artisan_id, canReview: b.status === 'done' })}>
                              {b.status === 'done' ? 'Review' : 'Contact'}
                            </button>
                            <button className="action-edit-btn" disabled={busy} onClick={() => setStatus(b, 'booked')}>Undo</button>
                          </>
                        )}
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
        <ArtisanModal id={details.id} canReview={details.canReview} onClose={() => setDetails(null)} onChanged={refresh} onToast={onToast} />
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
