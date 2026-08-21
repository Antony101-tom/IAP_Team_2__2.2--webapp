# MediTrac

MediTrac helps patients find medications at nearby pharmacies and lets pharmacies manage what they have in stock.

- **Patients** can search for a medication, see which registered pharmacies carry it, and view them on a map sorted by distance.
- **Pharmacies** can register an account, pin their location on a map, and manage their medication inventory from a dashboard.
- Accounts, sessions, and inventory data are stored in the browser's `localStorage` — no backend required to try it out.

This is the React + Vite version of the app, built with `react-router-dom` for routing and plain `leaflet` for the maps.

## Getting Started

Clone the repo, then install and run:

```bash
git clone https://github.com/Antony101-tom/MEDITRAC-website-project.git
cd meditrac-react
npm install
npm run dev
```

Visit the printed local URL (typically `http://localhost:5173`), and allow location access when your browser prompts for it — this is what lets the app calculate distances to nearby pharmacies.

### Try it out

1. **Register a pharmacy account** and add a few medications to its stock, just like a real pharmacy would.
2. **Create a separate user (patient) account.**
3. Search for one of those medications from the user side — the pharmacy should show up with its distance.
4. Go back to the pharmacy dashboard and update the stock (e.g. change quantity or mark something out of stock), then check the user dashboard again — it updates live since both sides read from the same `localStorage` data.

To produce a production build:

```bash
npm run build
npm run preview   # serve the built dist/ folder locally to sanity check it
```

## Project Structure

```
meditrac-react/
├── index.html
├── public/
│   └── logos/
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   ├── index.css
│   ├── pages/
│   │   ├── HomePage.jsx
│   │   ├── RegisterPage.jsx
│   │   ├── UserDashboardPage.jsx
│   │   └── PharmacyDashboardPage.jsx
│   ├── components/
│   │   ├── Navbar.jsx
│   │   ├── PharmacyLocationPicker.jsx
│   │   ├── ResultsMap.jsx
│   │   └── AddMedicationModal.jsx
│   ├── utils/
│   │   ├── accounts.js
│   │   ├── medications.js
│   │   ├── geo.js
│   │   └── useGeolocation.js
│   └── styles/
```

## Notes

- Data is per-browser (stored in `localStorage`), so a pharmacy's inventory won't show up for a patient on a different browser or device.
- Only pharmacies registered through this app have map coordinates. Older test accounts without a pin will show "Distance unknown" and sort after pharmacies that do have one.

