import { useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Heart,
  Home,
  LayoutDashboard,
  CircleHelp,
  MessageSquare,
  QrCode,
  Search,
  Settings,
  Users,
  Wallet,
} from 'lucide-react';
import type { Store } from './model';
import { inPeriod, money } from './model';
import './cabinet.css';

const sections = [
  { href: '/manager', label: 'Обзор', icon: Home, description: 'Обзор заведения' },
  {
    href: '/manager/statistics',
    label: 'Статистика',
    icon: LayoutDashboard,
    description: 'Суммы, оценки и динамика',
  },
  { href: '/manager/tips', label: 'Чаевые', icon: Wallet, description: 'Операции и выгрузка CSV' },
  {
    href: '/manager/reviews',
    label: 'Отзывы',
    icon: MessageSquare,
    description: 'Оценки и впечатления гостей',
  },
  {
    href: '/manager/team',
    label: 'Команда',
    icon: Users,
    description: 'Добавление и настройка сотрудников',
  },
  {
    href: '/manager/settings',
    label: 'Настройки',
    icon: Settings,
    description: 'Название, адрес и счёт',
  },
  {
    href: '/manager/access',
    label: 'Доступ',
    icon: Users,
    description: 'Логины сотрудников и отключение доступа',
  },
  {
    href: '/manager/audit',
    label: 'Журнал',
    icon: LayoutDashboard,
    description: 'Кто и когда менял данные заведения',
  },
  {
    href: '/manager/help',
    label: 'Помощь',
    icon: CircleHelp,
    description: 'Как управлять чаевыми заведения',
  },
];

export function Cabinet({
  store,
  path,
  qr,
  children,
}: {
  store: Store;
  path: string;
  qr: () => void;
  children: ReactNode;
}) {
  const [query, setQuery] = useState('');
  const matches = sections.filter((item) =>
    (item.label + ' ' + item.description)
      .toLocaleLowerCase('ru')
      .includes(query.trim().toLocaleLowerCase('ru')),
  );
  const today = store.tips.filter((t) => inPeriod(t, 1));
  const total = store.tips.reduce((n, t) => n + t.amount, 0);
  const active = store.employees.filter((e) => e.active);
  const unread = store.tips.filter(
    (t) => !t.reviewed && (t.rating || t.comment || t.tags.length),
  ).length;
  const home = path === '/manager';
  const bankHome = path === '/bank';
  const current = sections.find((section) => section.href === path);
  return (
    <div className="bank-cabinet">
      <a className="bank-skip" href="#cabinet-content">
        К содержимому
      </a>
      <header className="bank-header">
        <a className="bank-profile" href="/bank">
          <span className="bank-mark" aria-hidden="true">
            А
          </span>
          <span>
            <b>Альфа-Банк</b>
            <small>Альфа-Онлайн · кабинет заведения</small>
          </span>
        </a>
        <nav aria-label="Разделы Альфа-Онлайн">
          <a href="/bank" aria-current={bankHome ? 'page' : undefined}>
            <Home size={20} />
            <span>Главный</span>
          </a>
          <a
            href="/manager"
            aria-current={!bankHome && path !== '/manager/help' ? 'location' : undefined}
          >
            <Heart size={20} />
            <span>Альфа Чаевые</span>
          </a>
          <a href="/manager/help" aria-current={path === '/manager/help' ? 'page' : undefined}>
            <CircleHelp size={20} />
            <span>Помощь</span>
          </a>
        </nav>
      </header>
      <aside className="bank-products">
        <div className="bank-section-title">
          <h2>Мои продукты</h2>
          <a href="/manager/settings" aria-label="Настройки заведения">
            <Settings size={21} />
          </a>
        </div>
        <a className="bank-total" href="/manager/statistics">
          <small>Чаевые за всё время</small>
          <strong>{money(total)}</strong>
          <ChevronRight size={22} />
        </a>
        <h3>Сервисы для заведения</h3>
        <a className="bank-service" href="/manager">
          <span className="bank-service-icon">
            <Heart size={24} />
          </span>
          <span>
            <b>Альфа Чаевые</b>
            <small>{store.venue.name}</small>
          </span>
          <ChevronRight size={19} />
        </a>
        <h3>Команда</h3>
        <a className="bank-team" href="/manager/team">
          <div className="bank-portraits">
            {active.slice(0, 3).map((e) => (
              <span key={e.id}>{e.photo ? <img src={e.photo} alt="" /> : e.initials}</span>
            ))}
          </div>
          <b>Принимают чаевые: {active.length}</b>
          <small>Сотрудники и их профили</small>
        </a>
        <button className="bank-dark" onClick={qr}>
          <QrCode size={19} /> QR-код заведения
        </button>
        <a className="bank-guest-link" href="/">
          Открыть страницу гостя <ArrowRight size={16} />
        </a>
      </aside>
      <main id="cabinet-content" className="bank-content" tabIndex={-1}>
        <nav className="bank-breadcrumbs" aria-label="Путь к разделу">
          <a href="/bank">Альфа-Онлайн</a>
          {!bankHome && (
            <>
              <ChevronRight size={14} />
              {home ? (
                <span aria-current="page">Альфа Чаевые</span>
              ) : (
                <>
                  <a href="/manager">Альфа Чаевые</a>
                  <ChevronRight size={14} />
                  <span aria-current="page">{current?.label || 'Раздел не найден'}</span>
                </>
              )}
            </>
          )}
        </nav>
        {!bankHome && (
          <>
            <div className="bank-service-heading">
              <span className="bank-service-icon">
                <Heart size={24} />
              </span>
              <div>
                <b>Альфа Чаевые</b>
                <p>{store.venue.name} · кабинет заведения</p>
              </div>
            </div>
            <nav className="bank-service-nav" aria-label="Разделы Альфа Чаевых">
              {sections.map(({ href, label }) => (
                <a key={href} href={href} aria-current={path === href ? 'page' : undefined}>
                  {label}
                  {href === '/manager/reviews' && unread > 0 && (
                    <span className="bank-badge" aria-label={`Непрочитанных отзывов: ${unread}`}>
                      {unread}
                    </span>
                  )}
                </a>
              ))}
            </nav>
          </>
        )}
        <div className="bank-search-row">
          <form
            className="bank-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              if (matches.length === 1) location.href = matches[0].href;
            }}
          >
            <Search size={21} />
            <input
              aria-label="Поиск раздела"
              placeholder="Поиск по Альфа Чаевым"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Очистить поиск">
                ×
              </button>
            )}
          </form>
          <button className="bank-qr" onClick={qr} aria-label="QR-код заведения">
            <QrCode size={23} />
          </button>
        </div>
        {query.trim() && (
          <section className="bank-search-results" aria-label="Результаты поиска">
            <p role="status">
              {matches.length
                ? `Найдено разделов: ${matches.length}`
                : 'Ничего не найдено. Попробуйте «команда» или «отзывы».'}
            </p>
            {matches.map((item) => (
              <a href={item.href} key={item.href}>
                <b>{item.label}</b>
                <span>{item.description}</span>
                <ChevronRight size={18} />
              </a>
            ))}
          </section>
        )}
        {bankHome ? (
          <section className="bank-home-panel">
            <span className="bank-eyebrow">АЛЬФА-ОНЛАЙН</span>
            <h1>Сервисы для вашего кафе</h1>
            <p className="bank-intro">
              {store.venue.name}, всё для работы с чаевыми — в вашем банковском кабинете.
            </p>
            <div className="bank-offers">
              <article className="bank-tip-offer">
                <span className="bank-eyebrow">СЕРВИС ДЛЯ ЗАВЕДЕНИЯ</span>
                <h2>
                  Гостям — спасибо.
                  <br />
                  Команде — чаевые.
                </h2>
                <p>Подключите команду, разместите QR-код и следите за благодарностями гостей.</p>
                <a className="bank-dark" href="/manager">
                  Открыть Альфа Чаевые <ArrowRight size={18} />
                </a>
                <Heart className="bank-offer-heart" aria-hidden="true" />
              </article>
              <article className="bank-review-offer">
                <CircleHelp size={26} />
                <h2>Как это работает</h2>
                <p>
                  Кафе управляет сервисом в Альфа-Онлайн. Гость открывает страницу чаевых по
                  QR-коду.
                </p>
                <a className="text-button" href="/manager/help">
                  Помощь заведению <ArrowRight size={17} />
                </a>
              </article>
            </div>
            <p className="bank-prototype-note">
              Учебный макет сервиса в интерфейсе Альфа-Банка. Подключение к реальному банку не
              выполняется.
            </p>
          </section>
        ) : home ? (
          <>
            <section className="bank-home-panel">
              <h1>Для вашего заведения</h1>
              <div className="bank-offers">
                <article className="bank-tip-offer">
                  <span className="bank-eyebrow">АЛЬФА ЧАЕВЫЕ</span>
                  <h2>
                    Большое спасибо.
                    <br />В цифрах и отзывах.
                  </h2>
                  <p>Все благодарности вашей команде — рядом с привычными сервисами.</p>
                  <a className="bank-dark" href="/manager/statistics">
                    Открыть статистику <ArrowRight size={18} />
                  </a>
                  <Heart className="bank-offer-heart" aria-hidden="true" />
                </article>
                <a className="bank-review-offer" href="/manager/reviews">
                  <MessageSquare size={26} />
                  <h2>{unread ? 'Гости говорят спасибо' : 'На связи с гостями'}</h2>
                  <p>
                    {unread
                      ? `Непрочитанных отзывов: ${unread}`
                      : 'Здесь появятся впечатления и оценки ваших гостей.'}
                  </p>
                  <span>
                    Открыть отзывы <ArrowRight size={17} />
                  </span>
                </a>
              </div>
              <h2 className="bank-quick-title">Быстрые действия</h2>
              <div className="bank-actions">
                {sections.slice(1, 5).map(({ href, label, icon: Icon }) => (
                  <a href={href} key={href}>
                    <span>
                      <Icon size={26} />
                    </span>
                    {label}
                  </a>
                ))}
                <button onClick={qr}>
                  <span>
                    <QrCode size={26} />
                  </span>
                  QR для гостей
                </button>
              </div>
            </section>
            <section className="bank-setup">
              <h2>Подготовьте кафе к приёму чаевых</h2>
              <p>Три шага перед тем, как передать ссылку гостям.</p>
              <ol>
                <li>
                  <a href="/manager/settings">
                    <b>01 · Проверьте данные</b>
                    <span>Название и адрес на странице гостя</span>
                    <ChevronRight size={18} />
                  </a>
                </li>
                <li>
                  <a href="/manager/team">
                    <b>02 · Настройте команду</b>
                    <span>Сотрудники, которые принимают чаевые</span>
                    <ChevronRight size={18} />
                  </a>
                </li>
                <li>
                  <button onClick={qr}>
                    <b>03 · Разместите QR-код</b>
                    <span>Скачайте код или скопируйте ссылку</span>
                    <QrCode size={18} />
                  </button>
                </li>
              </ol>
            </section>
            <section className="bank-today">
              <div>
                <span className="bank-eyebrow">СЕГОДНЯ</span>
                <h2>Каждая благодарность важна</h2>
              </div>
              <strong>{money(today.reduce((n, t) => n + t.amount, 0))}</strong>
              <a href="/manager/tips">
                Операций: {today.length} <ChevronRight size={18} />
              </a>
            </section>
          </>
        ) : (
          <>
            <a className="bank-back" href="/manager">
              <ArrowLeft size={17} /> Обзор чаевых
            </a>
            <div className="bank-dashboard dashboard">
              {current ? (
                children
              ) : (
                <section className="bank-home-panel">
                  <h1>Раздел не найден</h1>
                  <a href="/manager">Вернуться к обзору чаевых</a>
                </section>
              )}
            </div>
          </>
        )}
        <footer className="bank-footer">
          <span>Учебный прототип · без реальных платежей</span>
          <a href="/manager/help">Помощь заведению</a>
        </footer>
      </main>
    </div>
  );
}
