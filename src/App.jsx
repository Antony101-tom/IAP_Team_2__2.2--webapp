import { Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import RegisterPage from './pages/RegisterPage';
import UserDashboardPage from './pages/UserDashboardPage';
import PharmacyDashboardPage from './pages/PharmacyDashboardPage';
import MedicationsTable from './components/MedicationsTable';

export default function App() {
  return (
    <>
    <MedicationsTable />
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/dashboard/user" element={<UserDashboardPage />} />
      <Route path="/dashboard/pharmacy" element={<PharmacyDashboardPage />} />
    </Routes>
  </>
  );
}
