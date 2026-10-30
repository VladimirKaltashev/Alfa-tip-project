from __future__ import annotations

import json
import os
import re
import secrets
import sqlite3
import hashlib
import time
import math
from datetime import UTC, datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from contextlib import contextmanager
from collections.abc import Iterator
from urllib.parse import urlparse
from backend.validation import identifier, validate_store, validate_changes, detached
from backend import audit, security


DB_PATH = Path(os.environ.get("ALFA_TIPS_DB", "/data/alfa-tips.sqlite3"))
MAX_BODY = 1_500_000
AMOUNT_RE = re.compile(r"^\d{1,5}([.,]\d{1,2})?$")


class ConflictError(Exception):
    pass


def finite_number(value: str) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("JSON не должен содержать бесконечные числа или NaN")
    return number


def now() -> str:
    return datetime.now(UTC).isoformat()


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=5, isolation_level=None)
    conn.row_factory = sqlite3.Row
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def setup() -> None:
    with connect() as conn:
        conn.executescript(
            """
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS application_state (
              state_key TEXT PRIMARY KEY,
              payload TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS alfa_sessions (
              token TEXT PRIMARY KEY,
              phone TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS alfa_challenges (
              id TEXT PRIMARY KEY, phone TEXT NOT NULL, expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS payment_requests (
              id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL
            );
            """
        )
        if "revision" not in {row["name"] for row in conn.execute("PRAGMA table_info(application_state)")}:
            conn.execute("ALTER TABLE application_state ADD COLUMN revision INTEGER NOT NULL DEFAULT 1")
        if "expires_at" not in {row["name"] for row in conn.execute("PRAGMA table_info(alfa_sessions)")}:
            conn.execute("ALTER TABLE alfa_sessions ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0")
        security.setup(conn)
        conn.execute('CREATE TABLE IF NOT EXISTS tenant_payment_requests (tenant TEXT NOT NULL,id TEXT NOT NULL,fingerprint TEXT NOT NULL,PRIMARY KEY(tenant,id))')
        conn.execute("INSERT OR IGNORE INTO tenant_payment_requests SELECT 'demo',id,fingerprint FROM payment_requests")


def json_load(value: str) -> Any:
    return json.loads(value)


def read_state(conn: sqlite3.Connection, tenant: str = 'demo') -> dict[str, Any] | None:
    row = conn.execute("SELECT payload,revision FROM application_state WHERE state_key=?", (tenant,)).fetchone()
    if row is None:
        return None
    store = json_load(row["payload"])
    store["_revision"] = row["revision"]
    store["_tenant"] = tenant
    return store


def write_state(conn: sqlite3.Connection, store: dict[str, Any], tenant: str = 'demo') -> None:
    conn.execute(
        """INSERT INTO application_state(state_key,payload,updated_at) VALUES(?,?,?)
           ON CONFLICT(state_key) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at,revision=application_state.revision+1""",
        (tenant, json.dumps(store, ensure_ascii=False, separators=(",", ":")), now()),
    )
    store["_revision"] = conn.execute("SELECT revision FROM application_state WHERE state_key=?", (tenant,)).fetchone()[0]
    store['_tenant'] = tenant


def unique_by_id(items: list[Any]) -> list[dict[str, Any]]:
    """Оставляет первую версию каждой сущности, сохраняя исходный порядок."""
    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        item_id = str(item.get("id") or item.get("tipId") or "")
        if not item_id or item_id in seen:
            continue
        seen.add(item_id)
        result.append(item)
    return result


def merge_state(current: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    """Редактируемые данные обновляются по последней версии, история платежей только пополняется."""
    current = detached(current)
    merged = detached(incoming)
    incoming_tips = {tip.get("id"): tip for tip in incoming.get("tips", []) if isinstance(tip, dict)}
    merged["tips"] = unique_by_id([*current.get("tips", []), *incoming.get("tips", [])])
    for tip in merged["tips"]:
        update = incoming_tips.get(tip.get("id"), {})
        tip["reviewed"] = bool(tip.get("reviewed") or update.get("reviewed"))
        # Распределение допустимо только для ещё не распределённой суммы.
        allocations = update.get("allocations")
        if not tip.get("allocations") and isinstance(allocations, dict) and allocations:
            if all(type(value) is int and value >= 0 for value in allocations.values()) and sum(allocations.values()) == tip.get("amount"):
                tip["allocations"] = allocations
    merged["withdrawals"] = unique_by_id([*current.get("withdrawals", []), *incoming.get("withdrawals", [])])
    current_events = current.get("oranges", {}).get("events", [])
    incoming_events = incoming.get("oranges", {}).get("events", [])
    events = unique_by_id([*current_events, *incoming_events])
    merged["oranges"] = {"events": events, "balance": sum(int(event.get("amount", 0)) for event in events)}
    return merged


def require_store(value: Any) -> dict[str, Any]:
    return validate_store(value)


def payment_fingerprint(draft: dict) -> str:
    identifier(draft.get("id"))
    recipients = draft.get("recipientIds")
    if not isinstance(recipients, list) or not recipients or len(recipients) > 1000:
        raise ValueError("Выберите получателей")
    for person in recipients:
        identifier(person)
    if len(set(recipients)) != len(recipients):
        raise ValueError("Получатели не должны повторяться")
    method = draft.get("method", "СБП")
    if method not in ("СБП", "Карта", "Alfa Pay", "Альфа-Пэй"):
        raise ValueError("Неизвестный способ оплаты")
    tags, comment, rating = draft.get("tags", []), draft.get("comment", ""), draft.get("rating", 0)
    if not isinstance(tags, list) or len(tags) > 5 or any(not isinstance(tag, str) or len(tag) > 60 for tag in tags):
        raise ValueError("Проверьте теги отзыва")
    if not isinstance(comment, str) or len(comment) > 500 or type(rating) is not int or not 0 <= rating <= 5:
        raise ValueError("Проверьте отзыв")
    canonical = {"amount": parse_amount(draft.get("amount")), "recipients": recipients, "method": "Alfa Pay" if alfa_pay(method) else method, "tags": tags, "comment": comment.strip(), "rating": rating}
    return hashlib.sha256(json.dumps(canonical, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def stored_fingerprint(tip: dict) -> str:
    return payment_fingerprint({"id": tip["id"], "amount": f'{tip["amount"] // 100}.{tip["amount"] % 100:02d}', "recipientIds": list(tip["allocations"]), "method": tip["method"], "tags": tip["tags"], "comment": tip["comment"], "rating": tip["rating"]})


def phone_number(value: Any) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"(?:\+7|7|8)?[0-9]{10}", value):
        raise ValueError("Введите номер из 10 цифр")
    return value[-10:]


def parse_amount(raw: Any) -> int:
    text = str(raw or "").strip()
    if not AMOUNT_RE.fullmatch(text):
        raise ValueError("Введите сумму от 10 до 50 000 ₽")
    rubles, _, kopecks = text.replace(",", ".").partition(".")
    amount = int(rubles) * 100 + int(kopecks.ljust(2, "0"))
    if not 1_000 <= amount <= 5_000_000:
        raise ValueError("Введите сумму от 10 до 50 000 ₽")
    return amount


def equal_allocation(amount: int, ids: list[str]) -> dict[str, int]:
    base, remainder = divmod(amount, len(ids))
    return {person_id: base + (1 if index < remainder else 0) for index, person_id in enumerate(ids)}


def alfa_pay(method: str) -> bool:
    return method in ("Alfa Pay", "Альфа-Пэй")


def has_alfa_session(conn: sqlite3.Connection, authorization: str | None) -> bool:
    if not authorization or not authorization.startswith("Bearer "):
        return False
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        return False
    return conn.execute("SELECT 1 FROM alfa_sessions WHERE token=? AND expires_at>?", (token, int(time.time()))).fetchone() is not None


def create_tip(store: dict[str, Any], draft: dict[str, Any]) -> dict[str, Any]:
    payment_id = identifier(draft.get("id"))
    if not payment_id:
        raise ValueError("Не указан идентификатор платежа")
    amount = parse_amount(draft.get("amount"))
    recipients = draft.get("recipientIds")
    if not isinstance(recipients, list) or not recipients or any(not isinstance(item, str) for item in recipients) or len(recipients) != len(set(recipients)):
        raise ValueError("Выберите хотя бы одного сотрудника")
    employees = {str(item.get("id")): item for item in store["employees"] if isinstance(item, dict)}
    if any(person_id not in employees or not employees[person_id].get("active") for person_id in recipients):
        raise ValueError("Один из сотрудников больше не принимает чаевые")
    method = str(draft.get("method", "СБП"))
    if method not in ("СБП", "Карта", "Alfa Pay", "Альфа-Пэй"):
        raise ValueError("Неизвестный способ оплаты")
    tags = draft.get("tags") if isinstance(draft.get("tags"), list) else []
    comment = str(draft.get("comment", ""))[:500].strip()
    rating = draft.get("rating", 0)
    if type(rating) is not int or not 0 <= rating <= 5:
        raise ValueError("Проверьте отзыв")
    oranges = (amount // 10_000) * (2 if alfa_pay(method) else 1)
    return {
        "id": payment_id,
        "amount": amount,
        "allocations": equal_allocation(amount, [str(item) for item in recipients]),
        "rating": rating,
        "tags": [str(tag)[:60] for tag in tags[:5]],
        "comment": comment,
        "method": "Alfa Pay" if alfa_pay(method) else method,
        "date": now(),
        "source": "guest",
        "reviewed": False,
        "oranges": oranges,
    }


class ApiHandler(BaseHTTPRequestHandler):
    server_version = "AlfaTipsDemo/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"{self.address_string()} - {fmt % args}")

    def tenant(self):
        return identifier(self.headers.get('X-Venue-ID', 'demo'))

    def protect_write(self):
        origin = self.headers.get('Origin')
        if origin and (urlparse(origin).scheme not in ('http', 'https') or urlparse(origin).netloc != self.headers.get('Host')):
            raise security.AccessError('Запрос с другого сайта отклонён', 403)
        if self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json':
            raise ValueError('Ожидается Content-Type application/json')

    def set_cookie(self, header):
        if header:
            self.response_cookies = [*getattr(self, 'response_cookies', []), header]

    def guest(self, conn):
        guest_digest, cookie = security.guest(conn, self.headers)
        self.set_cookie(cookie)
        return guest_digest

    def send_json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for cookie in getattr(self, 'response_cookies', []):
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 < length <= MAX_BODY:
            raise ValueError("Некорректный размер запроса")
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"), parse_constant=finite_number, parse_float=finite_number)
        except (UnicodeDecodeError, json.JSONDecodeError, RecursionError) as error:
            raise ValueError("Ожидается JSON") from error
        if not isinstance(payload, dict):
            raise ValueError("Ожидается объект JSON")
        return payload

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Allow", "GET, POST, PUT, OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:
        try:
            self.get_resource()
        except sqlite3.Error:
            self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "База данных временно недоступна"})
        except security.AccessError as error:
            self.send_json(error.status, {'error': str(error)})
        except ValueError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {'error': str(error)})

    def get_resource(self) -> None:
        path = urlparse(self.path).path
        tenant = self.tenant()
        if path == '/api/auth/session':
            with connect() as conn:
                identity = security.staff(conn, self.headers, tenant)
                state = read_state(conn, tenant)
                if state is None:
                    raise security.AccessError('Заведение недоступно', 403)
                security.view_store(conn, state, tenant, identity)
            self.send_json(200, identity)
            return
        if path == '/api/audit':
            with connect() as conn:
                security.staff(conn, self.headers, tenant, ('manager',))
                result = audit.page(conn, tenant, urlparse(self.path).query)
            self.send_json(200, result)
            return
        if path == '/api/team/accounts':
            with connect() as conn:
                security.staff(conn, self.headers, tenant, ('manager',))
                accounts = [dict(row) for row in conn.execute("SELECT id,username,employee_id,active FROM staff_users WHERE tenant=? AND role='employee' ORDER BY username", (tenant,))]
            self.send_json(200, {'accounts': accounts})
            return
        if path == "/api/health":
            try:
                with connect() as conn:
                    conn.execute("SELECT revision FROM application_state LIMIT 1").fetchone()
                self.send_json(HTTPStatus.OK, {"status": "ok"})
            except sqlite3.Error:
                self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "База данных временно недоступна"})
            return
        if path in ("/api/store", '/api/guest/store'):
            with connect() as conn:
                identity = security.staff(conn, self.headers, tenant) if path == '/api/store' else None
                store = read_state(conn, tenant)
                if store:
                    store = security.view_store(conn, store, tenant, identity, self.guest(conn) if identity is None else None)
            if store is None:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "Состояние ещё не создано"})
            else:
                self.send_json(HTTPStatus.OK, store)
            return
        if path == "/api/venue":
            with connect() as conn:
                store = read_state(conn, tenant)
            if store is None:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "Состояние ещё не создано"})
            else:
                self.send_json(HTTPStatus.OK, {"venue": security.public_venue(store["venue"]), "employees": [security.public_employee(item) for item in store['employees'] if item['active']]})
            return
        if path.startswith("/api/payments/"):
            payment_id = path.rsplit("/", 1)[-1]
            with connect() as conn:
                store = read_state(conn, tenant)
                owned = conn.execute('SELECT 1 FROM payment_owners WHERE tenant=? AND payment_id=? AND guest_digest=?', (tenant, payment_id, self.guest(conn))).fetchone()
            tip = next((item for item in (store or {}).get("tips", []) if item.get("id") == payment_id), None) if owned else None
            if tip is None:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "Платёж не найден"})
            else:
                self.send_json(HTTPStatus.OK, {"status": "succeeded", "payment": tip})
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "Маршрут не найден"})

    def do_PUT(self) -> None:
        if urlparse(self.path).path != "/api/store":
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Маршрут не найден"})
            return
        try:
            self.protect_write()
            tenant = self.tenant()
            store = require_store(self.read_json())
            with connect() as conn:
                conn.execute("BEGIN IMMEDIATE")
                identity = security.staff(conn, self.headers, tenant)
                current = read_state(conn, tenant)
                if current is None or type(store.get("_revision")) is not int or store["_revision"] != current["_revision"]:
                    raise ConflictError("Данные изменились. Обновите страницу и повторите изменения.")
                if identity['role'] == 'employee':
                    projected = security.view_store(conn, current, tenant, identity)
                    store = security.employee_update(current, store, projected, identity)
                elif store['withdrawals'] != current['withdrawals']:
                    raise security.AccessError('Вывод выполняет сотрудник из своего кабинета', 403)
                validate_changes(current, store)
                store = merge_state(current, store)
                changed = [key for key in ('venue', 'employees', 'settings', 'profile', 'tips', 'withdrawals') if current[key] != store[key]]
                write_state(conn, store, tenant)
                security.audit(conn, tenant, identity['id'], identity['role'], 'state.updated', metadata={'fields': changed, 'revision': store['_revision']})
                old_withdrawals = {item['id'] for item in current['withdrawals']}
                for item in store['withdrawals']:
                    if item['id'] not in old_withdrawals:
                        security.audit(conn, tenant, identity['id'], identity['role'], 'withdrawal.created', item['id'], {'amount': item['amount']})
                store = security.view_store(conn, store, tenant, identity)
                conn.commit()
            self.send_json(HTTPStatus.OK, store)
        except security.AccessError as error:
            self.send_json(error.status, {'error': str(error)})
        except ConflictError as error:
            self.send_json(HTTPStatus.CONFLICT, {"error": str(error), "code": "state_conflict"})
        except ValueError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except sqlite3.Error:
            self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "База данных временно недоступна"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        try:
            self.protect_write()
            tenant = self.tenant()
            payload = self.read_json()
            if path == '/api/auth/login':
                with connect() as conn:
                    token = security.login(conn, tenant, payload, self.address_string())
                self.set_cookie(security.cookie_header('alfa_staff', token, 8 * 3600))
                self.send_json(200, {'ok': True})
                return
            if path == '/api/auth/logout':
                with connect() as conn:
                    token = security.cookie_value(self.headers, 'alfa_staff')
                    identity = security.staff(conn, self.headers, tenant)
                    conn.execute('BEGIN IMMEDIATE')
                    conn.execute('DELETE FROM staff_sessions WHERE digest=?', (security.digest(token),))
                    security.audit(conn, tenant, identity['id'], identity['role'], 'logout')
                    conn.commit()
                self.set_cookie(security.cookie_header('alfa_staff', '', 0))
                self.send_json(200, {'ok': True})
                return
            if path in ('/api/team/accounts', '/api/team/accounts/revoke'):
                with connect() as conn:
                    identity = security.staff(conn, self.headers, tenant, ('manager',))
                    conn.execute('BEGIN IMMEDIATE')
                    if path.endswith('/revoke'):
                        user_id = identifier(payload.get('id'))
                        row = conn.execute("SELECT id FROM staff_users WHERE id=? AND tenant=? AND role='employee'", (user_id, tenant)).fetchone()
                        if row is None:
                            raise security.AccessError('Учётная запись не найдена', 404)
                        conn.execute('UPDATE staff_users SET active=0 WHERE id=?', (user_id,))
                        conn.execute('DELETE FROM staff_sessions WHERE user_id=?', (user_id,))
                        action = 'account.revoked'
                    else:
                        state = read_state(conn, tenant)
                        person = identifier(payload.get('employeeId'))
                        if state is None or person not in {item['id'] for item in state['employees']}:
                            raise ValueError('Выберите сотрудника этого заведения')
                        if conn.execute('SELECT 1 FROM staff_users WHERE tenant=? AND username=?', (tenant, str(payload.get('username', '')).lower())).fetchone():
                            raise ValueError('Этот логин уже используется')
                        user_id = security.create_user(conn, tenant, payload.get('username'), payload.get('password'), 'employee', person)
                        action = 'account.created'
                    security.audit(conn, tenant, identity['id'], identity['role'], action, user_id)
                    conn.commit()
                self.send_json(200, {'ok': True})
                return
            if path == "/api/store/initialize":
                with connect() as conn:
                    security.staff(conn, self.headers, tenant, ('manager',))
                    saved = read_state(conn, tenant)
                    if saved is None:
                        raise security.AccessError('Создание заведения доступно через административную команду', 403)
                self.send_json(HTTPStatus.OK, saved)
                return
            if path == "/api/auth/alfa-id/request":
                phone = phone_number(payload.get("phone"))
                challenge = secrets.token_urlsafe(18)
                with connect() as conn:
                    conn.execute("DELETE FROM alfa_challenges WHERE expires_at<=?", (int(time.time()),))
                    conn.execute("INSERT INTO alfa_challenges(id,phone,expires_at) VALUES(?,?,?)", (challenge, phone, int(time.time()) + 300))
                self.send_json(HTTPStatus.OK, {"challengeId": challenge, "expiresIn": 300})
                return
            if path == "/api/auth/alfa-id/verify":
                phone = phone_number(payload.get("phone"))
                code = payload.get("code")
                if not isinstance(code, str) or not re.fullmatch(r"[0-9]{6}", code):
                    raise ValueError("Введите номер и шестизначный демо-код")
                token = secrets.token_urlsafe(32)
                with connect() as conn:
                    conn.execute("BEGIN IMMEDIATE")
                    challenge = payload.get("challengeId")
                    if not isinstance(challenge, str):
                        raise ValueError("Сначала запросите демо-код")
                    row = conn.execute("SELECT phone,expires_at FROM alfa_challenges WHERE id=?", (challenge,)).fetchone()
                    if row is None or row["phone"] != phone or row["expires_at"] <= int(time.time()):
                        raise ValueError("Запрос кода истёк или уже использован. Запросите новый код.")
                    conn.execute("DELETE FROM alfa_challenges WHERE id=?", (challenge,))
                    expires = int(time.time()) + 3600
                    conn.execute("DELETE FROM alfa_sessions WHERE expires_at<=?", (int(time.time()),))
                    conn.execute("INSERT INTO alfa_sessions(token,phone,created_at,expires_at) VALUES(?,?,?,?)", (token, phone, now(), expires))
                    conn.commit()
                self.send_json(HTTPStatus.OK, {"token": token, "expiresAt": expires, "user": {"name": "Гость Альфы", "phone": "+7" + phone}})
                return
            if path == "/api/payments":
                draft = payload.get("draft")
                if not isinstance(draft, dict):
                    raise ValueError("Не передан черновик платежа")
                fingerprint = payment_fingerprint(draft)
                with connect() as conn:
                    conn.execute("BEGIN IMMEDIATE")
                    store = read_state(conn, tenant)
                    if store is None:
                        raise ValueError('Заведение не найдено')
                    guest_digest = self.guest(conn)
                    if alfa_pay(str(draft.get("method", ""))) and not has_alfa_session(conn, self.headers.get("Authorization")):
                        raise PermissionError("Для Alfa Pay войдите через Alfa ID")
                    existing = next((item for item in store["tips"] if item.get("id") == draft.get("id")), None)
                    if existing is None:
                        tip = create_tip(store, draft)
                        store["tips"] = [tip, *store["tips"]]
                        if tip["oranges"]:
                            oranges = store.setdefault("oranges", {"balance": 0, "events": []})
                            oranges["events"] = [{"tipId": tip["id"], "amount": tip["oranges"], "date": tip["date"], "method": tip["method"]}, *oranges.get("events", [])]
                            oranges["balance"] = sum(int(event.get("amount", 0)) for event in oranges["events"])
                        write_state(conn, store, tenant)
                        conn.execute("INSERT INTO tenant_payment_requests(tenant,id,fingerprint) VALUES(?,?,?)", (tenant, tip["id"], fingerprint))
                        conn.execute('INSERT INTO payment_owners VALUES(?,?,?)', (tenant, tip['id'], guest_digest))
                        security.audit(conn, tenant, 'guest', 'guest', 'payment.created', tip['id'], {'amount': tip['amount']})
                    else:
                        owner = conn.execute('SELECT guest_digest FROM payment_owners WHERE tenant=? AND payment_id=?', (tenant, existing['id'])).fetchone()
                        if owner is None or owner['guest_digest'] != guest_digest:
                            raise ConflictError('Идентификатор платежа уже использован')
                        saved_request = conn.execute("SELECT fingerprint FROM tenant_payment_requests WHERE tenant=? AND id=?", (tenant, existing["id"])).fetchone()
                        expected = saved_request["fingerprint"] if saved_request else stored_fingerprint(existing)
                        if fingerprint != expected:
                            raise ConflictError("Этот идентификатор уже использован для другого платежа")
                        tip = existing
                    store = security.view_store(conn, store, tenant, guest_digest=guest_digest)
                    conn.commit()
                self.send_json(HTTPStatus.OK, {"status": "succeeded", "payment": tip, "store": store})
                return
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Маршрут не найден"})
        except security.AccessError as error:
            self.send_json(error.status, {'error': str(error)})
        except ConflictError as error:
            self.send_json(HTTPStatus.CONFLICT, {"error": str(error), "code": "payment_conflict"})
        except ValueError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except PermissionError as error:
            self.send_json(HTTPStatus.UNAUTHORIZED, {"error": str(error)})
        except sqlite3.Error:
            self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "База данных временно недоступна"})


def main() -> None:
    setup()
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), ApiHandler)
    print(f"Alfa Tips API listening on :{port}; database: {DB_PATH}")
    server.serve_forever()


if __name__ == "__main__":
    main()
