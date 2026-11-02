export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

export const fmt = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

// "Tue 5 Nov, 08:00 – 12:00" for a same-day window, otherwise both ends in full.
export function fmtRange(startIso, endIso) {
  const s = new Date(startIso);
  const e = new Date(endIso);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return `${startIso} – ${endIso}`;
  const time = { hour: '2-digit', minute: '2-digit' };
  if (s.toDateString() === e.toDateString()) {
    const day = s.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    return `${day}, ${s.toLocaleTimeString('en-KE', time)} – ${e.toLocaleTimeString('en-KE', time)}`;
  }
  return `${fmt(startIso)} – ${fmt(endIso)}`;
}

// <input type="datetime-local"> wants local time as "YYYY-MM-DDTHH:mm"
export function toLocalInput(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
