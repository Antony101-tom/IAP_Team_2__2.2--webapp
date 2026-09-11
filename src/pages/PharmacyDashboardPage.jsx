import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import AddMedicationModal from '../components/AddMedicationModal';
import PharmacyLocationPicker from '../components/PharmacyLocationPicker';
import { getSession, loadAccounts, findAccount, updateAccountCoords } from '../utils/accounts';
import { loadAllMedications, saveMedications, LOW_STOCK_THRESHOLD } from '../utils/medications';
import '../styles/pharmacy.css';

export default function PharmacyDashboardPage() {
  const [searchParams] = useSearchParams();
  useEffect(() => { document.title = 'Pharmacy Control Center - Meditrac'; }, []);
  const session = getSession();

  const pharmacyName = searchParams.get('name') || (session && session.type === 'pharmacy' ? session.name : null) || 'Partner Pharmacy';
  const defaultBranch = searchParams.get('branch') || '';

  const [refreshTick, setRefreshTick] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState('');

  const account = useMemo(
    () => (session && session.type === 'pharmacy' ? findAccount(loadAccounts(), 'pharmacy', session.email) : null),
    [session, refreshTick]
  );
  const hasPin = !!(account && account.latitude != null && account.longitude != null);
  const [draftPin, setDraftPin] = useState(null);

  const handlePinChange = useCallback((lat, lng) => setDraftPin({ lat, lng }), []);

  function savePin() {
    if (!draftPin || !session) return;
    updateAccountCoords('pharmacy', session.email, draftPin.lat, draftPin.lng);
    setDraftPin(null);
    setRefreshTick((t) => t + 1);
    showToast('Pharmacy location saved — patients can now see how far they are from you.');
  }

  // Real medication data now comes from Supabase, filtered by this pharmacy's name.
  const [meds, setMeds] = useState([]);
  const [medsLoading, setMedsLoading] = useState(true);

  useEffect(() => {
    setMedsLoading(true);
    fetch(`http://localhost:5000/api/medications/by-pharmacy?name=${encodeURIComponent(pharmacyName)}`)
      .then((res) => res.json())
      .then((data) => {
        setMeds(Array.isArray(data) ? data : []);
        setMedsLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setMeds([]);
        setMedsLoading(false);
      });
  }, [pharmacyName, refreshTick]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }

  // NOTE: Add/Update still write to localStorage for now — not yet wired to Supabase.
  function handleSave(newMedFields) {
    const newMed = { id: 'm' + Date.now(), pharmacy: pharmacyName, ...newMedFields };
    const all = loadAllMedications();
    all.push(newMed);
    saveMedications(all);
    setRefreshTick((t) => t + 1);
    setModalOpen(false);
    showToast(`${newMed.name} added to your live inventory.`);
  }

  function updateStock(id) {
    const all = loadAllMedications();
    const med = all.find((m) => m.id === id && m.pharmacy === pharmacyName);
    if (!med) return;
    const next = prompt(`Update shelf quantity for ${med.name}:`, med.quantity);
    if (next === null) return;
    const parsed = Number(next);
    if (Number.isNaN(parsed) || parsed < 0) {
      alert('Please enter a valid quantity.');
      return;
    }
    med.quantity = parsed;
    saveMedications(all);
    setRefreshTick((t) => t + 1);
    showToast(`${med.name} stock updated to ${parsed} ${med.unit}.`);
  }

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
                  ) : meds.length === 0 ? (
                    <tr>
                      <td colSpan="5" style={{ textAlign: 'center', padding: '36px 20px', color: '#a0aec0' }}>
                        No medications added yet. Click "+ Add New Medication" above to get started.
                      </td>
                    </tr>
                  ) : (
                    meds.map((med) => {
                      const isLow = Number(med.quantity) <= LOW_STOCK_THRESHOLD;
                      return (
                        <tr key={med.id}>
                          <td><strong>{med.name}</strong><br /><small style={{ color: '#a0aec0' }}>{med.form || ''}</small></td>
                          <td>{med.category || ''}</td>
                          <td><span className={`status-badge ${isLow ? 'low' : 'high'}`}>{isLow ? 'Low Stock' : 'In Stock'} ({med.quantity} {med.unit || ''})</span></td>
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