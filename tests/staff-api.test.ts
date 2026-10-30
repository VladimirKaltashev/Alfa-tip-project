import test from 'node:test';
import assert from 'node:assert/strict';

Object.assign(globalThis, {
  location: { pathname: '/manager', search: '?venue=review-cafe' },
  sessionStorage: { getItem: () => null, setItem: () => {} },
  window: new EventTarget(),
});
const { staffRequest, signInStaff } = await import('../src/staff-api.ts');
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

test('staff requests include the selected venue and same-origin credentials', async () => {
  let request: RequestInit | undefined;
  globalThis.fetch = async (_url, options) => {
    request = options;
    return json({ ok: true });
  };
  assert.deepEqual(await staffRequest('/team/accounts', { employeeId: 'alex' }), { ok: true });
  assert.equal(request?.credentials, 'same-origin');
  assert.equal(new Headers(request?.headers).get('X-Venue-ID'), 'review-cafe');
  assert.equal(request?.method, 'POST');
});

test('expired protected requests notify the session boundary even for a non-JSON response', async () => {
  let expired = 0;
  const listener = () => {
    expired++;
  };
  window.addEventListener('staff-session-expired', listener);
  try {
    globalThis.fetch = async () => new Response('unauthorized', { status: 401 });
    await assert.rejects(staffRequest('/audit'));
    assert.equal(expired, 1);
    globalThis.fetch = async () => json({ error: 'Wrong password' }, 401);
    await assert.rejects(staffRequest('/auth/login', {}), /Wrong password/);
    await assert.rejects(staffRequest('/auth/session'), /Wrong password/);
    assert.equal(expired, 1);
  } finally {
    window.removeEventListener('staff-session-expired', listener);
  }
});

test('forbidden operations preserve the session and server error status', async () => {
  globalThis.fetch = async () => json({ error: 'Недостаточно прав' }, 403);
  await assert.rejects(staffRequest('/team/accounts'), {
    message: 'Недостаточно прав',
    status: 403,
  });
});

test('invalid JSON and network failures produce actionable errors', async () => {
  globalThis.fetch = async () =>
    new Response('{', { headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(staffRequest('/audit'), /некорректный ответ/);
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  await assert.rejects(staffRequest('/team/accounts', {}), /проверьте результат перед повтором/);
});

test('login trims only username and verifies the returned cookie before success', async () => {
  const requests: string[] = [];
  globalThis.fetch = async (url, options) => {
    requests.push(String(url));
    if (String(url).endsWith('/auth/login')) {
      assert.deepEqual(JSON.parse(String(options?.body)), {
        username: 'qa.manager',
        password: ' password with spaces ',
      });
      return json({ ok: true });
    }
    return json({ id: 'manager', role: 'manager', tenant: 'review-cafe' });
  };
  assert.equal((await signInStaff(' qa.manager ', ' password with spaces ')).role, 'manager');
  assert.deepEqual(requests, ['/api/auth/login', '/api/auth/session']);
});

test('login explains a rejected session cookie separately from an incorrect password', async () => {
  globalThis.fetch = async (url) =>
    String(url).endsWith('/auth/login') ? json({ ok: true }) : json({ error: 'Unauthorized' }, 401);
  await assert.rejects(signInStaff('qa.manager', 'test'), /сессия не сохранилась/);
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return json({ error: 'Неверный логин или пароль' }, 401);
  };
  await assert.rejects(signInStaff('qa.manager', 'wrong'), /Неверный логин или пароль/);
  assert.equal(calls, 1);
});
