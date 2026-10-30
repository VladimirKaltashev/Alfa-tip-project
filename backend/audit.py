"""Validated, tenant-scoped audit queries with stable keyset pagination."""
from __future__ import annotations

import json
from urllib.parse import parse_qs


ACTIONS = frozenset({
    'state.updated', 'payment.created', 'withdrawal.created', 'account.created',
    'account.revoked', 'login.succeeded', 'login.failed', 'logout',
    'venue.created', 'account.password_reset',
})
ROLES = frozenset({'manager', 'employee', 'guest', 'anonymous', 'administrator'})
MAX_ID = 9223372036854775807


def page(conn, tenant: str, query_string: str) -> dict:
    query = parse_qs(query_string, keep_blank_values=True, max_num_fields=10)
    if any(key not in {'before', 'action', 'role'} or len(values) != 1
           for key, values in query.items()):
        raise ValueError('Неизвестный или повторяющийся параметр журнала')
    cursor = query.get('before', [str(MAX_ID)])[0]
    if not cursor.isascii() or not cursor.isdigit() or len(cursor) > 19:
        raise ValueError('Некорректный курсор журнала')
    before = int(cursor)
    if not 0 < before <= MAX_ID:
        raise ValueError('Некорректный курсор журнала')

    clauses = ['a.tenant=?', 'a.id<?']
    parameters = [tenant, before]
    for field, allowed in (('action', ACTIONS), ('role', ROLES)):
        value = query.get(field, [''])[0]
        if value:
            if value not in allowed:
                raise ValueError('Неизвестный фильтр журнала')
            clauses.append(f'a.{field}=?')
            parameters.append(value)

    rows = conn.execute('''
        SELECT a.id, a.actor, a.role, a.action, a.object_id,
               a.created_at, a.metadata, u.username AS actor_name
        FROM audit_events a
        LEFT JOIN staff_users u ON u.id=a.actor AND u.tenant=a.tenant
        WHERE ''' + ' AND '.join(clauses) + ' ORDER BY a.id DESC LIMIT 51', parameters).fetchall()
    events = [{**dict(row), 'metadata': json.loads(row['metadata'])} for row in rows[:50]]
    return {'events': events, 'nextBefore': events[-1]['id'] if len(rows) > 50 else None}
