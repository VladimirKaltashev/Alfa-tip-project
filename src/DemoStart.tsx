import { useRef, useState } from 'react';
import { ArrowRight, Coffee, Heart, UserRound } from 'lucide-react';
import { signInStaff } from './staff-api';
import { venueId } from './tenant';
import './demo-start.css';

// This module is loaded only by Vite development mode. These are disposable QA accounts,
// never a server-side authorization bypass or production default credentials.
export default function DemoStart() {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const lock = useRef(false);

  async function enter(role: 'manager' | 'employee') {
    if (lock.current) return;
    lock.current = true;
    setBusy(role);
    setError('');
    try {
      const identity = await signInStaff(`qa.${role}`, 'Visual-check-only-42!');
      if (identity.role !== role)
        throw new Error('Тестовый аккаунт имеет другую роль. Проверьте настройки стенда.');
      sessionStorage.setItem('alfa-staff-context', JSON.stringify(identity));
      window.location.assign((role === 'manager' ? '/bank' : '/waiter') + '?venue=demo');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Не удалось открыть кабинет.';
      setError(
        message === 'Неверный логин или пароль'
          ? 'На этом сервере нет тестового аккаунта или доступ отключён. Быстрый вход работает только с тестовой базой. Для своего заведения используйте обычный вход ниже.'
          : message,
      );
      lock.current = false;
      setBusy('');
    }
  }

  if (venueId !== 'demo')
    return (
      <main className="demo-start">
        <h1>Открыть тестовое заведение</h1>
        <p>Демонстрационные аккаунты относятся к заведению demo.</p>
        <a className="primary" href="/demo?venue=demo">
          Перейти к демонстрации
        </a>
      </main>
    );

  return (
    <main className="demo-start">
      <header>
        <span className="eyebrow">АЛЬФА ЧАЕВЫЕ · ДЕМОНСТРАЦИЯ</span>
        <h1>С какой стороны посмотреть сервис?</h1>
        <p>Выберите роль. Для тестовых кабинетов логин и пароль вводить не нужно.</p>
      </header>
      {error && (
        <div className="staff-error" role="alert">
          {error}
        </div>
      )}
      {busy && <p role="status">Входим в тестовый кабинет…</p>}
      <div className="demo-roles">
        <article>
          <Heart aria-hidden="true" />
          <h2>Я гость</h2>
          <p>Оставьте чаевые, выберите сотрудников и напишите отзыв.</p>
          <a className="primary" href="/?venue=demo">
            Оставить чаевые <ArrowRight size={18} />
          </a>
          <small>Без входа. Реальные деньги не списываются.</small>
        </article>
        <article>
          <Coffee aria-hidden="true" />
          <h2>Я управляю кафе</h2>
          <p>Посмотрите сервис со стороны заведения: команда, чаевые, отзывы и доступы.</p>
          <button className="primary" disabled={!!busy} onClick={() => void enter('manager')}>
            Открыть кабинет кафе <ArrowRight size={18} />
          </button>
          <small>После входа: «Альфа Чаевые» на главном экране банка.</small>
        </article>
        <article>
          <UserRound aria-hidden="true" />
          <h2>Я сотрудник</h2>
          <p>Посмотрите свои начисления, личную цель и демонстрационный вывод.</p>
          <button className="primary" disabled={!!busy} onClick={() => void enter('employee')}>
            Открыть кабинет сотрудника <ArrowRight size={18} />
          </button>
          <small>Тестовый профиль: Алексей. Видны только его чаевые.</small>
        </article>
      </div>
      <footer>
        <p>
          При смене роли вход в этом браузере переключается на выбранный аккаунт. Тестовые данные
          общие для этой демонстрации.
        </p>
        <a href="/manager?venue=demo">Войти со своим логином и паролем</a>
      </footer>
    </main>
  );
}
