// Stand-alone app for guests on /book/*: no sign-in, no staff providers.
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import BookingEnginePage from './BookingEnginePage';
import ManageBookingPage from './ManageBookingPage';

export default function PublicBookingApp() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/book/:engineId" element={<BookingEnginePage />} />
        <Route path="/book/:engineId/manage" element={<ManageBookingPage />} />
        <Route path="*" element={<div className="p-10 text-center text-stone-600">Page not found.</div>} />
      </Routes>
    </BrowserRouter>
  );
}
