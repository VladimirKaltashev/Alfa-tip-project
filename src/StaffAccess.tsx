import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LogIn, LogOut, ShieldCheck } from 'lucide-react';
import { venueId, venueUrl } from './tenant';
import './staff-access.css';
import { signInStaff, staffRequest, type StaffIdentity } from './staff-api';
import './demo-start.css';

function clearStaffCache() {
  const keys = Object.keys(sessionStorage).filter((key) => key.startsWith('alfa-tips-demo-v1:'));
  keys.forEach((key) => sessionStorage.removeItem(key));
  sessionStorage.removeItem('alfa-staff-context');
}

export function StaffAccess({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<StaffIdentity | null>(null);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [username, setUsername] = useState(''),
    [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const generation = useRef(0);
  const changingSession = useRef(false);
  async function inspect() {
    const version = generation.current;
    const who = await staffRequest<StaffIdentity>('/auth/session');
    if (version !== generation.current) return;
    sessionStorage.setItem('alfa-staff-context', JSON.stringify(who));
    setIdentity(who);
    setError('');
  }
  useEffect(() => {
    const check = () => {
      if (changingSession.current) return;
      const version = generation.current;
      return inspect()
        .catch((e) => {
          if (version !== generation.current) return;
          if (e.status === 401 || e.status === 403) {
            clearStaffCache();
            setIdentity(null);
          }
          if (e.status !== 401) setError(e.message);
        })
        .finally(() => setLoading(false));
    };
    void check();
    window.addEventListener('focus', check);
    const timer = setInterval(check, 60000);
    return () => {
      window.removeEventListener('focus', check);
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    const expired = () => {
      generation.current++;
      setIdentity(null);
      clearStaffCache();
      setError('Сессия завершена. Войдите снова.');
    };
    window.addEventListener('staff-session-expired', expired);
    return () => window.removeEventListener('staff-session-expired', expired);
  }, []);
  async function login(event: React.FormEvent) {
    event.preventDefault();
    if (changingSession.current) return;
    changingSession.current = true;
    generation.current++;
    setBusy(true);
    setError('');
    try {
      const who = await signInStaff(username, password);
      setPassword('');
      sessionStorage.setItem('alfa-staff-context', JSON.stringify(who));
      setIdentity(who);
      if ((who.role === 'employee') !== employeeRoute) {
        window.location.assign(venueUrl(who.role === 'employee' ? '/waiter' : '/bank'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось войти');
    } finally {
      changingSession.current = false;
      setBusy(false);
    }
  }
  async function logout() {
    if (changingSession.current) return;
    changingSession.current = true;
    generation.current++;
    setBusy(true);
    try {
      await staffRequest('/auth/logout', {});
      clearStaffCache();
      setIdentity(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось выйти');
    } finally {
      changingSession.current = false;
      setBusy(false);
    }
  }
  if (loading)
    return (
      <main className="staff-login" role="status">
        Проверяем доступ к кабинету…
      </main>
    );
  const employeeRoute =
    location.pathname.startsWith('/waiter') ||
    (location.pathname === '/help' &&
      new URLSearchParams(location.search).get('from') === 'waiter');
  const appropriate = identity && (identity.role === 'employee') === employeeRoute;
  if (identity)
    return (
      <>
        <div className="staff-session">
          {import.meta.env.DEV && <a href="/demo?venue=demo">Выбор роли в демо</a>}
          <span>
            <ShieldCheck size={17} />
            {identity.username} · {identity.role === 'manager' ? 'Менеджер' : 'Сотрудник'} ·{' '}
            {venueId}
          </span>
          <button onClick={logout} disabled={busy}>
            <LogOut size={16} /> Выйти
          </button>
        </div>
        {error && (
          <p role="alert" className="staff-error">
            {error}
          </p>
        )}
        {appropriate ? (
          <div key={identity.id}>{children}</div>
        ) : (
          <main className="staff-login">
            <h1>Откройте свой кабинет</h1>
            <p>Эта учётная запись не имеет доступа к выбранному разделу.</p>
            <a
              className="primary"
              href={venueUrl(identity.role === 'manager' ? '/manager' : '/waiter')}
            >
              В свой кабинет
            </a>
          </main>
        )}
      </>
    );
  return (
    <main className="staff-login">
      <a className="staff-brand" href={venueUrl('/bank')}>
        <span>А</span> Альфа-Банк
      </a>
      <span className="eyebrow">АЛЬФА ЧАЕВЫЕ · ПЕРСОНАЛ</span>
      <h1>Вход в кабинет заведения</h1>
      {import.meta.env.DEV && (
        <div className="staff-demo-entry">
          <b>Хотите посмотреть демонстрацию?</b>
          <span>Выберите роль — тестовый кабинет откроется без ручного ввода пароля.</span>
          <a className="primary" href="/demo?venue=demo">
            Открыть демонстрацию
          </a>
        </div>
      )}
      <p>
        Заведение: <b>{venueId}</b>. Войдите с учётной записью, выданной администратором или
        менеджером.
      </p>
      <form onSubmit={login}>
        <label>
          Логин
          <input
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={80}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label>
          Пароль
          <span className="staff-password">
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              aria-pressed={showPassword}
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? 'Скрыть' : 'Показать'}
            </button>
          </span>
        </label>
        {error && (
          <p className="staff-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          <LogIn size={18} />
          {busy ? 'Входим…' : 'Войти'}
        </button>
      </form>
      <a href={venueUrl('/')}>Я гость — оставить чаевые</a>
      <p className="quiet">Это вход в сервис чаевых. Не используйте пароль от Альфа-Банка.</p>
    </main>
  );
}
