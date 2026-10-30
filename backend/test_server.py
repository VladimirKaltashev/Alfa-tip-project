from __future__ import annotations

import tempfile
import unittest
import time
from pathlib import Path

from backend import server


def store() -> dict:
    return {
        "version": 1,
        "venue": {"name": "Листва", "address": "Москва", "bill": 350000},
        "employees": [
            {"id": "alex", "name": "Александр", "active": True},
            {"id": "maria", "name": "Мария", "active": True},
        ],
        "tips": [],
        "withdrawals": [],
        "settings": {},
        "profile": {},
        "oranges": {"balance": 0, "events": []},
    }


class BackendModelTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.old_db = server.DB_PATH
        server.DB_PATH = Path(self.tmp.name) / "test.sqlite3"
        server.setup()

    def tearDown(self) -> None:
        server.DB_PATH = self.old_db
        self.tmp.cleanup()

    def test_alfa_pay_is_doubled_and_split_is_exact(self) -> None:
        tip = server.create_tip(store(), {"id": "one", "amount": "350.01", "recipientIds": ["alex", "maria"], "method": "Alfa Pay", "rating": 5})
        self.assertEqual(tip["amount"], 35001)
        self.assertEqual(sum(tip["allocations"].values()), 35001)
        self.assertLessEqual(abs(tip["allocations"]["alex"] - tip["allocations"]["maria"]), 1)
        self.assertEqual(tip["oranges"], 6)

    def test_state_merge_preserves_server_payment_and_bonus(self) -> None:
        current = store()
        current["tips"] = [{"id": "server-payment", "amount": 10000}]
        current["oranges"] = {"balance": 1, "events": [{"tipId": "server-payment", "amount": 1}]}
        incoming = store()
        incoming["venue"]["name"] = "Новое название"
        merged = server.merge_state(current, incoming)
        self.assertEqual(merged["venue"]["name"], "Новое название")
        self.assertEqual([tip["id"] for tip in merged["tips"]], ["server-payment"])
        self.assertEqual(merged["oranges"]["balance"], 1)

    def test_alfa_session_is_checked_in_database(self) -> None:
        with server.connect() as conn:
            conn.execute("INSERT INTO alfa_sessions(token,phone,created_at,expires_at) VALUES(?,?,?,?)", ("valid", "79990000000", server.now(), int(time.time()) + 3600))
            self.assertTrue(server.has_alfa_session(conn, "Bearer valid"))
            self.assertFalse(server.has_alfa_session(conn, "Bearer unknown"))

    def test_review_flag_survives_stale_client(self) -> None:
        current, incoming = store(), store()
        current["tips"] = [{"id": "one", "amount": 1000, "reviewed": False}]
        incoming["tips"] = [{"id": "one", "amount": 999999, "reviewed": True}]
        merged = server.merge_state(current, incoming)
        self.assertTrue(merged["tips"][0]["reviewed"])
        self.assertEqual(merged["tips"][0]["amount"], 1000)
        incoming["tips"][0]["reviewed"] = False
        self.assertTrue(server.merge_state(merged, incoming)["tips"][0]["reviewed"])

    def test_pool_allocation_conserves_amount_and_cannot_be_rewritten(self) -> None:
        current, incoming = store(), store()
        current["tips"] = [{"id": "one", "amount": 1001, "allocations": {}}]
        incoming["tips"] = [{"id": "one", "allocations": {"alex": 501, "maria": 500}}]
        merged = server.merge_state(current, incoming)
        self.assertEqual(merged["tips"][0]["allocations"], {"alex": 501, "maria": 500})
        incoming["tips"][0]["allocations"] = {"alex": 1001}
        self.assertEqual(server.merge_state(merged, incoming)["tips"][0]["allocations"], {"alex": 501, "maria": 500})

    def test_invalid_pool_allocation_is_not_saved(self) -> None:
        current, incoming = store(), store()
        current["tips"] = [{"id": "one", "amount": 1000, "allocations": {}}]
        incoming["tips"] = [{"id": "one", "allocations": {"alex": 999}}]
        self.assertEqual(server.merge_state(current, incoming)["tips"][0]["allocations"], {})

    def test_malformed_recipients_raise_validation_error(self) -> None:
        for recipients in [[{}], [True], ["alex", "alex"], []]:
            with self.subTest(recipients=recipients), self.assertRaises(ValueError):
                server.create_tip(store(), {"id": "one", "amount": "100", "recipientIds": recipients})

    def test_money_is_parsed_exactly(self) -> None:
        self.assertEqual(server.parse_amount("100,01"), 10001)
        self.assertEqual(server.parse_amount("50000"), 5000000)
        for amount in ["50000.01", "9.99", "1e4", "100.001"]:
            with self.subTest(amount=amount), self.assertRaises(ValueError):
                server.parse_amount(amount)


if __name__ == "__main__":
    unittest.main()
