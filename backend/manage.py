"""Administrative provisioning; there are no default passwords or public signup."""
from __future__ import annotations

import argparse
import getpass
import sqlite3

from backend import security, server
from backend.validation import identifier, validate_store


def password():
    value = getpass.getpass('Password (12–128 characters): ')
    if value != getpass.getpass('Confirm password: '):
        raise ValueError('Passwords do not match')
    return value


def empty_store(name, address):
    return {'version': 1, 'venue': {'name': name, 'address': address, 'bill': 100000},
            'employees': [], 'tips': [], 'withdrawals': [], 'settings': {'shares': [], 'recipientIds': []},
            'profile': {'goal': '', 'target': 5000000, 'notifications': True}, 'oranges': {'balance': 0, 'events': []}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    create = commands.add_parser('create-venue')
    create.add_argument('tenant')
    create.add_argument('--name', required=True)
    create.add_argument('--address', required=True)
    create.add_argument('--username', required=True)
    user = commands.add_parser('create-user')
    user.add_argument('tenant')
    user.add_argument('--username', required=True)
    user.add_argument('--role', choices=['manager', 'employee'], required=True)
    user.add_argument('--employee-id')
    reset = commands.add_parser('reset-password')
    reset.add_argument('tenant')
    reset.add_argument('--username', required=True)
    args = parser.parse_args()
    identifier(args.tenant)
    secret = password()
    server.setup()
    try:
        with server.connect() as conn:
            conn.execute('BEGIN IMMEDIATE')
            state = server.read_state(conn, args.tenant)
            if args.command == 'create-venue':
                if state is not None:
                    raise ValueError('Venue already exists; use create-user to add an account')
                state = validate_store(empty_store(args.name, args.address))
                server.write_state(conn, state, args.tenant)
                user_id = security.create_user(conn, args.tenant, args.username, secret, 'manager')
                action = 'venue.created'
            elif args.command == 'create-user':
                if state is None:
                    raise ValueError('Venue does not exist')
                if args.role == 'employee' and args.employee_id not in {item['id'] for item in state['employees']}:
                    raise ValueError('Employee does not belong to this venue')
                user_id = security.create_user(conn, args.tenant, args.username, secret, args.role, args.employee_id)
                action = 'account.created'
            else:
                row = conn.execute('SELECT id FROM staff_users WHERE tenant=? AND username=?', (args.tenant, args.username.lower())).fetchone()
                if row is None:
                    raise ValueError('Account does not exist')
                user_id = row['id']
                conn.execute('UPDATE staff_users SET password_hash=?,active=1 WHERE id=?', (security.hash_password(secret), user_id))
                conn.execute('DELETE FROM staff_sessions WHERE user_id=?', (user_id,))
                action = 'account.password_reset'
            security.audit(conn, args.tenant, 'administrator-cli', 'administrator', action, user_id)
            conn.commit()
    except (ValueError, sqlite3.IntegrityError) as error:
        parser.exit(1, str(error) + '\n')
    print(f'Completed: {args.command}; venue={args.tenant}; username={args.username}')


if __name__ == '__main__':
    main()
