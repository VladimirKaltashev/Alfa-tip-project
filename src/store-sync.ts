import { hydrateStore } from './repository.ts';
import type { Store } from './model';

/** Staff API projections contain only the signed-in employee and their shares. */
export function unseenEmployeeTips(store: Store, seen: ReadonlySet<string>): number {
  const employee = store.employees[0];
  if (!employee || !(employee.notifications ?? store.profile.notifications)) return 0;
  return store.tips.reduce(
    (total, tip) => total + (seen.has(tip.id) ? 0 : tip.allocations[employee.id] || 0),
    0,
  );
}

/** One in-flight read; stopping also prevents a late response from changing the cache. */
export function startStoreSync({
  onStore,
  onError,
  canRefresh = () => true,
  poll = true,
  intervalMs = 15000,
}: {
  onStore: (store: Store, initial: boolean) => void;
  onError: (error: unknown, initial: boolean) => void;
  canRefresh?: () => boolean;
  poll?: boolean;
  intervalMs?: number;
}) {
  let stopped = false;
  let pending = false;
  let loaded = false;
  async function refresh() {
    if (stopped || pending || !canRefresh() || (loaded && document.visibilityState === 'hidden'))
      return;
    pending = true;
    try {
      const store = await hydrateStore(() => !stopped && canRefresh());
      if (store) {
        onStore(store, !loaded);
        loaded = true;
      }
    } catch (error) {
      if (!stopped) onError(error, !loaded);
    } finally {
      pending = false;
    }
  }
  const trigger = () => void refresh();
  void refresh();
  const timer = poll ? setInterval(trigger, intervalMs) : undefined;
  if (poll) {
    window.addEventListener('focus', trigger);
    window.addEventListener('online', trigger);
    document.addEventListener('visibilitychange', trigger);
  }
  return () => {
    stopped = true;
    clearInterval(timer);
    window.removeEventListener('focus', trigger);
    window.removeEventListener('online', trigger);
    document.removeEventListener('visibilitychange', trigger);
  };
}
