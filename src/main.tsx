import { createRoot } from 'react-dom/client';
import App, { ErrorBoundary } from './App';
import { StaffAccess } from './StaffAccess';
import { staffPage } from './tenant';
import { lazy, Suspense } from 'react';
const DemoStart = import.meta.env.DEV ? lazy(() => import('./DemoStart')) : null;
const demoPage = location.pathname.replace(/\/$/, '') === '/demo';
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    {demoPage && DemoStart ? (
      <Suspense fallback={<main className="staff-login">Загружаем демонстрацию…</main>}>
        <DemoStart />
      </Suspense>
    ) : staffPage ? (
      <StaffAccess>
        <App />
      </StaffAccess>
    ) : (
      <App />
    )}
  </ErrorBoundary>,
);
