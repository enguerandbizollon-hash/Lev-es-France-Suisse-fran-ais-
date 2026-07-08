"""Client haut niveau pour manipuler des Google Sheets.

Expose des opérations orientées usage réel (CRM, suivis, tableaux de bord) :
lecture de plages, écriture, ajout de lignes, et surtout `upsert` — mettre à
jour une ligne repérée par une colonne clé (ex. Email), ou l'ajouter si absente.
"""

from __future__ import annotations

from typing import Any, Optional


def _column_letter(index_zero_based: int) -> str:
    """Convertit un index de colonne (0 -> A, 26 -> AA) en lettre(s)."""
    letters = ""
    n = index_zero_based
    while True:
        n, rem = divmod(n, 26)
        letters = chr(ord("A") + rem) + letters
        if n == 0:
            break
        n -= 1
    return letters


class SheetsClient:
    """Wrapper pratique autour de l'API Google Sheets v4."""

    def __init__(self, service=None):
        if service is None:
            # Import paresseux : n'exige les dépendances Google que si l'on doit
            # réellement construire un service (pas pour les tests avec faux service).
            from .auth import build_sheets_service

            service = build_sheets_service()
        self._service = service

    @property
    def _values(self):
        return self._service.spreadsheets().values()

    # ---- Métadonnées ---------------------------------------------------

    def list_tabs(self, spreadsheet_id: str) -> list[str]:
        """Retourne les noms des onglets (feuilles) d'un classeur."""
        meta = (
            self._service.spreadsheets()
            .get(spreadsheetId=spreadsheet_id, fields="sheets.properties.title")
            .execute()
        )
        return [s["properties"]["title"] for s in meta.get("sheets", [])]

    # ---- Lecture -------------------------------------------------------

    def read(self, spreadsheet_id: str, a1_range: str) -> list[list[Any]]:
        """Lit une plage A1 (ex. 'Feuille1!A1:D20') et retourne une grille."""
        resp = (
            self._values.get(spreadsheetId=spreadsheet_id, range=a1_range).execute()
        )
        return resp.get("values", [])

    def read_records(
        self, spreadsheet_id: str, sheet: str, header_row: int = 1
    ) -> list[dict[str, Any]]:
        """Lit une feuille sous forme de liste de dictionnaires.

        La ligne `header_row` (1-indexée) fournit les noms de colonnes.
        """
        grid = self.read(spreadsheet_id, sheet)
        if len(grid) < header_row:
            return []
        headers = grid[header_row - 1]
        records = []
        for row in grid[header_row:]:
            # Complète les cellules manquantes en fin de ligne.
            padded = row + [""] * (len(headers) - len(row))
            records.append(dict(zip(headers, padded)))
        return records

    # ---- Écriture ------------------------------------------------------

    def write(
        self,
        spreadsheet_id: str,
        a1_range: str,
        values: list[list[Any]],
        value_input_option: str = "USER_ENTERED",
    ) -> dict:
        """Écrit une grille de valeurs dans une plage A1 (écrase les cellules).

        `USER_ENTERED` interprète formules/dates comme dans l'UI ; utiliser
        `RAW` pour écrire les valeurs telles quelles.
        """
        body = {"values": values}
        return (
            self._values.update(
                spreadsheetId=spreadsheet_id,
                range=a1_range,
                valueInputOption=value_input_option,
                body=body,
            ).execute()
        )

    def append_row(
        self,
        spreadsheet_id: str,
        sheet: str,
        values: list[Any],
        value_input_option: str = "USER_ENTERED",
    ) -> dict:
        """Ajoute une ligne à la fin des données d'une feuille."""
        body = {"values": [values]}
        return (
            self._values.append(
                spreadsheetId=spreadsheet_id,
                range=sheet,
                valueInputOption=value_input_option,
                insertDataOption="INSERT_ROWS",
                body=body,
            ).execute()
        )

    # ---- Recherche & upsert -------------------------------------------

    def find_row(
        self, spreadsheet_id: str, sheet: str, key_column: str, key_value: str
    ) -> Optional[int]:
        """Retourne le numéro de ligne (1-indexé, incluant l'en-tête) dont la
        cellule de `key_column` vaut `key_value`, ou None si absente.
        """
        grid = self.read(spreadsheet_id, sheet)
        if not grid:
            return None
        headers = grid[0]
        if key_column not in headers:
            raise ValueError(
                f"Colonne clé '{key_column}' introuvable. Colonnes : {headers}"
            )
        col_idx = headers.index(key_column)
        for offset, row in enumerate(grid[1:], start=2):  # ligne 1 = en-tête
            if col_idx < len(row) and str(row[col_idx]) == str(key_value):
                return offset
        return None

    def upsert(
        self,
        spreadsheet_id: str,
        sheet: str,
        key_column: str,
        key_value: str,
        updates: dict[str, Any],
        value_input_option: str = "USER_ENTERED",
    ) -> dict:
        """Met à jour la ligne repérée par `key_column == key_value`.

        Si la ligne existe, seules les colonnes de `updates` sont modifiées.
        Sinon, une nouvelle ligne est ajoutée (clé + updates).

        Retourne {'action': 'updated'|'inserted', 'row': <n|None>}.
        """
        grid = self.read(spreadsheet_id, sheet)
        if not grid:
            raise ValueError(
                f"La feuille '{sheet}' est vide : impossible de localiser les en-têtes."
            )
        headers = grid[0]
        if key_column not in headers:
            raise ValueError(
                f"Colonne clé '{key_column}' introuvable. Colonnes : {headers}"
            )

        unknown = [c for c in updates if c not in headers]
        if unknown:
            raise ValueError(
                f"Colonnes inconnues dans updates : {unknown}. Colonnes : {headers}"
            )

        row_number = self.find_row(spreadsheet_id, sheet, key_column, key_value)

        if row_number is None:
            # Insertion : construit une ligne complète alignée sur les en-têtes.
            new_row = []
            for header in headers:
                if header == key_column:
                    new_row.append(key_value)
                else:
                    new_row.append(updates.get(header, ""))
            self.append_row(spreadsheet_id, sheet, new_row, value_input_option)
            return {"action": "inserted", "row": None}

        # Mise à jour ciblée : une requête par cellule modifiée, groupées en batch.
        data = []
        for header, value in updates.items():
            col_letter = _column_letter(headers.index(header))
            a1 = f"{sheet}!{col_letter}{row_number}"
            data.append({"range": a1, "values": [[value]]})

        if data:
            self._values.batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={"valueInputOption": value_input_option, "data": data},
            ).execute()

        return {"action": "updated", "row": row_number}
