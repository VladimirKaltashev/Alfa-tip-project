"""Create a consistent SQLite snapshot, including committed WAL transactions."""
from __future__ import annotations

import argparse
import sqlite3
from contextlib import closing
from pathlib import Path

from backend.server import DB_PATH


def backup(source: Path, destination: Path) -> None:
    source = source.resolve(strict=True)
    destination = destination.resolve()
    if source == destination:
        raise ValueError("Резервная копия должна иметь отдельный путь")
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Reserve a new name; never overwrite a previous backup.
    with destination.open('xb'):
        pass
    try:
        with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)) as reader:
            writer = sqlite3.connect(destination)
            try:
                reader.backup(writer)
                if writer.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise RuntimeError("Проверка резервной копии не пройдена")
            finally:
                writer.close()
    except Exception:
        destination.unlink(missing_ok=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    backup(DB_PATH, args.destination)
    print(f"SQLite backup created: {args.destination}")


if __name__ == '__main__':
    main()
