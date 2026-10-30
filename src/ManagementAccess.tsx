import { useEffect, useRef, useState } from 'react';
import type { Store } from './model';
import { staffRequest } from './staff-api';
import { venueUrl } from './tenant';

type Account = { id: string; username: string; employee_id: string; active: number };

export function ManagementAccess({ store }: { store: Store }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [employee, setEmployee] = useState(store.employees[0]?.id || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const mutation = useRef(false);

  async function refresh() {
    setLoading(true);
    try {
      const result = await staffRequest<{ accounts: Account[] }>('/team/accounts');
      setAccounts(result.accounts);
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh().catch((cause) => setError(cause.message));
  }, []);

  async function mutate(body: unknown, path: string, success: string) {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await staffRequest(path, body);
      setPassword('');
      setMessage(success);
      try {
        await refresh();
      } catch {
        setError('Изменение сохранено, но список не обновился. Нажмите «Обновить список».');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось изменить доступ');
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }

  function create(event: React.FormEvent) {
    event.preventDefault();
    void mutate(
      { username, password, employeeId: employee },
      '/team/accounts',
      'Доступ создан. Передайте сотруднику логин и пароль по защищённому каналу.',
    );
  }

  return (
    <section className="access-panel">
      <h1>Доступ сотрудников</h1>
      <p>Каждый сотрудник входит под своим логином и видит только свой профиль и начисления.</p>
      {error && (
        <p role="alert" className="staff-error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {!store.employees.length ? (
        <div className="card padded">
          <h2>Сначала добавьте сотрудника</h2>
          <p>Учётная запись привязывается к профилю в команде заведения.</p>
          <a className="primary" href={venueUrl('/manager/team')}>
            Открыть команду
          </a>
        </div>
      ) : (
        <form className="card padded" onSubmit={create} aria-busy={busy}>
          <h2>Выдать доступ</h2>
          <fieldset disabled={busy || loading}>
            <label>
              Сотрудник
              <select
                required
                value={employee}
                onChange={(event) => setEmployee(event.target.value)}
              >
                <option value="" disabled>
                  Выберите сотрудника
                </option>
                {store.employees.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name} · {person.role}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Логин
              <input
                required
                minLength={3}
                maxLength={80}
                autoComplete="off"
                pattern="[A-Za-z0-9._@\-]+"
                aria-describedby="username-hint"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <small id="username-hint">3–80 латинских букв, цифр или символов . _ - @</small>
            <label>
              Пароль
              <input
                required
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                aria-describedby="password-hint"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <small id="password-hint">
              От 12 символов. Пароль не отображается в списке и не попадает в журнал.
            </small>
            <button className="primary" disabled={!employee}>
              {busy ? 'Сохраняем…' : 'Создать доступ'}
            </button>
          </fieldset>
        </form>
      )}
      <section className="card padded" aria-busy={loading}>
        <h2>Учётные записи</h2>
        <button
          className="secondary"
          disabled={busy || loading}
          onClick={() => {
            setError('');
            void refresh().catch((cause) => setError(cause.message));
          }}
        >
          Обновить список
        </button>
        {loading && <p role="status">Загружаем учётные записи…</p>}
        {!loading && loaded && !accounts.length && <p>Доступы ещё не созданы.</p>}
        {accounts.map((account) => (
          <div className="access-account" key={account.id}>
            <div>
              <b>{account.username}</b>
              <p>
                {store.employees.find((person) => person.id === account.employee_id)?.name ||
                  'Сотрудник удалён'}{' '}
                · {account.active ? 'Доступ открыт' : 'Доступ отключён'}
              </p>
            </div>
            {account.active === 1 && (
              <button
                className="secondary"
                disabled={busy || loading}
                aria-label={`Отключить доступ ${account.username}`}
                onClick={() =>
                  void mutate(
                    { id: account.id },
                    '/team/accounts/revoke',
                    'Доступ отключён. Активные сессии сотрудника завершены.',
                  )
                }
              >
                Отключить доступ
              </button>
            )}
          </div>
        ))}
      </section>
    </section>
  );
}
