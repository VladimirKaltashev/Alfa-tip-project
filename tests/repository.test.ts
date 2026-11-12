import test from 'node:test';
import assert from 'node:assert/strict';
import { seed, KEY, freshDraft } from '../src/model.ts';

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value));
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}
let scenario = 0;
async function repository(connected = true) {
  const local = new MemoryStorage(),
    session = new MemoryStorage();
  local.setItem(KEY + ':demo:guest', JSON.stringify({ ...seed(), _revision: 4 }));
  if (connected) session.setItem('alfa-api-connected', 'yes');
  Object.assign(globalThis, {
    localStorage: local,
    sessionStorage: session,
    window: new EventTarget(),
    location: { pathname: '/payment', search: '', href: '' },
  });
  return import(`../src/repository.ts?scenario=${scenario++}`);
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

test('save waits for acknowledgement and stores the server revision', async () => {
  const repo = await repository();
  const before = repo.loadStore(),
    candidate = { ...before, venue: { ...before.venue, name: 'Updated' } };
  let resolve!: (response: Response) => void;
  globalThis.fetch = () =>
    new Promise<Response>((done) => {
      resolve = done;
    });
  const saving = repo.saveStore(candidate);
  assert.equal(repo.loadStore().venue.name, before.venue.name);
  resolve(json({ ...candidate, _revision: 5 }));
  await saving;
  assert.equal(repo.loadStore().venue.name, 'Updated');
  assert.equal(repo.loadStore()._revision, 5);
});

test('conflict leaves confirmed local cache unchanged', async () => {
  const repo = await repository(),
    before = repo.loadStore();
  globalThis.fetch = async () => json({ error: 'Conflict' }, 409);
  await assert.rejects(
    repo.saveStore({ ...before, venue: { ...before.venue, name: 'Lost update' } }),
    /Conflict/,
  );
  assert.deepEqual(repo.loadStore(), before);
});

test('network failure cannot be reported as a saved edit', async () => {
  const repo = await repository(),
    before = repo.loadStore();
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  await assert.rejects(repo.saveStore(before));
  assert.deepEqual(repo.loadStore(), before);
});

test('connected API cannot silently turn a payment into local mode', async () => {
  const repo = await repository(),
    before = repo.loadStore();
  globalThis.fetch = async () =>
    new Response('<html>Unavailable</html>', {
      status: 503,
      headers: { 'content-type': 'text/html' },
    });
  await assert.rejects(repo.confirmPayment({ ...freshDraft(), amount: '100' }));
  assert.deepEqual(repo.loadStore(), before);
});

test('malformed payment success does not mint a local payment', async () => {
  const repo = await repository(),
    before = repo.loadStore();
  globalThis.fetch = async () => json({ status: 'succeeded' });
  await assert.rejects(repo.confirmPayment({ ...freshDraft(), amount: '100' }));
  assert.deepEqual(repo.loadStore(), before);
});

test('expired authentication redirects without discarding the payment draft', async () => {
  const repo = await repository();
  const draft = { ...freshDraft(), amount: '100', method: 'Alfa Pay' };
  repo.saveDraft(draft);
  localStorage.setItem('alfa-id-demo-v1', JSON.stringify({ token: 'old' }));
  globalThis.fetch = async () => json({ error: 'Expired' }, 401);
  await assert.rejects(repo.confirmPayment(draft), /Expired/);
  assert.equal(repo.loadDraft().id, draft.id);
  assert.equal(localStorage.getItem('alfa-id-demo-v1'), null);
  assert.match(location.href, /^\/alfa-id\?return=/);
});

test('missing API cannot silently save locally', async () => {
  const repo = await repository(false),
    candidate = repo.loadStore();
  candidate.venue.name = 'Offline demo';
  globalThis.fetch = async () =>
    new Response('<html>SPA</html>', { headers: { 'content-type': 'text/html' } });
  await assert.rejects(repo.saveStore(candidate));
  assert.notEqual(repo.loadStore().venue.name, 'Offline demo');
});

test('verification sends the challenge returned by the server', async () => {
  const repo = await repository();
  let sent: Record<string, string> = {};
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(String(options?.body));
    return json({ token: 'token', expiresAt: 123, user: { name: 'Demo', phone: '+79990000000' } });
  };
  await repo.verifyAlfaId('+79990000000', '123456', 'challenge-one');
  assert.equal(sent.challengeId, 'challenge-one');
});

test('guest hydration requests a tenant scoped guest projection', async () => {
  const repo = await repository();
  let url = '',
    headers: HeadersInit | undefined;
  globalThis.fetch = async (target, options) => {
    url = String(target);
    headers = options?.headers;
    return json({ ...seed(), _tenant: 'demo', _revision: 5 });
  };
  await repo.hydrateStore();
  assert.equal(url, '/api/guest/store');
  assert.equal(new Headers(headers).get('X-Venue-ID'), 'demo');
});

test('payment request cannot send a client supplied ledger', async () => {
  const repo = await repository();
  let body: Record<string, unknown> = {};
  globalThis.fetch = async (_target, options) => {
    body = JSON.parse(String(options?.body));
    return json({ error: 'test rejection' }, 400);
  };
  await assert.rejects(repo.confirmPayment({ ...freshDraft(), amount: '100' }));
  assert.ok(body.draft);
  assert.equal(body.store, undefined);
});

test('damaged cache does not block API recovery and remains exportable until recovery', async () => {
  const repo = await repository();
  localStorage.setItem(KEY + ':demo:guest', '{broken');
  assert.doesNotThrow(() => repo.loadStore());
  assert.equal(repo.exportLocalCache(), '{broken');
  const restored = { ...seed(), _revision: 7 };
  globalThis.fetch = async () => json(restored);
  await repo.hydrateStore();
  assert.deepEqual(repo.loadStore(), restored);
});

test('reset clears the current tenant cache and draft without clearing other contexts', async () => {
  const repo = await repository();
  repo.saveDraft({ ...freshDraft(), amount: '175.05' });
  localStorage.setItem(KEY + ':other:guest', 'other venue');
  sessionStorage.setItem(KEY + ':demo:employee', 'staff cache');
  assert.equal(JSON.parse(repo.exportLocalCache())._revision, 4);
  repo.resetLocalCache();
  assert.equal(localStorage.getItem(KEY + ':demo:guest'), null);
  assert.equal(localStorage.getItem(repo.DRAFT_KEY), null);
  assert.equal(localStorage.getItem(KEY + ':other:guest'), 'other venue');
  assert.equal(sessionStorage.getItem(KEY + ':demo:employee'), 'staff cache');
});

test('a late background read cannot replace a newer acknowledged save', async () => {
  const repo = await repository();
  const before = repo.loadStore();
  let resolve!: (response: Response) => void;
  globalThis.fetch = async (_target, options) =>
    options?.method === 'PUT'
      ? json({ ...before, venue: { ...before.venue, name: 'Saved' }, _revision: 5 })
      : new Promise<Response>((done) => {
          resolve = done;
        });
  const reading = repo.hydrateStore();
  await repo.saveStore(before);
  resolve(json(before));
  assert.equal((await reading)?._revision, 5);
  assert.equal(repo.loadStore().venue.name, 'Saved');
  assert.equal(repo.loadStore()._revision, 5);
});

test('cancelled hydration cannot update the cache after unmount or during a write', async () => {
  const repo = await repository();
  const before = repo.loadStore();
  globalThis.fetch = async () => json({ ...before, _revision: 5 });
  assert.equal(await repo.hydrateStore(() => false), null);
  assert.deepEqual(repo.loadStore(), before);
});

test('initial hydration accepts the server after restoration to an older revision', async () => {
  const repo = await repository();
  const restored = { ...repo.loadStore(), _revision: 2 };
  globalThis.fetch = async () => json(restored);
  assert.equal((await repo.hydrateStore())?._revision, 2);
  assert.equal(repo.loadStore()._revision, 2);
});
