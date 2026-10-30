import { useEffect, useRef, useState } from 'react';
import { staffRequest } from './staff-api';

type AuditEvent = {
  id: number;
  actor: string;
  actor_name?: string | null;
  role: string;
  action: string;
  object_id: string | null;
  created_at: number;
  metadata: Record<string, unknown>;
};
type AuditPage = { events: AuditEvent[]; nextBefore: number | null };

const roles: Record<string, string> = {
  manager: 'Менеджер',
  employee: 'Сотрудник',
  guest: 'Гость',
  anonymous: 'Без входа',
  administrator: 'Администратор',
};
const fields: Record<string, string> = {
  venue: 'заведение',
  employees: 'команда',
  settings: 'правила распределения',
  profile: 'профиль',
  tips: 'чаевые и отзывы',
  withdrawals: 'выводы',
};
const labels: Record<string, string> = {
  'state.updated': 'Изменение данных',
  'payment.created': 'Чаевые отправлены',
  'withdrawal.created': 'Демовывод создан',
  'account.created': 'Доступ создан',
  'account.revoked': 'Доступ отключён',
  'login.succeeded': 'Вход в кабинет',
  'login.failed': 'Неуспешный вход',
  logout: 'Выход из кабинета',
  'venue.created': 'Заведение создано',
  'account.password_reset': 'Пароль изменён администратором',
};

export function AuditLog() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [action, setAction] = useState('');
  const [role, setRole] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const generation = useRef(0);

  async function load(before?: number) {
    const version = ++generation.current;
    setBusy(true);
    setError('');
    const query = new URLSearchParams();
    if (action) query.set('action', action);
    if (role) query.set('role', role);
    if (before) query.set('before', String(before));
    try {
      const page = await staffRequest<AuditPage>('/audit?' + query);
      if (version !== generation.current) return;
      setEvents((previous) => (before ? [...previous, ...page.events] : page.events));
      setNext(page.nextBefore);
    } catch (cause) {
      if (version === generation.current) {
        setError(cause instanceof Error ? cause.message : 'Не удалось загрузить журнал');
      }
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }

  useEffect(() => {
    setEvents([]);
    setNext(null);
    void load();
    return () => {
      generation.current++;
    };
  }, [action, role]);

  return (
    <section className="access-panel">
      <h1>Журнал действий</h1>
      <p>События вашего заведения. Время показано в часовом поясе устройства.</p>
      <div className="audit-filters">
        <label>
          Событие
          <select value={action} onChange={(event) => setAction(event.target.value)}>
            <option value="">Все события</option>
            {Object.entries(labels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Роль автора
          <select value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="">Все роли</option>
            {Object.entries(roles).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary" disabled={busy} onClick={() => load()}>
          Обновить журнал
        </button>
      </div>
      {error && (
        <p role="alert" className="staff-error">
          {error}
        </p>
      )}
      <p role="status" aria-live="polite">
        {busy
          ? 'Загружаем события…'
          : `Показано событий: ${events.length}${next ? '. Доступны более ранние записи.' : ''}`}
      </p>
      <div className="audit-list" aria-busy={busy}>
        {events.map((event) => (
          <article className="audit-event" key={event.id}>
            <b>{labels[event.action] || event.action}</b>
            <small>
              <time dateTime={new Date(event.created_at * 1000).toISOString()}>
                {new Date(event.created_at * 1000).toLocaleString('ru-RU')}
              </time>{' '}
              · {roles[event.role] || event.role}
            </small>
            <small>Автор: {event.actor_name || roles[event.role] || event.actor}</small>
            {event.object_id && (
              <small>
                Объект: <code>{event.object_id}</code>
              </small>
            )}
            {Array.isArray(event.metadata.fields) && (
              <small>
                Изменено:{' '}
                {event.metadata.fields
                  .map((value) => fields[String(value)] || String(value))
                  .join(', ')}
              </small>
            )}
          </article>
        ))}
      </div>
      {!busy && !events.length && !error && (
        <p>
          {action || role
            ? 'По выбранным фильтрам событий нет. Измените условия поиска.'
            : 'Событий пока нет.'}
        </p>
      )}
      {next && (
        <button className="secondary" disabled={busy} onClick={() => load(next)}>
          Показать ещё
        </button>
      )}
    </section>
  );
}
