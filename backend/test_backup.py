import sqlite3
import tempfile
import unittest
from pathlib import Path

from backend.backup import backup


class BackupTests(unittest.TestCase):
    def test_live_wal_snapshot_is_readable_and_does_not_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            source, destination = Path(directory) / 'source.sqlite3', Path(directory) / 'snapshot.sqlite3'
            writer = sqlite3.connect(source)
            try:
                writer.execute('PRAGMA journal_mode=WAL')
                writer.execute('CREATE TABLE payments(id TEXT PRIMARY KEY, amount INTEGER)')
                writer.execute('INSERT INTO payments VALUES(?,?)', ('one', 10001))
                writer.commit()
                backup(source, destination)
                restored = sqlite3.connect(destination)
                try:
                    self.assertEqual(restored.execute('SELECT amount FROM payments').fetchone()[0], 10001)
                    self.assertEqual(restored.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
                finally:
                    restored.close()
                with self.assertRaises(FileExistsError):
                    backup(source, destination)
                with self.assertRaises(ValueError):
                    backup(source, source)
            finally:
                writer.close()

    def test_missing_source_does_not_create_empty_database(self):
        with tempfile.TemporaryDirectory() as directory:
            source, destination = Path(directory) / 'absent.sqlite3', Path(directory) / 'snapshot.sqlite3'
            with self.assertRaises(FileNotFoundError):
                backup(source, destination)
            self.assertFalse(source.exists())
            self.assertFalse(destination.exists())
