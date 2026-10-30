import { AlertCircle, RefreshCw, X } from 'lucide-react';

export function SaveStatus({
  saving,
  error,
  dismiss,
}: {
  saving: boolean;
  error: string;
  dismiss: () => void;
}) {
  if (saving)
    return (
      <div className="save-status" role="status">
        Сохраняем изменения…
      </div>
    );
  if (!error) return null;
  return (
    <aside className="save-status save-status-error" role="alert">
      <AlertCircle size={20} />
      <div>
        <b>Не удалось подтвердить данные</b>
        <p>{error}</p>
        <small>
          При ошибке связи проверьте результат после обновления: запрос мог успеть выполниться.
          Скопируйте несохранённый текст перед перезагрузкой.
        </small>
        <button onClick={() => location.reload()}>
          <RefreshCw size={16} /> Обновить страницу
        </button>
      </div>
      <button onClick={dismiss} aria-label="Скрыть сообщение">
        <X size={18} />
      </button>
    </aside>
  );
}
