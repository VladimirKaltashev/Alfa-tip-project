from __future__ import annotations

import copy
import http.client
import json
import sqlite3
import tempfile
import threading
import time
import unittest
from http.cookies import SimpleCookie
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from backend import server, security
from backend.test_server import store


class QuietHandler(server.ApiHandler):
    def log_message(self, *args):
        pass


class HttpFixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old_db = server.DB_PATH
        server.DB_PATH = Path(self.tmp.name) / 'test.sqlite3'
        server.setup()
        self.cookies = {'alfa_staff': 'manager-test-session', 'alfa_guest': 'guest-test-session'}
        with server.connect() as conn:
            server.write_state(conn, store())
            for user_id, role, employee_id in [('manager-test', 'manager', None), ('employee-test', 'employee', 'alex')]:
                conn.execute('INSERT INTO staff_users(id,tenant,username,password_hash,role,employee_id) VALUES(?,?,?,?,?,?)', (user_id, 'demo', user_id, 'unused-test-password', role, employee_id))
                conn.execute('INSERT INTO staff_sessions VALUES(?,?,?)', (security.digest(role+'-test-session'), user_id, int(time.time())+3600))
            conn.execute('INSERT INTO guest_sessions VALUES(?,?)', (security.digest('guest-test-session'), int(time.time())+3600))
        self.http = server.ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.base = self.call('POST', '/api/store/initialize', store())[1]

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()
        server.DB_PATH = self.old_db
        self.tmp.cleanup()

    def call(self, method, path, payload=None, token=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.http.server_port, timeout=5)
        try:
            headers = {'Content-Type': 'application/json', 'Cookie': '; '.join(key+'='+value for key,value in self.cookies.items())}
            if token:
                headers['Authorization'] = 'Bearer ' + token
            conn.request(method, path, body=json.dumps(payload) if payload is not None else None, headers=headers)
            result = conn.getresponse()
            for name, value in result.getheaders():
                if name.lower() == 'set-cookie':
                    parsed = SimpleCookie(value)
                    for key, cookie in parsed.items():
                        self.cookies[key] = cookie.value
            return result.status, json.loads(result.read())
        finally:
            conn.close()

    def payment(self, **changes):
        return {'id': 'payment-one', 'amount': '100', 'recipientIds': ['alex'], 'method': 'СБП', 'rating': 5, 'tags': [], 'comment': '', **changes}

    def pay(self, **changes):
        return self.call('POST', '/api/payments', {'draft': self.payment(**changes)})


class HttpTests(HttpFixture):
    def test_initialize_never_overwrites_existing_database(self):
        different = store()
        different['venue']['name'] = 'Other'
        status, result = self.call('POST', '/api/store/initialize', different)
        self.assertEqual(status, 200)
        self.assertEqual(result, self.base)

    def test_stale_save_cannot_overwrite_another_device(self):
        edit = copy.deepcopy(self.base)
        edit['venue']['name'] = 'Updated'
        status, updated = self.call('PUT', '/api/store', edit)
        self.assertEqual(status, 200)
        self.assertEqual(updated['_revision'], self.base['_revision'] + 1)
        self.assertEqual(self.call('PUT', '/api/store', self.base)[0], 409)
        self.assertEqual(self.call('GET', '/api/store')[1]['venue']['name'], 'Updated')

    def test_two_concurrent_updates_have_only_one_winner(self):
        with ThreadPoolExecutor(2) as pool:
            responses = list(pool.map(lambda _: self.call('PUT', '/api/store', self.base), range(2)))
        self.assertEqual(sorted(status for status, _ in responses), [200, 409])

    def test_concurrent_payment_is_credited_once(self):
        with ThreadPoolExecutor(2) as pool:
            responses = list(pool.map(lambda _: self.pay(), range(2)))
        self.assertEqual([status for status, _ in responses], [200, 200])
        saved = self.call('GET', '/api/store')[1]
        self.assertEqual(len(saved['tips']), 1)
        self.assertEqual(saved['oranges']['balance'], 1)
        self.assertEqual(saved['_revision'], self.base['_revision'] + 1)

    def test_idempotency_rejects_changed_amount_or_recipients(self):
        self.assertEqual(self.pay()[0], 200)
        for changed in ({'amount': '200'}, {'recipientIds': ['maria']}, {'comment': 'Changed'}):
            self.assertEqual(self.pay(**changed)[0], 409)
        self.assertEqual(len(self.call('GET', '/api/store')[1]['tips']), 1)

    def test_payment_replay_still_works_after_recipient_paused(self):
        self.pay()
        saved = self.call('GET', '/api/store')[1]
        saved['employees'][0]['active'] = False
        self.assertEqual(self.call('PUT', '/api/store', saved)[0], 200)
        self.assertEqual(self.pay()[0], 200)
        self.assertEqual(self.pay(id='another')[0], 400)

    def test_invalid_payment_ids_do_not_create_or_truncate_payments(self):
        for key in ('x' * 101, '', 123, {}, 'bad/id'):
            self.assertEqual(self.pay(id=key)[0], 400)
        self.assertEqual(self.call('GET', '/api/store')[1]['tips'], [])

    def test_general_put_cannot_create_payment_or_bonus(self):
        edit = copy.deepcopy(self.base)
        edit['tips'] = [server.create_tip(edit, self.payment())]
        self.assertEqual(self.call('PUT', '/api/store', edit)[0], 400)
        self.pay()
        edit = self.call('GET', '/api/store')[1]
        edit['oranges']['events'][0]['amount'] = 500
        edit['oranges']['balance'] = 500
        self.assertEqual(self.call('PUT', '/api/store', edit)[0], 400)

    def test_pool_distribution_rejects_unknown_recipient_and_preserves_total(self):
        initial = store()
        pending = server.create_tip(initial, self.payment())
        pending['allocations'] = {}
        initial['tips'] = [pending]
        with server.connect() as conn:
            server.write_state(conn, initial)
        saved = self.call('GET', '/api/store')[1]
        saved['tips'][0]['allocations'] = {'unknown': 10000}
        self.assertEqual(self.call('PUT', '/api/store', saved)[0], 400)
        saved['tips'][0]['allocations'] = {'alex': 9999}
        self.assertEqual(self.call('PUT', '/api/store', saved)[0], 400)
        saved['tips'][0]['allocations'] = {'alex': 7000, 'maria': 3000}
        saved['employees'][0]['active'] = False
        self.assertEqual(self.call('PUT', '/api/store', saved)[0], 400)
        saved['employees'][0]['active'] = True
        status, result = self.call('PUT', '/api/store', saved)
        self.assertEqual(status, 200)
        self.assertEqual(sum(result['tips'][0]['allocations'].values()), 10000)

    def test_payment_and_settings_race_cannot_drop_payment(self):
        self.pay()
        self.assertEqual(self.call('PUT', '/api/store', self.base)[0], 409)
        self.assertEqual(len(self.call('GET', '/api/store')[1]['tips']), 1)

    def test_withdrawals_cannot_exceed_server_balance(self):
        self.cookies['alfa_staff'] = 'employee-test-session'
        self.pay()
        saved = self.call('GET', '/api/store')[1]
        saved['withdrawals'] = [{'id': 'withdraw-one', 'employeeId': 'alex', 'amount': 10001, 'date': server.now()}]
        self.assertEqual(self.call('PUT', '/api/store', saved)[0], 400)
        saved['withdrawals'][0]['amount'] = 10000
        status, first = self.call('PUT', '/api/store', saved)
        self.assertEqual(status, 200)
        self.assertEqual(self.call('PUT', '/api/store', saved)[0], 409)
        first['withdrawals'].append({'id': 'withdraw-two', 'employeeId': 'alex', 'amount': 1, 'date': server.now()})
        self.assertEqual(self.call('PUT', '/api/store', first)[0], 400)

    def test_concurrent_withdrawals_cannot_double_spend(self):
        self.cookies['alfa_staff'] = 'employee-test-session'
        self.pay()
        saved = self.call('GET', '/api/store')[1]
        def withdraw(index):
            edit = copy.deepcopy(saved)
            edit['withdrawals'] = [{'id': f'withdraw-{index}', 'employeeId': 'alex', 'amount': 10000, 'date': server.now()}]
            return self.call('PUT', '/api/store', edit)[0]
        with ThreadPoolExecutor(2) as pool:
            self.assertEqual(sorted(pool.map(withdraw, range(2))), [200, 409])
        self.assertEqual(len(self.call('GET', '/api/store')[1]['withdrawals']), 1)

    def test_malformed_store_returns_json_error_and_keeps_data(self):
        for key, value in (('employees', [{}]), ('tips', [None]), ('withdrawals', 'bad'), ('venue', []), ('oranges', {'events': [{}]})):
            edit = {**self.base, key: value}
            status, result = self.call('PUT', '/api/store', edit)
            self.assertEqual(status, 400)
            self.assertIn('error', result)
        self.assertEqual(self.call('GET', '/api/store')[1], self.base)

    def test_alfa_challenge_is_bound_to_phone_and_single_use(self):
        payload = {'phone': '+79990000000', 'code': '123456'}
        self.assertEqual(self.call('POST', '/api/auth/alfa-id/verify', payload)[0], 400)
        _, challenge = self.call('POST', '/api/auth/alfa-id/request', {'phone': payload['phone']})
        payload['challengeId'] = challenge['challengeId']
        self.assertEqual(self.call('POST', '/api/auth/alfa-id/verify', {**payload, 'phone': '+79990000001'})[0], 400)
        status, identity = self.call('POST', '/api/auth/alfa-id/verify', payload)
        self.assertEqual(status, 200)
        self.assertGreater(identity['expiresAt'], time.time())
        self.assertEqual(self.call('POST', '/api/auth/alfa-id/verify', payload)[0], 400)
        self.assertEqual(self.call('POST', '/api/payments', {'draft': self.payment(method='Alfa Pay')}, identity['token'])[0], 200)

    def test_expired_challenge_and_session_are_rejected(self):
        with server.connect() as conn:
            conn.execute('INSERT INTO alfa_challenges VALUES(?,?,?)', ('expired', '9990000000', 1))
            conn.execute('INSERT INTO alfa_sessions(token,phone,created_at,expires_at) VALUES(?,?,?,?)', ('expired', '9990000000', server.now(), 1))
        self.assertEqual(self.call('POST', '/api/auth/alfa-id/verify', {'phone': '+79990000000', 'code': '123456', 'challengeId': 'expired'})[0], 400)
        self.assertEqual(self.call('POST', '/api/payments', {'draft': self.payment(method='Alfa Pay')}, 'expired')[0], 401)

    def test_health_checks_database_without_exposing_path(self):
        self.assertEqual(self.call('GET', '/api/health'), (200, {'status': 'ok'}))
        with server.connect() as conn:
            conn.execute('DROP TABLE application_state')
        self.assertEqual(self.call('GET', '/api/health')[0], 503)
        self.assertEqual(self.call('GET', '/api/store')[0], 503)

    def test_invalid_distribution_settings_are_rejected(self):
        for settings in ({'shares': [70, 40]}, {'shares': [True]}, {'shares': [float('nan')]}, {'shares': [100], 'recipientIds': ['unknown']}, {'shares': [50, 50], 'recipientIds': ['alex', 'alex']}):
            self.assertEqual(self.call('PUT', '/api/store', {**self.base, 'settings': settings})[0], 400)
        self.assertEqual(self.call('PUT', '/api/store', {**self.base, 'settings': {'shares': [70, 30], 'recipientIds': ['alex', 'maria']}})[0], 200)

    def test_invalid_profile_cannot_break_other_clients(self):
        for profile in ({'goal': {}}, {'target': -1}, {'notifications': 'yes'}):
            self.assertEqual(self.call('PUT', '/api/store', {**self.base, 'profile': profile})[0], 400)

    def test_bad_json_and_invalid_money_types_return_400(self):
        for amount in (True, {}, '1e4', '50000.01'):
            self.assertEqual(self.pay(amount=amount)[0], 400)
        conn = http.client.HTTPConnection('127.0.0.1', self.http.server_port, timeout=5)
        try:
            conn.request('POST', '/api/payments', body='{broken', headers={'Content-Type': 'application/json'})
            response = conn.getresponse()
            self.assertEqual(response.status, 400)
            self.assertIn('error', json.loads(response.read()))
        finally:
            conn.close()


class MigrationTests(unittest.TestCase):
    def test_existing_database_is_migrated_without_data_loss(self):
        with tempfile.TemporaryDirectory() as directory:
            old_path = server.DB_PATH
            try:
                server.DB_PATH = Path(directory) / 'legacy.sqlite3'
                with sqlite3.connect(server.DB_PATH) as conn:
                    conn.execute('CREATE TABLE application_state(state_key TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at TEXT NOT NULL)')
                    conn.execute('CREATE TABLE alfa_sessions(token TEXT PRIMARY KEY,phone TEXT NOT NULL,created_at TEXT NOT NULL)')
                    conn.execute('INSERT INTO application_state VALUES(?,?,?)', ('demo', json.dumps(store()), server.now()))
                server.setup()
                server.setup()
                with server.connect() as conn:
                    migrated = server.read_state(conn)
                    self.assertEqual(migrated['venue'], store()['venue'])
                    self.assertEqual(migrated['_revision'], 1)
                    self.assertFalse(server.has_alfa_session(conn, 'Bearer old'))
            finally:
                server.DB_PATH = old_path
