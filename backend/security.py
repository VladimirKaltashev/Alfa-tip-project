"""Tenant-bound staff sessions, anonymous guest identities and audit records."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import time
from http.cookies import SimpleCookie

from backend.validation import identifier


class AccessError(Exception):
    def __init__(self, message: str, status: int = 401):
        super().__init__(message)
        self.status = status


def setup(conn):
    conn.executescript('''
      CREATE TABLE IF NOT EXISTS staff_users (
        id TEXT PRIMARY KEY, tenant TEXT NOT NULL, username TEXT NOT NULL,
        password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('manager','employee')),
        employee_id TEXT, active INTEGER NOT NULL DEFAULT 1,
        UNIQUE(tenant,username)
      );
      CREATE TABLE IF NOT EXISTS staff_sessions (
        digest TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS guest_sessions (
        digest TEXT PRIMARY KEY, expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS payment_owners (
        tenant TEXT NOT NULL, payment_id TEXT NOT NULL, guest_digest TEXT NOT NULL,
        PRIMARY KEY(tenant,payment_id)
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, tenant TEXT NOT NULL,
        actor TEXT NOT NULL, role TEXT NOT NULL, action TEXT NOT NULL,
        object_id TEXT, created_at INTEGER NOT NULL, metadata TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS audit_tenant_id ON audit_events(tenant,id);
      CREATE INDEX IF NOT EXISTS audit_tenant_action_id ON audit_events(tenant,action,id);
      CREATE INDEX IF NOT EXISTS payment_owner_guest ON payment_owners(tenant,guest_digest);
      CREATE INDEX IF NOT EXISTS staff_session_user ON staff_sessions(user_id);
      CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_events
        BEGIN SELECT RAISE(ABORT,'Audit events cannot be updated'); END;
      CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_events
        BEGIN SELECT RAISE(ABORT,'Audit events cannot be deleted'); END;
      CREATE TABLE IF NOT EXISTS login_attempts (
        key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL
      );
    ''')


def digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def hash_password(password: str) -> str:
    if not isinstance(password, str) or not 12 <= len(password) <= 128:
        raise ValueError('Пароль должен содержать от 12 до 128 символов')
    salt = secrets.token_hex(16)
    result = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 600000)
    return f'pbkdf2_sha256$600000${salt}${result.hex()}'


def check_password(password: str, encoded: str) -> bool:
    algorithm, rounds, salt, expected = encoded.split('$')
    if algorithm != 'pbkdf2_sha256':
        return False
    result = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), int(rounds))
    return hmac.compare_digest(result.hex(), expected)


def audit(conn, tenant, actor, role, action, object_id=None, metadata=None):
    conn.execute('INSERT INTO audit_events(tenant,actor,role,action,object_id,created_at,metadata) VALUES(?,?,?,?,?,?,?)',
                 (tenant, actor, role, action, object_id, int(time.time()), json.dumps(metadata or {}, ensure_ascii=False)))


def create_user(conn, tenant, username, password, role, employee_id=None):
    identifier(tenant)
    if not isinstance(username, str) or not 3 <= len(username) <= 80 or not username.isascii() or any(not (c.isalnum() or c in '._-@') for c in username):
        raise ValueError('Логин: 3–80 латинских букв, цифр или символов . _ - @')
    if role not in ('manager', 'employee') or (role == 'employee' and not employee_id):
        raise ValueError('Укажите роль и сотрудника')
    if employee_id:
        identifier(employee_id)
    user_id = secrets.token_hex(16)
    conn.execute('INSERT INTO staff_users(id,tenant,username,password_hash,role,employee_id) VALUES(?,?,?,?,?,?)',
                 (user_id, tenant, username.lower(), hash_password(password), role, employee_id))
    return user_id


def cookie_value(headers, name):
    cookie = SimpleCookie()
    try:
        cookie.load(headers.get('Cookie', ''))
        value = cookie[name].value if name in cookie else ''
        return value if len(value) <= 200 else ''
    except Exception:
        return ''


def cookie_header(name, value, age):
    secure = '; Secure' if os.environ.get('ALFA_COOKIE_SECURE') == '1' else ''
    return f'{name}={value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age={age}{secure}'


def staff(conn, headers, tenant, roles=('manager', 'employee')):
    token = cookie_value(headers, 'alfa_staff')
    row = conn.execute('''SELECT u.id,u.tenant,u.username,u.role,u.employee_id,s.expires_at
      FROM staff_sessions s JOIN staff_users u ON s.user_id=u.id
      WHERE s.digest=? AND s.expires_at>? AND u.active=1''', (digest(token), int(time.time()))).fetchone() if token else None
    if row is None:
        raise AccessError('Войдите в кабинет персонала')
    if row['tenant'] != tenant or row['role'] not in roles:
        raise AccessError('Нет доступа к этому разделу заведения', 403)
    return dict(row)


def login(conn, tenant, payload, address):
    username, password = payload.get('username'), payload.get('password')
    if not isinstance(username, str) or not isinstance(password, str) or len(username) > 80 or len(password) > 128:
        raise AccessError('Неверный логин или пароль')
    key = digest(tenant + ':' + address)
    current_time = int(time.time())
    conn.execute('DELETE FROM login_attempts WHERE reset_at<=?', (current_time,))
    attempt = conn.execute('SELECT count FROM login_attempts WHERE key=?', (key,)).fetchone()
    if attempt and attempt['count'] >= 10:
        raise AccessError('Слишком много попыток. Повторите вход через минуту.', 429)
    row = conn.execute('SELECT * FROM staff_users WHERE tenant=? AND username=? AND active=1', (tenant, username.lower())).fetchone()
    dummy = 'pbkdf2_sha256$600000$' + '00' * 16 + '$' + '00' * 32
    valid = check_password(password, row['password_hash'] if row else dummy)
    if row is None or not valid:
        conn.execute('INSERT INTO login_attempts(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1', (key, current_time + 60))
        audit(conn, tenant, 'anonymous', 'anonymous', 'login.failed')
        raise AccessError('Неверный логин или пароль')
    token = secrets.token_urlsafe(32)
    conn.execute('BEGIN IMMEDIATE')
    conn.execute('DELETE FROM staff_sessions WHERE expires_at<=?', (current_time,))
    conn.execute('INSERT INTO staff_sessions VALUES(?,?,?)', (digest(token), row['id'], current_time + 8 * 3600))
    conn.execute('DELETE FROM login_attempts WHERE key=?', (key,))
    audit(conn, tenant, row['id'], row['role'], 'login.succeeded')
    conn.commit()
    return token


def guest(conn, headers):
    token = cookie_value(headers, 'alfa_guest')
    if token and conn.execute('SELECT 1 FROM guest_sessions WHERE digest=? AND expires_at>?', (digest(token), int(time.time()))).fetchone():
        return digest(token), None
    token = secrets.token_urlsafe(32)
    conn.execute('DELETE FROM guest_sessions WHERE expires_at<=?', (int(time.time()),))
    conn.execute('INSERT INTO guest_sessions VALUES(?,?)', (digest(token), int(time.time()) + 30 * 86400))
    return digest(token), cookie_header('alfa_guest', token, 30 * 86400)


def public_venue(venue):
    return {key: venue[key] for key in ('name', 'address', 'bill', 'mapUrl') if key in venue}


def public_employee(employee):
    fields = ('id', 'name', 'role', 'initials', 'color', 'active', 'bio', 'photo', 'goal', 'goalTarget')
    return {key: employee[key] for key in fields if key in employee}


def view_store(conn, store, tenant, identity=None, guest_digest=None):
    if identity and identity['role'] == 'manager':
        return store
    allowed = ('version', '_revision', '_tenant', 'venue', 'employees', 'tips', 'withdrawals', 'settings', 'profile', 'oranges')
    result = json.loads(json.dumps({key: store[key] for key in allowed if key in store}))
    result['venue'] = public_venue(store['venue'])
    result['settings'] = {'shares': [], 'recipientIds': []}
    result['oranges'] = {'balance': 0, 'events': []}
    result['withdrawals'] = []
    result['profile'] = {'goal': '', 'target': 5000000, 'notifications': False}
    if identity:
        person = identity['employee_id']
        employee = next((item for item in store['employees'] if item['id'] == person), None)
        if employee is None:
            raise AccessError('Профиль сотрудника больше не доступен', 403)
        result['employees'] = [employee]
        result['tips'] = [{**tip, 'amount': tip['allocations'][person], 'allocations': {person: tip['allocations'][person]}, 'oranges': 0} for tip in store['tips'] if tip['allocations'].get(person, 0) > 0]
        result['withdrawals'] = [item for item in store['withdrawals'] if item.get('employeeId', 'alex') == person]
        result['profile'] = store['profile'] if person == 'alex' else {'goal': employee.get('goal', ''), 'target': employee.get('goalTarget', 5000000), 'notifications': employee.get('notifications', True)}
    else:
        ids = {row[0] for row in conn.execute('SELECT payment_id FROM payment_owners WHERE tenant=? AND guest_digest=?', (tenant, guest_digest))}
        result['tips'] = [tip for tip in store['tips'] if tip['id'] in ids]
        result['employees'] = [public_employee(item) for item in store['employees'] if item['active']]
        events = [event for event in store['oranges']['events'] if event['tipId'] in ids]
        result['oranges'] = {'events': events, 'balance': sum(event['amount'] for event in events)}
    return result


def employee_update(current, incoming, projected, identity):
    person = identity['employee_id']
    for field in ('venue', 'tips', 'settings', 'oranges'):
        if incoming[field] != projected[field]:
            raise AccessError('Сотрудник не может изменять данные заведения', 403)
    if len(incoming['employees']) != 1 or incoming['employees'][0]['id'] != person:
        raise AccessError('Можно изменять только свой профиль', 403)
    before, after = projected['employees'][0], incoming['employees'][0]
    editable = {'name', 'bio', 'goal', 'goalTarget', 'cardLast4', 'notifications'}
    if any(before.get(key) != after.get(key) for key in before.keys() | after.keys() if key not in editable):
        raise AccessError('Недостаточно прав на изменение сотрудника', 403)
    if any(item.get('employeeId', 'alex') != person for item in incoming['withdrawals']):
        raise AccessError('Вывод доступен только со своего баланса', 403)
    updated = json.loads(json.dumps(current))
    updated['employees'] = [after if employee['id'] == person else employee for employee in current['employees']]
    updated['withdrawals'] = [item for item in current['withdrawals'] if item.get('employeeId', 'alex') != person] + incoming['withdrawals']
    if person == 'alex':
        updated['profile'] = incoming['profile']
    return updated
