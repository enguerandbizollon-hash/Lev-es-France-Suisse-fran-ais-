"""Connecteur Google Sheets pour permettre à Claude (ou tout script) de lire,
écrire et mettre à jour des cellules dans des feuilles de calcul existantes.

Usage rapide :

    from gsheets_connector import SheetsClient

    client = SheetsClient()               # auth via compte de service
    client.read("<spreadsheet_id>", "Feuille1!A1:D10")
    client.upsert(
        "<spreadsheet_id>",
        sheet="Prospects",
        key_column="Email",
        key_value="contact@exemple.com",
        updates={"Statut": "Relancé", "Dernier contact": "2026-07-08"},
    )
"""

from .client import SheetsClient

__all__ = ["SheetsClient", "build_sheets_service"]
__version__ = "0.1.0"


def build_sheets_service():
    """Raccourci vers gsheets_connector.auth.build_sheets_service (import paresseux)."""
    from .auth import build_sheets_service as _build

    return _build()
