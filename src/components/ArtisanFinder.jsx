import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch, errorMessage, SERVER_DOWN_MESSAGE } from '../utils/api';
import '../styles/artisans.css';

const TRADES = ['electrician', 'plumber', 'carpenter', 'painter'];
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

const fmt = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

// Busy windows can be { start, end } with or without an id, depending on the endpoint.
const busyList = (a) => (Array.isArray(a?.busy) ? a.busy : []);
const isBusyNow = (a) => {
  const now = Date.now();
  return busyList(a).some((b) => new Date(b.start).getTime() <= now && now < new Date(b.end).getTime());
};
const nextFree = (a) => {
  const now = Date.now();
  const upcoming = busyList(a).filter((b) => new Date(b.end).getTime() > now);
  return upcoming.length ? upcoming.sort((x, y) => new Date(x.start) - new Date(y.start))[0] : null;
};

const rateOf = (a) => a.hourly_rate ?? a.hourlyRate ?? a.rate ?? null;

function VerifiedBadge({ verified }) {
  return verified
    ? <span className="status-badge high">✔ Verified</span>
    : <span className="status-badge neutral">Not verified</span>;
}

export default function ArtisanFinder({ onToast }) {
  const [trade, setTrade] = useState('');
  const [county, setCounty] = useState('');
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [freeOnly, setFreeOnly] = useState(false);

  const [artisans, setArtisans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  const [openId, setOpenId] = useState(null);

  // Applied filters (the county box only searches when you press Search, not on every keystroke).
  const [applied, setApplied] = useState({ trade: '', county: '' });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    const qs = new URLSearchParams();
    if (applied.trade) qs.set('trade', applied.trade);
    if (applied.county) qs.set('county', applied.county);

    apiFetch(`/api/artisans${qs.toString() ? `?${qs}` : ''}`, { auth: true })
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) { setArtisans([]); setError(errorMessage(data, 'Could not load artisans.')); }
        else setArtisans(Array.isArray(data) ? data : data.artisans || data.data || []);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
        setArtisans([]);
        setError(SERVER_DOWN_MESSAGE);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [applied, tick]);

  const visible = useMemo(
    () => artisans.filter((a) => (!verifiedOnly || a.verified) && (!freeOnly || !isBusyNow(a))),
    [artisans, verifiedOnly, freeOnly]
  );

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  function search(e) {
    e.preventDefault();
    setApplied({ trade, county: county.trim() });
  }

  return (
    <>
      <div className="welcome-banner">
        <h1>Find My Artisan</h1>
        <p>Find and vet electricians, plumbers, carpenters and painters for maintenance and repair work at your pharmacy.</p>
      </div>

      <div className="panel">
        <form className="artisan-filters" onSubmit={search}>
          <div className="form-row">
            <label htmlFor="af-trade">Trade</label>
            <select id="af-trade" value={trade} onChange={(e) => { setTrade(e.target.value); setApplied((p) => ({ ...p, trade: e.target.value })); }}>
              <option value="">All trades</option>
              {TRADES.map((t) => <option key={t} value={t}>{cap(t)}</option>)}
            </select>
          </div>
          <div className="form-row">
            <label htmlFor="af-county">County</label>
            <input id="af-county" type="text" value={county} onChange={(e) => setCounty(e.target.value)} placeholder="e.g. Nairobi" />
          </div>
          <button type="submit" className="btn-primary artisan-search-btn">Search</button>
          <label className="artisan-check"><input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} /> Verified only</label>
          <label className="artisan-check"><input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} /> Free right now</label>
        </form>

        {loading ? (
          <p className="artisan-empty">Loading artisans… the first load can take up to a minute while the service wakes up.</p>
        ) : error ? (
          <p className="artisan-empty" style={{ color: '#e53e3e' }}>
            {error} <button className="action-edit-btn" onClick={refresh}>Try again</button>
          </p>
        ) : visible.length === 0 ? (
          <p className="artisan-empty">No artisans match these filters.</p>
        ) : (
          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr><th>Artisan</th><th>Trade</th><th>Where</th><th>Vetting</th><th>Availability</th><th></th></tr>
              </thead>
              <tbody>
                {visible.map((a) => {
                  const busyNow = isBusyNow(a);
                  const next = nextFree(a);
                  return (
                    <tr key={a.id}>
                      <td><strong>{a.name}</strong></td>
                      <td>{cap(a.trade)}</td>
                      <td>{[a.area, a.county].filter(Boolean).join(', ')}</td>
                      <td><VerifiedBadge verified={a.verified} /></td>
                      <td>
                        <span className={`status-badge ${busyNow ? 'low' : 'high'}`}>{busyNow ? 'Booked now' : 'Free now'}</span>
                        {next && !busyNow && <small className="artisan-sub">Next booked {fmt(next.start)}</small>}
                        {busyNow && next && <small className="artisan-sub">Until {fmt(next.end)}</small>}
                      </td>
                      <td><button className="action-edit-btn" onClick={() => setOpenId(a.id)}>View &amp; book</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openId !== null && (
        <ArtisanModal
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={refresh}
          onToast={onToast}
        />
      )}
    </>
  );
}

function ArtisanModal({ id, onClose, onChanged, onToast }) {
  const [artisan, setArtisan] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [tick, setTick] = useState(0);

  // Booking form
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [bookError, setBookError] = useState('');
  const [booking, setBooking] = useState(false);

  // Review form. Only reviews written in this session are listed, because that is all the pharmacy can edit.
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [posting, setPosting] = useState(false);
  const [myReviews, setMyReviews] = useState([]);
  const [editing, setEditing] = useState(null); // reviewId being edited

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/artisans/${encodeURIComponent(id)}`, { auth: true })
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) setLoadError(errorMessage(data, 'Could not load this artisan.'));
        else setArtisan(data);
      })
      .catch((err) => { if (!cancelled) { console.error(err); setLoadError(SERVER_DOWN_MESSAGE); } });
    return () => { cancelled = true; };
  }, [id, tick]);

  const reload = () => { setTick((t) => t + 1); onChanged(); };

  async function call(path, method, body) {
    try {
      return await apiFetch(`/api/artisans/${encodeURIComponent(id)}${path}`, { method, body, auth: true });
    } catch (err) {
      console.error(err);
      return { ok: false, data: { error: SERVER_DOWN_MESSAGE } };
    }
  }

  async function book() {
    setBookError('');
    if (!start || !end) return setBookError('Choose when the work starts and ends.');
    const s = new Date(start), e = new Date(end);
    if (e <= s) return setBookError('The end must be after the start.');
    if (s < new Date()) return setBookError('The start is in the past.');
    const clash = busyList(artisan).find((b) => s < new Date(b.end) && e > new Date(b.start));
    if (clash) return setBookError(`Already booked ${fmt(clash.start)} – ${fmt(clash.end)}. Pick another time.`);

    setBooking(true);
    const { ok, data } = await call('/availability', 'POST', { start: s.toISOString(), end: e.toISOString() });
    setBooking(false);
    if (!ok) return setBookError(errorMessage(data, 'Could not book this artisan.'));
    setStart(''); setEnd('');
    onToast(`${artisan.name} marked as booked.`);
    reload();
  }

  async function cancelBlock(blockId) {
    if (!window.confirm('Remove this booking?')) return;
    const { ok, data } = await call(`/availability/${encodeURIComponent(blockId)}`, 'DELETE');
    if (!ok) return onToast(errorMessage(data, 'Could not remove the booking.'));
    onToast('Booking removed.');
    reload();
  }

  async function submitReview() {
    setReviewError('');
    if (!(rating >= 1 && rating <= 5)) return setReviewError('Choose a rating from 1 to 5.');
    setPosting(true);
    const body = { rating: Number(rating), comment: comment.trim() };
    const { ok, data } = editing
      ? await call(`/reviews/${encodeURIComponent(editing)}`, 'PATCH', body)
      : await call('/reviews', 'POST', body);
    setPosting(false);
    if (!ok) return setReviewError(errorMessage(data, 'Could not save the review.'));

    const saved = { ...body, ...(data && typeof data === 'object' ? data : {}) };
    setMyReviews((list) => editing
      ? list.map((r) => (String(r.id) === String(editing) ? { ...r, ...saved, id: r.id } : r))
      : [...list, saved]);
    onToast(editing ? 'Review updated.' : 'Review posted.');
    setEditing(null); setComment(''); setRating(5);
  }

  async function removeReview(reviewId) {
    if (!window.confirm('Delete this review?')) return;
    const { ok, data } = await call(`/reviews/${encodeURIComponent(reviewId)}`, 'DELETE');
    if (!ok) return onToast(errorMessage(data, 'Could not delete the review.'));
    setMyReviews((list) => list.filter((r) => String(r.id) !== String(reviewId)));
    if (String(editing) === String(reviewId)) { setEditing(null); setComment(''); setRating(5); }
    onToast('Review deleted.');
  }

  const rate = artisan ? rateOf(artisan) : null;

  return (
    <div className="modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box artisan-modal">
        {loadError ? (
          <>
            <p className="form-error" style={{ marginTop: 0 }}>{loadError}</p>
            <div className="modal-actions"><button className="btn-secondary" onClick={onClose}>Close</button></div>
          </>
        ) : !artisan ? (
          <p className="artisan-empty">Loading profile…</p>
        ) : (
          <>
            <h3>{artisan.name}</h3>
            <p className="modal-sub">
              {cap(artisan.trade)} · {[artisan.area, artisan.county].filter(Boolean).join(', ')} <VerifiedBadge verified={artisan.verified} />
            </p>

            <div className="artisan-facts">
              <div><span>Phone</span>{artisan.phone ? <a href={`tel:${artisan.phone}`}>{artisan.phone}</a> : <em>Not listed</em>}</div>
              <div><span>Hourly rate</span>{rate != null ? <>KES {Number(rate).toLocaleString()}</> : <em>Not listed</em>}</div>
            </div>

            <h4>Already booked</h4>
            {busyList(artisan).length === 0 ? (
              <p className="artisan-sub">No bookings: fully free.</p>
            ) : (
              <ul className="artisan-list">
                {busyList(artisan).map((b, i) => (
                  <li key={b.id ?? `${b.start}-${i}`}>
                    <span>{fmt(b.start)} – {fmt(b.end)}</span>
                    {b.id != null && <button className="artisan-link danger" onClick={() => cancelBlock(b.id)}>Remove</button>}
                  </li>
                ))}
              </ul>
            )}

            <h4>Book for maintenance work</h4>
            <div className="form-row two-col">
              <div><label>From</label><input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></div>
              <div><label>Until</label><input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
            </div>
            {bookError && <div className="form-error">{bookError}</div>}
            <button className="btn-primary" disabled={booking} onClick={book}>{booking ? 'Booking…' : 'Mark as booked'}</button>
            <p className="artisan-sub">This reserves the time in Find My Artisan. Call the artisan to confirm the job and price.</p>

            <h4>Review after a job</h4>
            {myReviews.length > 0 && (
              <ul className="artisan-list">
                {myReviews.map((r, i) => (
                  <li key={r.id ?? i}>
                    <span>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)} {r.comment}</span>
                    {r.id != null && (
                      <span>
                        <button className="artisan-link" onClick={() => { setEditing(r.id); setRating(r.rating); setComment(r.comment || ''); }}>Edit</button>
                        <button className="artisan-link danger" onClick={() => removeReview(r.id)}>Delete</button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="form-row">
              <label>Rating</label>
              <select value={rating} onChange={(e) => setRating(Number(e.target.value))}>
                {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} – {['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'][n]}</option>)}
              </select>
            </div>
            <div className="form-row">
              <label>Comment</label>
              <input type="text" value={comment} maxLength={500} onChange={(e) => setComment(e.target.value)} placeholder="Was the work done well, on time, tidy?" />
            </div>
            {reviewError && <div className="form-error">{reviewError}</div>}
            <button className="btn-primary" disabled={posting} onClick={submitReview}>
              {posting ? 'Saving…' : editing ? 'Save changes' : 'Post review'}
            </button>
            {editing && <button className="btn-secondary" style={{ marginLeft: 8 }} onClick={() => { setEditing(null); setComment(''); setRating(5); }}>Cancel edit</button>}

            <div className="modal-actions"><button className="btn-secondary" onClick={onClose}>Close</button></div>
          </>
        )}
      </div>
    </div>
  );
}
