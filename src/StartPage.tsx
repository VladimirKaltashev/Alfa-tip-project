import { ArrowRight, Coffee, Heart, UserRound } from 'lucide-react';
import './demo-start.css';

/** A neutral entry point. Venue links still take guests straight to the tip form. */
export default function StartPage() {
  return (
    <main className="demo-start">
      <header>
        <span className="eyebrow">АЛЬФА ЧАЕВЫЕ · ДЕМОНСТРАЦИЯ</span>
        <h1>Посмотрите сервис с разных сторон</h1>
        <p>
          Для примера открыто кафе «Листва». Гость попадает к чаевым по ссылке или QR-коду кафе;
          менеджер и сотрудник входят в свои кабинеты.
        </p>
      </header>
      <div className="demo-roles">
        <article>
          <Heart aria-hidden="true" />
          <h2>Я гость</h2>
          <p>Откройте страницу «Листвы», выберите сотрудников и оставьте демочаевые.</p>
          <a className="primary" href="/?venue=demo">
            Открыть страницу кафе <ArrowRight size={18} />
          </a>
          <small>Вход не требуется. Реальные деньги не списываются.</small>
        </article>
        <article>
          <Coffee aria-hidden="true" />
          <h2>Я управляю кафе</h2>
          <p>Войдите в кабинет, чтобы посмотреть команду, чаевые, отзывы и настройки.</p>
          <a className="primary" href="/manager?venue=demo">
            Войти как менеджер <ArrowRight size={18} />
          </a>
          <small>Понадобятся логин и пароль менеджера этого кафе.</small>
        </article>
        <article>
          <UserRound aria-hidden="true" />
          <h2>Я сотрудник</h2>
          <p>Войдите в личный кабинет, чтобы проверить начисления и свой профиль.</p>
          <a className="primary" href="/waiter?venue=demo">
            Войти как сотрудник <ArrowRight size={18} />
          </a>
          <small>Понадобятся личный логин и пароль сотрудника.</small>
        </article>
      </div>
      <footer>
        <a href="/experience?venue=demo">Посмотреть сценарии от оплаты счёта до чаевых</a>
      </footer>
    </main>
  );
}
