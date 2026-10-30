import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  LockKeyhole,
  MessageSquare,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { requestAlfaIdCode, verifyAlfaId } from './repository';
import './alfa-id.css';

export type AlfaIdentity = {
  name: string;
  phone: string;
  loggedInAt: string;
  token?: string;
  expiresAt?: number;
};
const KEY = 'alfa-id-demo-v1';

export function readAlfaIdentity(): AlfaIdentity | null {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw && JSON.parse(raw);
    if (data?.expiresAt && data.expiresAt * 1000 <= Date.now()) {
      clearAlfaIdentity();
      return null;
    }
    return data && typeof data.name === 'string' && typeof data.phone === 'string' ? data : null;
  } catch {
    return null;
  }
}
export function clearAlfaIdentity() {
  localStorage.removeItem(KEY);
}
function returnPath() {
  try {
    const value = new URL(
      new URLSearchParams(location.search).get('return') || '/',
      location.origin,
    );
    return value.origin === location.origin ? value.pathname + value.search : '/';
  } catch {
    return '/';
  }
}
function phoneLabel(value: string) {
  const n = value.replace(/\D/g, '').slice(-10);
  if (!n) return '';
  return (
    '+7 ' + [n.slice(0, 3), n.slice(3, 6), n.slice(6, 8), n.slice(8, 10)].filter(Boolean).join(' ')
  );
}

export function AlfaIdPage() {
  const [phone, setPhone] = useState(''),
    [code, setCode] = useState(''),
    [stage, setStage] = useState<'phone' | 'code'>('phone'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const destination = useMemo(returnPath, []);
  const [challengeId, setChallengeId] = useState<string>();
  const digits = phone.replace(/\D/g, '').slice(-10);
  async function next() {
    if (busy) return;
    if (digits.length !== 10) {
      setError('Введите номер из 10 цифр');
      return;
    }
    setBusy(true);
    try {
      const result = await requestAlfaIdCode('+7' + digits);
      setChallengeId(result?.challengeId);
      setCode('');
      setError('');
      setStage('code');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось запросить код');
    } finally {
      setBusy(false);
    }
  }
  async function signIn() {
    if (busy) return;
    if (code.replace(/\D/g, '').length !== 6) {
      setError('Введите код из 6 цифр');
      return;
    }
    setBusy(true);
    try {
      const remote = await verifyAlfaId('+7' + digits, code, challengeId);
      localStorage.setItem(
        KEY,
        JSON.stringify({
          name: remote?.user.name || 'Гость Альфы',
          phone: remote?.user.phone || '+7' + digits,
          token: remote?.token,
          expiresAt: remote?.expiresAt,
          loggedInAt: new Date().toISOString(),
        }),
      );
      location.href = destination;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось подтвердить вход');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="alfa-id-page">
      <header className="alfa-id-header">
        <a href={destination} aria-label="Вернуться">
          <ArrowLeft size={20} />
        </a>
        <span className="alfa-id-logo">
          А<i />
        </span>
        <span className="alfa-id-demo">ДЕМО ALFA ID</span>
      </header>
      <section className="alfa-id-card">
        {stage === 'phone' ? (
          <>
            <span className="alfa-id-kicker">
              <ShieldCheck size={15} /> Безопасный демо-вход
            </span>
            <h1>
              Войдите через
              <br />
              Alfa ID
            </h1>
            <p>
              Войдя один раз, вы сможете оплачивать чаевые через Alfa Pay и получать в 2 раза больше
              бонусов.
            </p>
            <label className="alfa-phone">
              <span>Номер телефона</span>
              <div>
                <b>🇷🇺</b>
                <strong>+7</strong>
                <input
                  autoFocus
                  inputMode="tel"
                  aria-label="Номер телефона"
                  value={phoneLabel(phone).replace('+7 ', '')}
                  placeholder="999 123 45 67"
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setError('');
                  }}
                />
              </div>
            </label>
            {error && (
              <p className="alfa-id-error" role="alert">
                {error}
              </p>
            )}
            <button disabled={busy} className="alfa-id-primary" onClick={next}>
              {busy ? 'Проверяем…' : 'Получить код'}
            </button>
            <button className="alfa-id-link" onClick={next}>
              У меня уже есть демо-код
            </button>
          </>
        ) : (
          <>
            <span className="alfa-id-kicker">
              <MessageSquare size={15} /> Демо-подтверждение
            </span>
            <h1>Подтвердите вход</h1>
            <p>
              Введите любой шестизначный код. СМС не отправляется — это безопасная имитация Alfa ID.
            </p>
            <label className="alfa-code">
              <span>Код из СМС</span>
              <input
                autoFocus
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, ''));
                  setError('');
                }}
                placeholder="••••••"
              />
            </label>
            {error && (
              <p className="alfa-id-error" role="alert">
                {error}
              </p>
            )}
            <button disabled={busy} className="alfa-id-primary" onClick={signIn}>
              {busy ? (
                'Входим…'
              ) : (
                <>
                  Войти <Check size={18} />
                </>
              )}
            </button>
            <button className="alfa-id-link" onClick={() => setStage('phone')}>
              Изменить номер
            </button>
          </>
        )}
        <div className="alfa-id-note">
          <LockKeyhole size={18} />
          <span>
            Используйте вымышленный номер. Номер сохраняется в базе демонстрационного сервиса. Этот
            вход не предоставляет доступ к кабинетам персонала. СМС не отправляется.
          </span>
        </div>
      </section>
      <aside className="alfa-id-benefits">
        <Smartphone size={27} />
        <div>
          <b>Alfa Pay для чаевых</b>
          <span>Один вход — быстрый способ оплаты и двойные бонусы.</span>
        </div>
      </aside>
    </main>
  );
}
