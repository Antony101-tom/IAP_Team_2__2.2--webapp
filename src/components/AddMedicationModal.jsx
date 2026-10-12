import { useEffect, useState } from 'react';

export default function AddMedicationModal({ open, defaultBranch, onClose, onSave }) {
  const [form, setForm] = useState({ name: '', form_: '', category: '', quantity: '', unit: '', price: '', branch: '' });
  const [error, setError] = useState(''); // message to show, or '' for none
  const [saving, setSaving] = useState(false);

  // Reset the form fresh every time the modal opens, same as the vanilla
  // openAddModal() which cleared inputs and re-applied the default branch.
  useEffect(() => {
    if (open) {
      setForm({ name: '', form_: '', category: '', quantity: '', unit: '', price: '', branch: defaultBranch || '' });
      setError('');
      setSaving(false);
    }
  }, [open, defaultBranch]);

  if (!open) return null;

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function submit() {
    const name = form.name.trim();
    if (!name || form.quantity === '' || form.price === '') {
      setError('Please fill in the medication name, quantity, and price.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      // onSave may be async and may throw with a message to show (e.g. a server error)
      await onSave({
        name,
        form: form.form_.trim(),
        category: form.category.trim() || 'General',
        quantity: Number(form.quantity),
        unit: form.unit.trim() || 'Units',
        price: Number(form.price),
        branch: form.branch.trim() || defaultBranch || '',
      });
    } catch (err) {
      setError(err.message || 'Could not save the medication.');
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box">
        <h3>Add New Medication</h3>
        <p className="modal-sub">This pushes straight to your live shelf inventory, and becomes searchable to patients immediately.</p>

        <div className="form-row">
          <label>Medication Name</label>
          <input type="text" value={form.name} onChange={update('name')} placeholder="e.g. Paracetamol 500mg" />
        </div>
        <div className="form-row">
          <label>Form / Pack Details</label>
          <input type="text" value={form.form_} onChange={update('form_')} placeholder="e.g. Tablets • 10x10 pack" />
        </div>
        <div className="form-row">
          <label>Classification Group</label>
          <input type="text" value={form.category} onChange={update('category')} placeholder="e.g. Analgesic / Pain Relief" />
        </div>
        <div className="form-row two-col">
          <div>
            <label>Shelf Quantity</label>
            <input type="number" min="0" value={form.quantity} onChange={update('quantity')} placeholder="e.g. 40" />
          </div>
          <div>
            <label>Unit Label</label>
            <input type="text" value={form.unit} onChange={update('unit')} placeholder="e.g. Boxes / Vials" />
          </div>
        </div>
        <div className="form-row two-col">
          <div>
            <label>Retail Unit Price (KES)</label>
            <input type="number" min="0" value={form.price} onChange={update('price')} placeholder="e.g. 650" />
          </div>
          <div>
            <label>Branch</label>
            <input type="text" value={form.branch} onChange={update('branch')} placeholder="e.g. Kilimani Branch" />
          </div>
        </div>
        {error && <p className="form-error">{error}</p>}

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={saving}>{saving ? 'Saving...' : 'Save to Inventory'}</button>
        </div>
      </div>
    </div>
  );
}
