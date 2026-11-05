import { KEY, seed, freshDraft, upgradeDraft, upgradeStore } from './model.ts';
import type { Store, Draft, Tip } from './model';
import { venueId, staffPage } from './tenant.ts';

export const DRAFT_KEY = 'alfa-tips-draft-v3:' + venueId;
const API = '/api';
class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function isStore(value: unknown): value is Store {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as Store).version === 1 &&
    Array.isArray((value as Store).tips) &&
    Array.isArray((value as Store).employees)
  );
}
function cache() {
  return staffPage ? sessionStorage : localStorage;
}
function cacheKey() {
  let user = 'guest';
  if (staffPage) {
    try {
      user =
        JSON.parse(sessionStorage.getItem('alfa-staff-context') || 'null')?.id || 'unauthenticated';
    } catch {
      user = 'unauthenticated';
    }
  }
  return `${KEY}:${venueId}:${user}`;
}
function writeLocal(s: Store) {
  cache().setItem(cacheKey(), JSON.stringify(s));
}
export function exportLocalCache(): string {
  return cache().getItem(cacheKey()) || '{}';
}
export function resetLocalCache() {
  cache().removeItem(cacheKey());
  clearDraft();
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(API + path, {
      ...init,
      credentials: 'same-origin',
      signal: AbortSignal.timeout(12000),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Venue-ID': venueId,
        ...(init?.headers || {}),
      },
    });
  } catch {
    throw new Error('Не удалось связаться с сервером. Проверьте соединение и повторите действие.');
  }
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json'))
    throw new Error('Сервер недоступен. Повторите действие после восстановления связи.');
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    if (staffPage && response.status === 401)
      window.dispatchEvent(new Event('staff-session-expired'));
    throw new ApiError(data.error || 'Сервер временно недоступен', response.status);
  }
  return data;
}

export function loadStore(): Store {
  try {
    const raw = cache().getItem(cacheKey());
    if (!raw) return seed();
    const s = JSON.parse(raw);
    if (!isStore(s) || !s.venue || !s.profile || !s.settings) return seed();
    return upgradeStore(s);
  } catch {
    // The loading screen waits for the API. A damaged cache must not prevent
    // hydration; keep its raw contents available for export until then.
    return seed();
  }
}
/** Загружает только доступную текущей роли проекцию данных заведения. */
export async function hydrateStore(canApply: () => boolean = () => true): Promise<Store | null> {
  const context = cacheKey();
  const initialRevision = loadStore()._revision;
  const remote = await request<unknown>(staffPage ? '/store' : '/guest/store');
  if (!isStore(remote)) {
    throw new Error('Сервер вернул некорректные данные');
  }
  if (!canApply() || context !== cacheKey()) return null;
  // A GET started before a successful save may finish after it.
  const current = loadStore();
  if (current._revision !== initialRevision && (current._revision ?? 0) > (remote._revision ?? 0))
    return current;
  const upgraded = upgradeStore(remote);
  writeLocal(upgraded);
  return upgraded;
}
/** Never report success or replace the cache before the server acknowledges the write. */
export async function saveStore(s: Store): Promise<Store> {
  const remote = await request<Store>('/store', { method: 'PUT', body: JSON.stringify(s) });
  if (!isStore(remote)) throw new Error('Сервер вернул некорректные данные. Обновите страницу.');
  const saved = upgradeStore(remote);
  writeLocal(saved);
  window.dispatchEvent(new Event('tips-update'));
  return saved;
}
export function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    const d = JSON.parse(raw || 'null');
    if (d && typeof d.amount === 'string' && Array.isArray(d.shares)) {
      const updated = upgradeDraft(d);
      localStorage.setItem(DRAFT_KEY, JSON.stringify(updated));
      return updated;
    }
  } catch {}
  return freshDraft();
}
export function saveDraft(d: Draft) {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
}
export function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
  sessionStorage.removeItem('tip-draft');
}

export async function requestAlfaIdCode(phone: string) {
  return request<{ challengeId: string; expiresIn: number }>('/auth/alfa-id/request', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  });
}
export async function verifyAlfaId(phone: string, code: string, challengeId?: string) {
  return request<{ token: string; expiresAt: number; user: { name: string; phone: string } }>(
    '/auth/alfa-id/verify',
    { method: 'POST', body: JSON.stringify({ phone, code, challengeId }) },
  );
}
function alfaAuthorization(): Record<string, string> {
  try {
    const identity = JSON.parse(localStorage.getItem('alfa-id-demo-v1') || 'null');
    return typeof identity?.token === 'string' ? { Authorization: `Bearer ${identity.token}` } : {};
  } catch {
    return {};
  }
}

/** Платёж подтверждается только сервером и привязан к гостевой сессии. */
export async function confirmPayment(d: Draft): Promise<Tip> {
  let remote: { payment: Tip; store: Store };
  try {
    remote = await request<{ payment: Tip; store: Store }>('/payments', {
      method: 'POST',
      headers: alfaAuthorization(),
      body: JSON.stringify({ draft: d }),
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      localStorage.removeItem('alfa-id-demo-v1');
      location.href = '/alfa-id?return=' + encodeURIComponent(location.pathname + location.search);
    }
    throw error;
  }
  if (remote?.payment && isStore(remote.store)) {
    const updated = upgradeStore(remote.store);
    writeLocal(updated);
    window.dispatchEvent(new Event('tips-update'));
    return remote.payment;
  }
  throw new Error(
    'Сервер вернул некорректный результат оплаты. Повторите запрос с тем же платежом.',
  );
}
