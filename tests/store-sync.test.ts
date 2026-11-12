import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { seed, KEY } from '../src/model.ts';
import type { Store } from '../src/model.ts';

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
function setup() {
  Object.assign(globalThis, {
    localStorage: new MemoryStorage(),
    sessionStorage: new MemoryStorage(),
    window: new EventTarget(),
    document: Object.assign(new EventTarget(), { visibilityState: 'visible' }),
    location: { pathname: '/waiter', search: '', href: '' },
  });
  sessionStorage.setItem('alfa-staff-context', JSON.stringify({ id: 'maria-account' }));
}
setup();
const { startStoreSync, unseenEmployeeTips } = await import('../src/store-sync.ts');
const repo = await import('../src/repository.ts');
const json = (store: Store) =>
  new Response(JSON.stringify(store), {
    headers: { 'content-type': 'application/json' },
  });
function staffStore(revision = 1): Store {
  const s = seed();
  return { ...s, _revision: revision, employees: [s.employees[1]], tips: [], withdrawals: [] };
}

test('staff polling and focus refresh fetch server balances and notify the signed-in employee', async (t) => {
  setup();
  t.mock.timers.enable({ apis: ['setInterval'] });
  let server = staffStore();
  let reads = 0;
  const seen = new Set<string>();
  const notices: number[] = [];
  globalThis.fetch = async (url) => {
    assert.equal(url, '/api/store');
    reads++;
    return json(server);
  };
  const stop = startStoreSync({
    onStore: (s, initial) => {
      if (!initial) notices.push(unseenEmployeeTips(s, seen));
      s.tips.forEach((tip) => seen.add(tip.id));
    },
    onError: (e) => {
      throw e;
    },
  });
  t.after(stop);
  await setImmediate();
  const tip = { ...seed().tips[0], id: 'new-maria', amount: 12345, allocations: { maria: 12345 } };
  server = { ...server, _revision: 2, tips: [tip] };
  t.mock.timers.tick(15000);
  await setImmediate();
  assert.equal(repo.loadStore().tips[0].amount, 12345);
  assert.deepEqual(notices, [12345]);
  window.dispatchEvent(new Event('focus'));
  await setImmediate();
  assert.equal(reads, 3);
  assert.deepEqual(notices, [12345, 0]);
  assert.equal(
    unseenEmployeeTips(
      { ...server, employees: [{ ...server.employees[0], notifications: false }] },
      new Set(),
    ),
    0,
  );
});

test('refresh skips hidden windows and writes, and resumes on visibility or reconnect', async (t) => {
  setup();
  t.mock.timers.enable({ apis: ['setInterval'] });
  let writing = false,
    reads = 0;
  globalThis.fetch = async () => {
    reads++;
    return json(staffStore(reads));
  };
  const stop = startStoreSync({
    onStore: () => {},
    onError: (e) => {
      throw e;
    },
    canRefresh: () => !writing,
  });
  t.after(stop);
  await setImmediate();
  Object.assign(document, { visibilityState: 'hidden' });
  t.mock.timers.tick(15000);
  await setImmediate();
  assert.equal(reads, 1);
  Object.assign(document, { visibilityState: 'visible' });
  writing = true;
  document.dispatchEvent(new Event('visibilitychange'));
  await setImmediate();
  assert.equal(reads, 1);
  writing = false;
  window.dispatchEvent(new Event('online'));
  await setImmediate();
  assert.equal(reads, 2);
  document.dispatchEvent(new Event('visibilitychange'));
  await setImmediate();
  assert.equal(reads, 3);
});

test('stopping sync prevents pending reads, timers and listeners from modifying cleared data', async (t) => {
  setup();
  t.mock.timers.enable({ apis: ['setInterval'] });
  let resolve!: (response: Response) => void;
  let reads = 0,
    updates = 0;
  globalThis.fetch = () => {
    reads++;
    return new Promise<Response>((done) => {
      resolve = done;
    });
  };
  const stop = startStoreSync({
    onStore: () => {
      updates++;
    },
    onError: (e) => {
      throw e;
    },
  });
  t.after(stop);
  window.dispatchEvent(new Event('focus'));
  t.mock.timers.tick(15000);
  assert.equal(reads, 1);
  stop();
  resolve(json(staffStore()));
  await setImmediate();
  window.dispatchEvent(new Event('focus'));
  window.dispatchEvent(new Event('online'));
  document.dispatchEvent(new Event('visibilitychange'));
  t.mock.timers.tick(30000);
  await setImmediate();
  assert.equal(reads, 1);
  assert.equal(updates, 0);
  assert.equal(sessionStorage.getItem(KEY + ':demo:maria-account'), null);
});

test('failed background refresh keeps the last confirmed data and recovers on reconnect', async (t) => {
  setup();
  let offline = false;
  const errors: boolean[] = [];
  const initials: boolean[] = [];
  globalThis.fetch = async () => {
    if (offline) throw new Error('offline');
    return json(staffStore(3));
  };
  const stop = startStoreSync({
    onStore: (_s, initial) => initials.push(initial),
    onError: (_e, initial) => errors.push(initial),
  });
  t.after(stop);
  await setImmediate();
  offline = true;
  window.dispatchEvent(new Event('focus'));
  await setImmediate();
  assert.deepEqual(errors, [false]);
  assert.equal(repo.loadStore()._revision, 3);
  offline = false;
  window.dispatchEvent(new Event('online'));
  await setImmediate();
  assert.deepEqual(initials, [true, false]);
});

test('staff export/reset operates on the signed-in account and leaves other caches intact', () => {
  setup();
  const key = KEY + ':demo:maria-account';
  sessionStorage.setItem(key, '{damaged-staff-data');
  sessionStorage.setItem(KEY + ':demo:other-account', 'other staff');
  localStorage.setItem(KEY + ':demo:guest', 'guest data');
  localStorage.setItem(repo.DRAFT_KEY, 'draft');
  assert.equal(repo.exportLocalCache(), '{damaged-staff-data');
  repo.resetLocalCache();
  assert.equal(sessionStorage.getItem(key), null);
  assert.equal(localStorage.getItem(repo.DRAFT_KEY), null);
  assert.equal(sessionStorage.getItem(KEY + ':demo:other-account'), 'other staff');
  assert.equal(localStorage.getItem(KEY + ':demo:guest'), 'guest data');
});

test('a response for the previous staff identity cannot populate the next account cache', async () => {
  setup();
  let resolve!: (response: Response) => void;
  globalThis.fetch = () =>
    new Promise<Response>((done) => {
      resolve = done;
    });
  const reading = repo.hydrateStore();
  sessionStorage.setItem('alfa-staff-context', JSON.stringify({ id: 'next-account' }));
  resolve(json(staffStore()));
  assert.equal(await reading, null);
  assert.equal(sessionStorage.getItem(KEY + ':demo:next-account'), null);
});
