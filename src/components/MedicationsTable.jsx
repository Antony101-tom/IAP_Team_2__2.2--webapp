import { useState, useEffect } from 'react';

function MedicationsTable() {
  const [medications, setMedications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('http://localhost:5000/api/medications')
      .then((res) => {
        if (!res.ok) throw new Error('Network response was not ok');
        return res.json();
      })
      .then((data) => {
        setMedications(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) return <p>Loading medications...</p>;
  if (error) return <p>Error: {error}</p>;

  return (
    <table border="1" cellPadding="8" style={{ borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th>Name</th>
          <th>Form</th>
          <th>Category</th>
          <th>Quantity</th>
          <th>Unit</th>
          <th>Price</th>
          <th>Branch</th>
        </tr>
      </thead>
      <tbody>
        {medications.map((med) => (
          <tr key={med.id}>
            <td>{med.name}</td>
            <td>{med.form}</td>
            <td>{med.category}</td>
            <td>{med.quantity}</td>
            <td>{med.unit}</td>
            <td>{med.price}</td>
            <td>{med.branch}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default MedicationsTable;