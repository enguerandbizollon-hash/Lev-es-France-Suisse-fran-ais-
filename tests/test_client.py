"""Tests unitaires de la logique du client, avec une fausse API Sheets en mémoire.

Ne nécessite aucune credential Google : on injecte un faux service qui simule
`spreadsheets().values().get/update/append/batchUpdate` sur une grille locale.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from gsheets_connector.client import SheetsClient, _column_letter  # noqa: E402


class _FakeValues:
    def __init__(self, grid):
        self.grid = grid  # liste de listes

    # -- get --
    def get(self, spreadsheetId, range):
        return _Exec(lambda: {"values": [list(r) for r in self.grid]})

    # -- update (écrase une cellule unique dans nos tests) --
    def update(self, spreadsheetId, range, valueInputOption, body):
        def run():
            self._write_range(range, body["values"])
            return {"updatedCells": sum(len(r) for r in body["values"])}
        return _Exec(run)

    # -- append --
    def append(self, spreadsheetId, range, valueInputOption, insertDataOption, body):
        def run():
            for row in body["values"]:
                self.grid.append(list(row))
            return {"updates": {"updatedRows": len(body["values"])}}
        return _Exec(run)

    # -- batchUpdate --
    def batchUpdate(self, spreadsheetId, body):
        def run():
            for item in body["data"]:
                self._write_range(item["range"], item["values"])
            return {"totalUpdatedCells": len(body["data"])}
        return _Exec(run)

    def _write_range(self, a1, values):
        # Supporte 'Sheet!B3' (cellule unique) suffisant pour les tests d'upsert.
        cell = a1.split("!", 1)[1]
        col_letters = "".join(c for c in cell if c.isalpha())
        row_num = int("".join(c for c in cell if c.isdigit()))
        col_idx = 0
        for ch in col_letters:
            col_idx = col_idx * 26 + (ord(ch) - ord("A") + 1)
        col_idx -= 1
        row_idx = row_num - 1
        while len(self.grid) <= row_idx:
            self.grid.append([])
        row = self.grid[row_idx]
        while len(row) <= col_idx:
            row.append("")
        row[col_idx] = values[0][0]


class _Exec:
    def __init__(self, fn):
        self._fn = fn

    def execute(self):
        return self._fn()


class _FakeService:
    def __init__(self, grid):
        self._values = _FakeValues(grid)

    def spreadsheets(self):
        return self

    def values(self):
        return self._values


def _make_client(grid):
    return SheetsClient(service=_FakeService(grid))


def test_column_letter():
    assert _column_letter(0) == "A"
    assert _column_letter(25) == "Z"
    assert _column_letter(26) == "AA"
    assert _column_letter(27) == "AB"
    assert _column_letter(51) == "AZ"


def test_read_records():
    grid = [["Nom", "Email"], ["ACME", "a@acme.com"], ["Foo", "f@foo.com"]]
    client = _make_client(grid)
    recs = client.read_records("id", "Prospects")
    assert recs == [
        {"Nom": "ACME", "Email": "a@acme.com"},
        {"Nom": "Foo", "Email": "f@foo.com"},
    ]


def test_find_row():
    grid = [["Nom", "Email"], ["ACME", "a@acme.com"], ["Foo", "f@foo.com"]]
    client = _make_client(grid)
    assert client.find_row("id", "Prospects", "Email", "f@foo.com") == 3
    assert client.find_row("id", "Prospects", "Email", "absent@x.com") is None


def test_upsert_update_existing():
    grid = [["Nom", "Email", "Statut"], ["ACME", "a@acme.com", "Nouveau"]]
    client = _make_client(grid)
    res = client.upsert(
        "id", "Prospects", key_column="Email", key_value="a@acme.com",
        updates={"Statut": "Relancé"},
    )
    assert res == {"action": "updated", "row": 2}
    assert grid[1] == ["ACME", "a@acme.com", "Relancé"]


def test_upsert_insert_new():
    grid = [["Nom", "Email", "Statut"], ["ACME", "a@acme.com", "Nouveau"]]
    client = _make_client(grid)
    res = client.upsert(
        "id", "Prospects", key_column="Email", key_value="new@x.com",
        updates={"Nom": "NewCo", "Statut": "Prospect"},
    )
    assert res["action"] == "inserted"
    assert grid[-1] == ["NewCo", "new@x.com", "Prospect"]


def test_upsert_rejects_unknown_column():
    grid = [["Nom", "Email"], ["ACME", "a@acme.com"]]
    client = _make_client(grid)
    try:
        client.upsert("id", "P", key_column="Email", key_value="a@acme.com",
                      updates={"Inexistante": "x"})
    except ValueError as e:
        assert "Inexistante" in str(e)
    else:
        raise AssertionError("Une ValueError était attendue pour colonne inconnue")


if __name__ == "__main__":
    import traceback

    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except Exception:
            failed += 1
            print(f"FAIL {t.__name__}")
            traceback.print_exc()
    print(f"\n{len(tests) - failed}/{len(tests)} tests réussis")
    sys.exit(1 if failed else 0)
