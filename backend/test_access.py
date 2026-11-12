from __future__ import annotations

import copy
import http.client
import json
import sqlite3
import time

from backend import security, server
from backend.test_http import HttpFixture
from backend.test_server import store


class AccessTests(HttpFixture):
    def setUp(self):
        super().setUp()
        with server.connect() as conn:
            other = store()
            other['venue']['name'] = 'Other cafe'
            server.write_state(conn, other, 'other')
            conn.execute('INSERT INTO staff_users(id,tenant,username,password_hash,role) VALUES(?,?,?,?,?)', ('other-manager', 'other', 'other', 'unused', 'manager'))
            conn.execute('INSERT INTO staff_sessions VALUES(?,?,?)', (security.digest('other-manager-session'), 'other-manager', int(time.time())+3600))

    def raw(self, method, path, data=None, tenant='demo', cookies=None, origin=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.http.server_port, timeout=5)
        headers = {'Content-Type': 'application/json', 'X-Venue-ID': tenant}
        if cookies is not None:
            headers['Cookie'] = cookies
        if origin:
            headers['Origin'] = origin
        try:
            conn.request(method, path, body=json.dumps(data) if data is not None else None, headers=headers)
            response = conn.getresponse()
            return response.status, json.loads(response.read()), response.getheaders()
        finally:
            conn.close()

    def test_anonymous_has_no_staff_access_or_public_initialization(self):
        for method, path, data in [('GET', '/api/store', None), ('PUT', '/api/store', self.base), ('POST', '/api/store/initialize', store()), ('GET', '/api/audit', None), ('GET', '/api/team/accounts', None)]:
            self.assertEqual(self.raw(method, path, data)[0], 401)

    def test_manager_cannot_select_another_tenant(self):
        for path in ('/api/store', '/api/audit', '/api/team/accounts', '/api/auth/session'):
            self.assertEqual(self.raw('GET', path, tenant='other', cookies='alfa_staff=manager-test-session')[0], 403)
        self.assertEqual(self.raw('PUT', '/api/store', self.base, tenant='other', cookies='alfa_staff=manager-test-session')[0], 403)

    def test_public_view_does_not_expose_history_cards_or_staff_settings(self):
        with server.connect() as conn:
            state = server.read_state(conn)
            state['internalNotes'] = 'private-manager-data'
            state['venue']['internalContact'] = 'private-contact'
            server.write_state(conn, state)
        self.pay()
        status, view, _ = self.raw('GET', '/api/guest/store')
        self.assertEqual(status, 200)
        self.assertEqual(view['tips'], [])
        self.assertEqual(view['oranges']['events'], [])
        self.assertEqual(view['withdrawals'], [])
        self.assertTrue(all('cardLast4' not in item for item in view['employees']))
        self.assertEqual(view['profile']['goal'], '')
        self.assertNotIn('internalNotes', view)
        self.assertNotIn('internalContact', view['venue'])
        status, venue, _ = self.raw('GET', '/api/venue')
        self.assertEqual(status, 200)
        self.assertNotIn('internalContact', venue['venue'])
        self.assertTrue(all('cardLast4' not in item for item in venue['employees']))

    def test_guest_payment_read_and_replay_are_owner_bound(self):
        status, response = self.pay()
        self.assertEqual(status, 200)
        self.assertEqual(len(response['store']['tips']), 1)
        self.assertEqual(self.raw('GET', '/api/payments/payment-one')[0], 404)
        self.assertEqual(self.raw('POST', '/api/payments', {'draft': self.payment()})[0], 409)
        self.assertEqual(self.call('GET', '/api/payments/payment-one')[0], 200)

    def test_same_payment_id_in_two_venues_is_independent(self):
        self.pay()
        status, result, _ = self.raw('POST', '/api/payments', {'draft': self.payment(amount='200')}, tenant='other', cookies='alfa_guest=guest-test-session')
        self.assertEqual(status, 200)
        self.assertEqual(result['store']['_tenant'], 'other')
        self.assertEqual(result['payment']['amount'], 20000)
        with server.connect() as conn:
            self.assertEqual(server.read_state(conn)['tips'][0]['amount'], 10000)
            self.assertEqual(server.read_state(conn, 'other')['tips'][0]['amount'], 20000)

    def test_employee_sees_own_share_and_cannot_edit_other_entities(self):
        self.pay(recipientIds=['alex', 'maria'])
        self.cookies['alfa_staff'] = 'employee-test-session'
        status, own = self.call('GET', '/api/store')
        self.assertEqual(status, 200)
        self.assertEqual([item['id'] for item in own['employees']], ['alex'])
        self.assertEqual(own['tips'][0]['amount'], 5000)
        for mutation in ('venue', 'role', 'withdrawal'):
            edited = copy.deepcopy(own)
            if mutation == 'venue':
                edited['venue']['name'] = 'Hijacked'
            elif mutation == 'role':
                edited['employees'][0]['active'] = False
            else:
                edited['withdrawals'] = [{'id': 'attack', 'amount': 1, 'date': server.now(), 'employeeId': 'maria'}]
            self.assertEqual(self.call('PUT', '/api/store', edited)[0], 403)
        own['employees'][0]['bio'] = 'Updated profile'
        self.assertEqual(self.call('PUT', '/api/store', own)[0], 200)
        self.assertEqual(self.call('GET', '/api/audit')[0], 403)
        self.assertEqual(self.call('POST', '/api/team/accounts', {'role': 'manager'})[0], 403)

    def test_manager_cannot_withdraw_on_behalf_of_employee(self):
        self.pay()
        own = self.call('GET', '/api/store')[1]
        own['withdrawals'] = [{'id': 'attack', 'amount': 1, 'date': server.now(), 'employeeId': 'alex'}]
        self.assertEqual(self.call('PUT', '/api/store', own)[0], 403)

    def test_audit_is_tenant_scoped_append_only_and_no_duplicate_payment_event(self):
        self.pay()
        self.pay()
        events = self.call('GET', '/api/audit')[1]['events']
        self.assertEqual(sum(event['action'] == 'payment.created' for event in events), 1)
        status, other, _ = self.raw('GET', '/api/audit', tenant='other', cookies='alfa_staff=other-manager-session')
        self.assertEqual(status, 200)
        self.assertEqual(other['events'], [])
        with server.connect() as conn:
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute('DELETE FROM audit_events')
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute("UPDATE audit_events SET actor='forged'")

    def test_cross_origin_write_is_rejected(self):
        self.assertEqual(self.raw('PUT', '/api/store', self.base, cookies='alfa_staff=manager-test-session', origin='https://untrusted.example')[0], 403)

    def test_login_password_cookie_logout_and_revocation(self):
        password = 'Test-only-long-password-42'
        self.assertEqual(self.call('POST', '/api/team/accounts', {'username': 'alex.login', 'password': password, 'employeeId': 'alex'})[0], 200)
        self.assertEqual(self.call('POST', '/api/auth/login', {'username': 'alex.login', 'password': 'wrong'})[0], 401)
        status, _, headers = self.raw('POST', '/api/auth/login', {'username': 'alex.login', 'password': password})
        self.assertEqual(status, 200)
        cookie = next(value for key,value in headers if key.lower() == 'set-cookie')
        self.assertIn('HttpOnly', cookie)
        self.assertIn('SameSite=Strict', cookie)
        credential = cookie.split(';')[0]
        identity = self.raw('GET', '/api/auth/session', cookies=credential)[1]
        self.assertEqual(identity['role'], 'employee')
        self.assertEqual(self.call('POST', '/api/team/accounts/revoke', {'id': identity['id']})[0], 200)
        self.assertEqual(self.raw('GET', '/api/store', cookies=credential)[0], 401)
        self.assertEqual(self.call('POST', '/api/auth/logout', {})[0], 200)
        self.assertEqual(self.call('GET', '/api/store')[0], 401)
        with server.connect() as conn:
            serialized = str([dict(row) for row in conn.execute('SELECT * FROM audit_events')])
            self.assertNotIn(password, serialized)
            self.assertNotIn(credential, serialized)

    def test_login_throttle_and_expired_staff_session(self):
        with server.connect() as conn:
            conn.execute('INSERT INTO login_attempts VALUES(?,?,?)', (security.digest('demo:127.0.0.1'), 10, int(time.time())+60))
            conn.execute('UPDATE staff_sessions SET expires_at=1')
        self.assertEqual(self.call('POST', '/api/auth/login', {'username': 'someone', 'password': 'not-a-password'})[0], 429)
        self.assertEqual(self.call('GET', '/api/store')[0], 401)

    def test_audit_pagination_has_no_duplicate_or_missing_events(self):
        with server.connect() as conn:
            for index in range(55):
                security.audit(conn, 'demo', 'test', 'manager', 'state.updated', str(index))
        first = self.call('GET', '/api/audit')[1]
        second = self.call('GET', '/api/audit?before='+str(first['nextBefore']))[1]
        ids = [event['id'] for event in first['events']+second['events']]
        self.assertEqual(len(ids), 55)
        self.assertEqual(len(set(ids)), 55)
        self.assertIsNone(second['nextBefore'])

    def test_unknown_tenant_does_not_initialize_from_payment_payload(self):
        self.assertEqual(self.raw('POST', '/api/payments', {'draft': self.payment(), 'store': store()}, tenant='missing')[0], 400)
        self.assertEqual(self.raw('GET', '/api/guest/store', tenant='missing')[0], 404)
        with server.connect() as conn:
            self.assertIsNone(server.read_state(conn, 'missing'))

    def test_audit_filters_apply_before_pagination_and_preserve_tenant_scope(self):
        with server.connect() as conn:
            for index in range(55):
                security.audit(conn, 'demo', 'test', 'employee', 'state.updated', str(index))
                security.audit(conn, 'demo', 'test', 'manager', 'state.updated')
                security.audit(conn, 'demo', 'test', 'employee', 'login.succeeded')
                security.audit(conn, 'other', 'test', 'employee', 'state.updated')
        route = '/api/audit?action=state.updated&role=employee'
        status, first = self.call('GET', route)
        self.assertEqual(status, 200)
        second = self.call('GET', route + '&before=' + str(first['nextBefore']))[1]
        events = first['events'] + second['events']
        self.assertEqual(len(events), 55)
        self.assertEqual(len({event['id'] for event in events}), 55)
        self.assertEqual({event['object_id'] for event in events}, {str(i) for i in range(55)})
        self.assertTrue(all(event['action'] == 'state.updated' and event['role'] == 'employee' for event in events))
        self.assertIsNone(second['nextBefore'])

    def test_audit_rejects_invalid_filters_and_out_of_range_cursors(self):
        for query in ('before=0', 'before=-1', 'before=abc', 'before=',
                      'before=9223372036854775808', 'before=' + '9' * 100,
                      'before=1&before=2', 'action=unknown', 'role=owner',
                      'tenant=other', 'action=state.updated&action=login.failed'):
            with self.subTest(query=query):
                self.assertEqual(self.call('GET', '/api/audit?' + query)[0], 400)
        self.assertEqual(self.raw('GET', '/api/audit?before=bad')[0], 401)
        self.assertEqual(self.call('GET', '/api/health')[0], 200)

    def test_password_hash_is_salted_and_correctly_verified(self):
        first = security.hash_password('A-test-password-only-42')
        second = security.hash_password('A-test-password-only-42')
        self.assertNotEqual(first, second)
        self.assertTrue(security.check_password('A-test-password-only-42', first))
        self.assertFalse(security.check_password('Wrong-test-password-42', first))

    def test_full_service_journey_from_access_to_payment_withdrawal_and_revocation(self):
        # Use real HTTP login and distinct cookies throughout the demo lifecycle.
        credentials = {'username': 'journey.alex', 'password': 'Journey-test-password-42'}
        status, _ = self.call('POST', '/api/team/accounts', {**credentials, 'employeeId': 'alex'})
        self.assertEqual(status, 200)
        status, _, headers = self.raw('POST', '/api/auth/login', credentials)
        self.assertEqual(status, 200)
        employee_cookie = next(value.split(';')[0] for name, value in headers if name.lower() == 'set-cookie')
        identity = self.raw('GET', '/api/auth/session', cookies=employee_cookie)[1]

        status, payment, _ = self.raw('POST', '/api/payments', {
            'draft': self.payment(amount='101.01', recipientIds=['alex', 'maria']),
        }, cookies='alfa_guest=guest-test-session')
        self.assertEqual(status, 200)
        self.assertEqual(payment['payment']['allocations'], {'alex': 5051, 'maria': 5050})
        self.assertEqual(self.raw('GET', '/api/guest/store')[1]['tips'], [])

        status, own, _ = self.raw('GET', '/api/store', cookies=employee_cookie)
        self.assertEqual(status, 200)
        self.assertEqual(own['tips'][0]['amount'], 5051)
        own['withdrawals'].append({'id': 'journey-withdraw', 'employeeId': 'alex', 'amount': 5051, 'date': server.now()})
        self.assertEqual(self.raw('PUT', '/api/store', own, cookies=employee_cookie)[0], 200)
        self.assertEqual(self.raw('PUT', '/api/store', own, cookies=employee_cookie)[0], 409)

        state = self.call('GET', '/api/store')[1]
        self.assertEqual(state['tips'][0]['amount'], 10101)
        self.assertEqual(len(state['withdrawals']), 1)
        audit_page = self.call('GET', '/api/audit?action=withdrawal.created&role=employee')[1]
        self.assertEqual(len(audit_page['events']), 1)
        self.assertEqual(audit_page['events'][0]['actor_name'], credentials['username'])
        self.assertEqual(self.call('POST', '/api/team/accounts/revoke', {'id': identity['id']})[0], 200)
        self.assertEqual(self.raw('GET', '/api/store', cookies=employee_cookie)[0], 401)



    def test_employee_with_balance_cannot_be_deleted_but_can_pause_and_withdraw(self):
        self.pay()
        state = self.call('GET', '/api/store')[1]
        deleted = copy.deepcopy(state)
        deleted['employees'] = [e for e in deleted['employees'] if e['id'] != 'alex']
        deleted['settings'] = {'recipientIds': ['maria'], 'shares': [100]}
        status, error = self.call('PUT', '/api/store', deleted)
        self.assertEqual(status, 400)
        self.assertIn('остатком', error['error'])
        self.assertEqual(self.call('GET', '/api/store')[1], state)
        # Omitting historical tips must not bypass the authoritative balance check.
        deleted['tips'] = []
        self.assertEqual(self.call('PUT', '/api/store', deleted)[0], 400)
        state['employees'][0]['active'] = False
        self.assertEqual(self.call('PUT', '/api/store', state)[0], 200)
        self.cookies['alfa_staff'] = 'employee-test-session'
        own = self.call('GET', '/api/store')[1]
        own['withdrawals'] = [{'id': 'settle', 'amount': 10000, 'date': server.now(), 'employeeId': 'alex'}]
        self.assertEqual(self.call('PUT', '/api/store', own)[0], 200)
        self.cookies['alfa_staff'] = 'manager-test-session'
        settled = self.call('GET', '/api/store')[1]
        settled['employees'] = [e for e in settled['employees'] if e['id'] != 'alex']
        settled['settings'] = {'recipientIds': ['maria'], 'shares': [100]}
        self.assertEqual(self.call('PUT', '/api/store', settled)[0], 200)
        saved = self.call('GET', '/api/store')[1]
        self.assertEqual(saved['tips'][0]['allocations']['alex'], 10000)
        self.assertEqual(saved['withdrawals'][0]['amount'], 10000)

    def test_payment_racing_employee_deletion_preserves_profile_and_balance(self):
        state = self.call('GET', '/api/store')[1]
        state['employees'] = [e for e in state['employees'] if e['id'] != 'alex']
        self.pay()
        self.assertEqual(self.call('PUT', '/api/store', state)[0], 409)
        saved = self.call('GET', '/api/store')[1]
        self.assertIn('alex', {e['id'] for e in saved['employees']})
        self.assertEqual(saved['tips'][0]['allocations']['alex'], 10000)

    def test_public_goal_supports_legacy_profile_without_exposing_private_fields(self):
        with server.connect() as conn:
            state = server.read_state(conn)
            state['profile'] = {'goal': 'Legacy goal', 'target': 5000000, 'notifications': True}
            state['employees'][0]['cardLast4'] = '1234'
            server.write_state(conn, state)
        for route in ('/api/guest/store', '/api/venue'):
            view = self.call('GET', route)[1]
            alex = next(e for e in view['employees'] if e['id'] == 'alex')
            self.assertEqual(alex['goal'], 'Legacy goal')
            self.assertNotIn('cardLast4', alex)
        with server.connect() as conn:
            state = server.read_state(conn)
            state['employees'][0]['goal'] = 'Employee goal'
            server.write_state(conn, state)
        view = self.call('GET', '/api/guest/store')[1]
        self.assertEqual(view['employees'][0]['goal'], 'Employee goal')
        self.assertEqual(view['profile']['goal'], '')
