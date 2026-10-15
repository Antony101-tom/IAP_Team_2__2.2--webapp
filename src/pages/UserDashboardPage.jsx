import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import ResultsMap from '../components/ResultsMap';
import { getSession, isLoggedInAs } from '../utils/accounts';
import { apiFetch, errorMessage, SERVER_DOWN_MESSAGE } from '../utils/api';
import { LOW_STOCK_THRESHOLD } from '../utils/medications';
import { haversineKm } from '../utils/geo';
import useGeolocation from '../utils/useGeolocation';
import '../styles/user-dashboard.css';

function formatBranch(branch) {
  const b = (branch || '').trim();
  return b ? b : 'Branch not specified by pharmacy';
}

export default function UserDashboardPage() {
  useEffect(() => { document.title = 'Patient Portal - Meditrac'; }, []);

  // Only a logged-in patient may see this page (checked after the hooks below).
  const authorized = isLoggedInAs('user');
  const session = getSession();
  const name = authorized ? session.name : null;
  const userLoc = useGeolocation();

  const [inputValue, setInputValue] = useState('');
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState('');

  // Every medication across all pharmacies, loaded once per page load. Each row
  // carries its pharmacy's name and map pin, so searching, grouping and sorting by
  // distance all happen in the browser without further requests.
  const [rawMedications, setRawMedications] = useState([]);
  const [trackedIds, setTrackedIds] = useState([]); // medication ids this patient tracks
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!authorized) return;
    let cancelled = false;

    Promise.all([apiFetch('/api/medications'), apiFetch('/api/tracking', { auth: true })])
      .then(([medsRes, trackRes]) => {
        if (cancelled) return;
        if (medsRes.ok) setRawMedications(medsRes.data);
        else setLoadError(errorMessage(medsRes.data, 'Could not load medications.'));
        if (trackRes.ok) setTrackedIds(trackRes.data);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
        setLoadError(SERVER_DOWN_MESSAGE);
      });

    return () => { cancelled = true; };
  }, [authorized]);

  // Annotate each medication with its pharmacy's coordinates (null if the pharmacy
  // hasn't pinned its location yet) and the distance from the patient.
  const medications = useMemo(
    () =>
      rawMedications.map((med) => {
        const hasCoords = typeof med.latitude === 'number' && typeof med.longitude === 'number';
        const _coords = hasCoords ? { lat: med.latitude, lng: med.longitude } : null;
        const _distanceKm =
          userLoc && _coords ? haversineKm(userLoc.lat, userLoc.lng, _coords.lat, _coords.lng) : null;
        return { ...med, _coords, _distanceKm };
      }),
    [rawMedications, userLoc]
  );

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 2200);
  }

  async function trackMedication(id) {
    try {
      const { ok, data } = await apiFetch('/api/tracking', { method: 'POST', auth: true, body: { medication_id: id } });
      if (!ok) {
        showToast(errorMessage(data, 'Could not add that tracker.'));
        return;
      }
      setTrackedIds((ids) => (ids.includes(id) ? ids : [id, ...ids]));
      const med = rawMedications.find((m) => m.id === id);
      showToast(med ? `${med.name} added to your trackers.` : 'Added to your trackers.');
    } catch (err) {
      console.error(err);
      showToast(SERVER_DOWN_MESSAGE);
    }
  }

  async function untrackMedication(id) {
    try {
      const { ok, data } = await apiFetch(`/api/tracking/${id}`, { method: 'DELETE', auth: true });
      if (!ok) {
        showToast(errorMessage(data, 'Could not remove that tracker.'));
        return;
      }
      setTrackedIds((ids) => ids.filter((x) => x !== id));
    } catch (err) {
      console.error(err);
      showToast(SERVER_DOWN_MESSAGE);
    }
  }

  const trackedMeds = trackedIds.map((id) => medications.find((m) => m.id === id)).filter(Boolean);

  const uniquePharmacies = new Set(trackedMeds.map((m) => m.pharmacy_id));
  const networkPharmacies = new Set(medications.map((m) => m.pharmacy_id));

  const isSearching = query.trim() !== '';

  // Derived search results: matches annotated with distance, grouped by drug
  // name, each group sorted nearest-first (falling back to cheapest-first
  // when distance isn't known), plus a per-pharmacy map dataset.
  const { groups, byPharmacy } = useMemo(() => {
    if (!isSearching) return { groups: [], byPharmacy: new Map() };

    const q = query.trim().toLowerCase();
    const matches = medications.filter(
      (med) => (med.name || '').toLowerCase().includes(q) || (med.category || '').toLowerCase().includes(q)
    );

    const groupMap = new Map();
    matches.forEach((med) => {
      const key = (med.name || '').trim().toLowerCase();
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key).push(med);
    });

    const groups = Array.from(groupMap.values()).map((group) => {
      const withDist = group.filter((m) => m._distanceKm !== null).sort((a, b) => a._distanceKm - b._distanceKm);
      const withoutDist = group.filter((m) => m._distanceKm === null).sort((a, b) => Number(a.price) - Number(b.price));
      return [...withDist, ...withoutDist];
    });

    const byPharmacy = new Map();
    matches.forEach((med) => {
      if (!med._coords) return;
      if (!byPharmacy.has(med.pharmacy)) {
        byPharmacy.set(med.pharmacy, { coords: med._coords, distanceKm: med._distanceKm, meds: [] });
      }
      byPharmacy.get(med.pharmacy).meds.push(med);
    });

    return { groups, byPharmacy };
  }, [isSearching, query, medications]);

  if (!authorized) return <Navigate to="/register" replace />;

  return (
    <>
      <Navbar variant="dashboard" title="Patient Dashboard" status="Account Verified" statusColor="#48bb78" />

      <div className="dashboard-container">
        <aside className="sidebar">
          <a href="#" className="sidebar-link active"> Find Medicine</a>
          <hr style={{ border: 0, borderTop: '1px solid #edf2f7', margin: '15px 0' }} />
        </aside>

        <main className="main-content">
          <div className="welcome-banner">
            <h1>{name ? `Welcome back, ${name}!` : 'Welcome back, Patient!'}</h1>
            <p>Run real-time stock searches across verified partner chemists in your estate line instantly.</p>
          </div>

          <div className="metrics-grid">
            <div className="u-card">
              <span>Active Trackers</span>
              <h3>{trackedMeds.length}</h3>
              <p>{trackedMeds.length === 0 ? 'No medicine tracked yet' : 'Updated just now'}</p>
            </div>
            <div className="u-card">
              <span>Saved Chemists</span>
              <h3>{uniquePharmacies.size}</h3>
              <p style={{ color: '#2b6cb0' }}>From your tracked medicine</p>
            </div>
            <div className="u-card">
              <span>Partner Network</span>
              <h3>{networkPharmacies.size}</h3>
              <p>Pharmacies live on Meditrac</p>
            </div>
          </div>

          {loadError && (
            <div className="empty-state" style={{ marginBottom: '20px', color: '#e53e3e' }}>
              <strong>{loadError}</strong>
            </div>
          )}

          <div className="search-hero-panel">
            <h3>Track Medicine Availability On-Demand</h3>
            <div className="input-wrapper">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') setQuery(inputValue); }}
                placeholder="Type drug name here (e.g., Insulin Lantus, Amoxicillin, Ventolin)..."
              />
              <button className="search-cta" onClick={() => setQuery(inputValue)}>Locate Stock Now</button>
            </div>
          </div>

          {isSearching && byPharmacy.size > 0 && (
            <div className="panel" style={{ marginBottom: '35px' }}>
              <div className="panel-header">
                <h3>Nearby Pharmacies</h3>
                <small style={{ color: '#718096', fontSize: '0.8rem' }}>
                  {userLoc ? 'Pins sorted by distance from your current location' : 'Allow location access in your browser to sort by distance'}
                </small>
              </div>
              <ResultsMap byPharmacy={byPharmacy} userLoc={userLoc} onTrack={trackMedication} />
            </div>
          )}

          <div className="feed-heading">
            <h3>{isSearching ? `Search Results for "${query}"` : 'Your Active Medicine Trackers'}</h3>
            {isSearching && (
              <small className="clear-search-link" onClick={() => { setInputValue(''); setQuery(''); }}>Clear search</small>
            )}
          </div>

          <div className="live-grid">
            {!isSearching && trackedMeds.length === 0 && (
              <div className="empty-state">
                <strong>You aren't tracking any medicine yet</strong>
                Search for a drug above and hit "Track" on a pharmacy's listing to follow its availability here.
              </div>
            )}

            {!isSearching &&
              trackedMeds.map((med) => {
                const isLow = Number(med.quantity) <= LOW_STOCK_THRESHOLD;
                const accent = isLow ? '#dd6b20' : '#2b6cb0';
                const note =
                  med.quantity <= 0
                    ? 'Out of stock'
                    : isLow
                    ? `Only ${med.quantity} ${med.unit || 'units'} remaining`
                    : `${med.quantity} ${med.unit || 'units'} in stock`;
                return (
                  <div className="med-card" key={med.id} style={{ borderTop: `4px solid ${accent}` }}>
                    <div className="med-meta">
                      <div className="med-title">
                        <h4>{med.name}</h4>
                        <span>{med.category || ''}{med.form ? ` • ${med.form}` : ''}</span>
                      </div>
                    </div>
                    <p className="pharmacy-detail">
                      {note} at <strong>{med.pharmacy}</strong>. Pricing logged at KES {Number(med.price).toLocaleString()} per{' '}
                      {(med.unit || 'unit').toLowerCase().replace(/s$/, '')}.
                    </p>
                    <div className="location-tag"> {formatBranch(med.branch)}</div>
                    <div style={{ marginTop: '10px', textAlign: 'right' }}>
                      <button className="untrack-btn" onClick={() => untrackMedication(med.id)}>Stop Tracking</button>
                    </div>
                  </div>
                );
              })}

            {isSearching && groups.length === 0 && (
              <div className="empty-state">
                <strong>"{query}" is unavailable</strong>
                None of our partner pharmacies currently list this medicine. Try a different name, or check back later.
              </div>
            )}

            {isSearching &&
              groups.map((group) => {
                const first = group[0];
                const anyLow = group.some((m) => Number(m.quantity) <= LOW_STOCK_THRESHOLD && Number(m.quantity) > 0);
                const accent = anyLow ? '#dd6b20' : '#2b6cb0';
                const sortLabel = group.some((m) => m._distanceKm !== null) ? 'sorted by distance' : 'sorted by lowest price';

                return (
                  <div className="med-card" key={first.name} style={{ borderTop: `4px solid ${accent}` }}>
                    <div className="med-meta">
                      <div className="med-title">
                        <h4>{first.name}</h4>
                        <span>{first.category || ''}{first.form ? ` • ${first.form}` : ''}</span>
                      </div>
                    </div>
                    {group.length > 1 && (
                      <div className="multi-pharmacy-note">Available at {group.length} partner pharmacies — {sortLabel}</div>
                    )}
                    <div className="pharmacy-options">
                      {group.map((med) => {
                        const isLow = Number(med.quantity) <= LOW_STOCK_THRESHOLD;
                        const tracked = trackedIds.includes(med.id);
                        return (
                          <div className="pharmacy-option" key={med.id}>
                            <div className="po-info">
                              <strong>{med.pharmacy}</strong>
                              <span className="po-sub">{formatBranch(med.branch)}</span>
                              {med._distanceKm !== null && <span className="po-sub">{med._distanceKm.toFixed(1)} km away</span>}
                            </div>
                            <div className={`po-stock ${isLow ? 'low' : ''}`}>
                              {med.quantity > 0
                                ? `${isLow ? 'Low Stock' : 'In Stock'} • ${med.quantity} ${med.unit || 'units'} left`
                                : 'Out of Stock'}{' '}
                              — KES {Number(med.price).toLocaleString()}
                            </div>
                            <button
                              className={`track-btn ${tracked ? 'tracked' : ''}`}
                              disabled={tracked}
                              onClick={() => trackMedication(med.id)}
                            >
                              {tracked ? '✓ Tracked' : 'Track'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
          </div>
        </main>
      </div>

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </>
  );
}
