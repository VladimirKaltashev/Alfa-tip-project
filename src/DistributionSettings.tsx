import { useRef, useState } from 'react';
import { Check, Users } from 'lucide-react';
import { displayedShare, editShare, equalShares, venueRule } from './model';
import type { Store } from './model';
import { loadStore } from './repository';

export function DistributionSettings({
  store,
  update,
  notify,
}: {
  store: Store;
  update: (fn: (store: Store) => Store, revision?: number) => Promise<boolean>;
  notify: (message: string) => void;
}) {
  const initial = venueRule(store);
  const revision = useRef(store._revision);
  const [ids, setIds] = useState(initial.ids);
  const [shares, setShares] = useState(initial.shares);
  const [busy, setBusy] = useState(false);
  const employees = store.employees.filter((employee) => employee.active);
  function toggle(id: string) {
    const next = ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
    setIds(next);
    setShares(equalShares(next));
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!ids.length) {
      notify('Выберите хотя бы одного получателя');
      return;
    }
    setBusy(true);
    try {
      const ok = await update(
        (current) => ({ ...current, settings: { recipientIds: ids, shares } }),
        revision.current,
      );
      if (ok) {
        revision.current = loadStore()._revision;
        notify('Правило распределения сохранено');
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="card padded settings-form distribution-settings" onSubmit={save}>
      <h2>Распределение чаевых заведению</h2>
      <p className="muted">
        Правило для сумм, которые ожидают распределения. Чаевые конкретным сотрудникам гость делит
        поровну; прошлые зачисления не меняются.
      </p>
      <fieldset disabled={busy}>
        <legend>Получатели и доли</legend>
        {!employees.length && <p>Сначала добавьте активных сотрудников в команду.</p>}
        {employees.map((employee) => {
          const index = ids.indexOf(employee.id);
          return (
            <div className="distribution-row" key={employee.id}>
              <label className="checkbox-line">
                <input type="checkbox" checked={index >= 0} onChange={() => toggle(employee.id)} />
                <span>
                  {employee.name}
                  <small>{employee.role}</small>
                </span>
              </label>
              {index >= 0 && (
                <label className="distribution-share">
                  <input
                    aria-label={`Доля: ${employee.name}`}
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={displayedShare(shares[index])}
                    onChange={(event) =>
                      setShares(editShare(shares, index, Number(event.target.value)))
                    }
                  />
                  <span>%</span>
                </label>
              )}
            </div>
          );
        })}
        <button
          className="text-button"
          type="button"
          disabled={!ids.length}
          onClick={() => setShares(equalShares(ids))}
        >
          <Users size={17} /> Разделить поровну
        </button>
        <p className="quiet">
          При изменении состава доли становятся равными. Проценты на экране округлены; итоговое
          распределение сохраняет каждую копейку.
        </p>
      </fieldset>
      <button className="primary" disabled={busy || !ids.length}>
        {busy ? 'Сохраняем…' : 'Сохранить правило'}
        <Check size={18} />
      </button>
    </form>
  );
}
