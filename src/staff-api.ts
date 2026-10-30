import { venueId } from './tenant.ts';

export type StaffIdentity = {
  id: string;
  tenant: string;
  username: string;
  role: 'manager' | 'employee';
  employee_id: string | null;
  expires_at: number;
};

/** Do not report a successful login until the browser can reuse its session cookie. */
export async function signInStaff(username: string, password: string): Promise<StaffIdentity> {
  await staffRequest('/auth/login', { username: username.trim(), password });
  try {
    return await staffRequest<StaffIdentity>('/auth/session');
  } catch (error) {
    if (error instanceof Error && 'status' in error && error.status === 401) {
      throw new Error(
        'Логин и пароль приняты, но сессия не сохранилась. Разрешите cookie для этого сайта и повторите вход на том же адресе.',
      );
    }
    throw error;
  }
}

export async function staffRequest<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(12000),
      headers: { 'Content-Type': 'application/json', 'X-Venue-ID': venueId },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error(
      'Нет ответа от сервера. Проверьте соединение. Если вы отправляли изменения, проверьте результат перед повтором.',
    );
  }

  // A failed login is not expiration of an existing personnel session.
  if (response.status === 401 && path !== '/auth/login' && path !== '/auth/session') {
    window.dispatchEvent(new Event('staff-session-expired'));
  }
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Сервис временно недоступен. Попробуйте обновить страницу позже.');
  }
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new Error('Сервер вернул некорректный ответ. Обновите страницу и проверьте результат.');
  }
  if (!response.ok) {
    const message =
      result && typeof result === 'object' && 'error' in result && typeof result.error === 'string'
        ? result.error
        : 'Не удалось выполнить запрос';
    throw Object.assign(new Error(message), { status: response.status });
  }
  return result as T;
}
