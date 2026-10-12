import { useCallback, useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import AddMedicationModal from '../components/AddMedicationModal';
import PharmacyLocationPicker from '../components/PharmacyLocationPicker';
import { getSession, isLoggedInAs } from '../utils/accounts';
import { apiFetch, errorMessage, SERVER_DOWN_MESSAGE } from '../utils/api';
import { LOW_STOCK_THRESHOLD } from '../utils/medications';
import '../styles/pharmacy.css';

export default function PharmacyDashboardPage() {
  const [searchParams] = useSearchParams();
  useEffect(() => { document.title = 'Pharmacy Control Center - Meditrac'; }, []);

  // Only a logged-in pharmacy may see this page (checked after the hooks below).
  const authorized = isLoggedInAs('pharmacy');
  const session = getSession();
  const pharmacyName = (authorized && session.name) || 'Partner Pharmacy';
  const defaultBranch = searchParams.get('branch') || '';

  const [refreshTick, setRefreshTick] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState('');

  const [profile, setProfile] = useState(null); // { latitude, longitude, ... } from the API
  const hasPin = !!(profile && profile.latitude != null && profile.longitude != null);
  const [draftPin, setDraftPin] = useState(null);

  const handlePinChange = useCallback((lat, lng) => setDraftPin({ lat, lng }), []);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }

  async function savePin() {
    if (!draftPin) return;
    try {
      const { ok, data } = await apiFetch('/api/pharmacies/me/location', {
        method: 'PUT',
        auth: true,
        body: { latitude: draftPin.lat, longitude: draftPin.lng },
      });
      if (!ok) {
        showToast(errorMessage(data, 'Could not save your location.'));
        return;
      }
      setProfile(data);
      setDraftPin(null);
      showToast('Pharmacy location saved — patients can now see how far they are from you.');
    } catch (err) {
      console.error(err);
      showToast(SERVER_DOWN_MESSAGE);
    }
  }

  // This pharmacy's medications and profile come from the API (MySQL).
  const [meds, setMeds] = useState([]);
  const [medsLoading, setMedsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!authorized) return;
    let cancelled = false;
    setMedsLoading(true);
    setLoadError('');

    Promise.all([
      apiFetch('/api/medications/mine', { auth: true }),
      apiFetch('/api/pharmacies/me', { auth: true }),
    ])
      .then(([medsRes, profileRes]) => {
        if (cancelled) return;
        if (!medsRes.ok) {
          setMeds([]);
          setLoadError(errorMessage(medsRes.data, 'Could not load your medications.'));
        } else {
          setMeds(medsRes.data);
        }
        if (profileRes.ok) setProfile(profileRes.data);
        setMedsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error(err);
        setMeds([]);
        setLoadError(SERVER_DOWN_MESSAGE);
        setMedsLoading(false);
      });

    return () => { cancelled = true; };
  }, [authorized, refreshTick]);

  // Throws an Error whose message the modal shows if the server refuses the save.
  async function handleSave(newMedFields) {
    let result;
    try {
      result = await apiFetch('/api/medications', {
        method: 'POST',
        auth: true,
        body: { ...newMedFields, pharmacy_id: session.id },
      });
    } catch (err) {
      console.error(err);
      throw new Error(SERVER_DOWN_MESSAGE);
    }
    if (!result.ok) throw new Error(errorMessage(result.data, 'Could not save the medication.'));

    setRefreshTick((t) => t + 1);
    setModalOpen(false);
    showToast(`${result.data.name} added to your live inventory.`);
  }

  async function updateStock(id) {
    const med = meds.find((m) => m.id === id);
    if (!med) return;
    const next = prompt(`Update shelf quantity for ${med.name}:`, med.quantity);
    if (next === null) return;
    const parsed = Number(next);
    if (next.trim() === '' || !Number.isInteger(parsed) || parsed < 0) {
      alert('Please enter a whole-number quantity (0 or more).');
      return;
    }

    try {
      const { ok, data } = await apiFetch(`/api/medications/${id}/stock`, {
        method: 'PATCH',
        auth: true,
        body: { quantity: parsed },
      });
      if (!ok) {
        alert(errorMessage(data, 'Could not update the stock.'));
        return;
      }
      setRefreshTick((t) => t + 1);
      showToast(`${med.name} stock updated to ${parsed} ${med.unit || 'units'}.`);
    } catch (err) {
      console.error(err);
      alert(SERVER_DOWN_MESSAGE);
    }
  }

  if (!authorized) return <Navigate to="/register" replace />;

  return (
    <>
      <Navbar variant="dashboard" title="Partner Terminal" status="Store Profile Live" statusColor="#319795" />

      <div className="dashboard-container">
        <aside className="sidebar">
          <a href="#" className="sidebar-link active"> Manage Stock</a>
          <hr style={{ border: 0, borderTop: '1px solid #edf2f7', margin: '15px 0' }} />
        </aside>

        <main className="main-content">
          <div className="welcome-banner">
            <h1>Welcome back, {pharmacyName}!</h1>
            <p>Keep your shelf metrics precise to streamline walk-in patient processing tracks seamlessly.</p>
          </div>

          {!hasPin && (
            <div className="panel" style={{ marginBottom: '35px' }}>
              <div className="panel-header">
                <h3>Pin Your Pharmacy's Location</h3>
                <small style={{ color: '#718096', fontSize: '0.8rem' }}>
                  This is how patients will see how far they are from you — you only need to do this once.
                </small>
              </div>
              <PharmacyLocationPicker onChange={handlePinChange} height="420px" />
              <button
                className="submit-btn"
                style={{ marginTop: '14px', width: 'auto', padding: '10px 24px' }}
                disabled={!draftPin}
                onClick={savePin}
              >
                Save Location
              </button>
            </div>
          )}

          <div className="panel">
            <div className="panel-header">
              <h3>Pharmacy Shelf Inventory List</h3>
              <div className="panel-actions">
                <button onClick={() => setModalOpen(true)}>+ Add New Medication</button>
              </div>
            </div>

            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Medication Specifications</th>
                    <th>Classification Group</th>
                    <th>Shelf Quantity Status</th>
                    <th>Retail Unit Price</th>
                    <th>System Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {medsLoading ? (
                    <tr>
                      <td colSpan="5" style={{ textAlign: 'center', padding: '36px 20px', color: '#a0aec0' }}>
                        Loading medications...
                      </td>
                    </tr>
                  ) : loadError ? (
                    <tr>
                      <td colSpan="5" style={{ textAlign: 'center', padding: '36px 20px', color: '#e53e3e' }}>
                        {loadError}
                      </td>
                    </tr>
                  ) : meds.length === 0 ? (
                    <tr>
                      <td colSpan="5" style={{ textAlign: 'center', padding: '36px 20px', color: '#a0aec0' }}>
                        No medications added yet. Click "+ Add New Medication" above to get started.
                      </td>
                    </tr>
                  ) : (
                    meds.map((med) => {
                      const isLow = Number(med.quantity) <= LOW_STOCK_THRESHOLD;
                      const stockLabel = Number(med.quantity) === 0 ? 'Out of Stock' : isLow ? 'Low Stock' : 'In Stock';
                      return (
                        <tr key={med.id}>
                          <td><strong>{med.name}</strong><br /><small style={{ color: '#a0aec0' }}>{med.form || ''}</small></td>
                          <td>{med.category || ''}</td>
                          <td><span className={`status-badge ${isLow ? 'low' : 'high'}`}>{stockLabel} ({med.quantity} {med.unit || ''})</span></td>
                          <td style={{ fontWeight: 600, color: '#2d3748' }}>KES {Number(med.price).toLocaleString()}</td>
                          <td><button className="action-edit-btn" onClick={() => updateStock(med.id)}>Update Stock</button></td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>

      <AddMedicationModal
        open={modalOpen}
        defaultBranch={defaultBranch}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
      />

      <div className={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </>
  );
}