import { createRoot } from 'react-dom/client';
import App, { ErrorBoundary } from './App';
import { StaffAccess } from './StaffAccess';
import { explicitVenueId, staffPage } from './tenant';
import StartPage from './StartPage';
const path = location.pathname.replace(/\/$/, '') || '/';
const startPage = path === '/demo' || (path === '/' && !explicitVenueId);
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    {startPage ? (
      <StartPage />
    ) : staffPage ? (
      <StaffAccess>
        <App />
      </StaffAccess>
    ) : (
      <App />
    )}
  </ErrorBoundary>,
);
