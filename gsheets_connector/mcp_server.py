"""Serveur MCP exposant le connecteur Google Sheets à Claude.

Une fois branché (voir README), Claude peut lire ET écrire directement dans vos
feuilles de calcul existantes — y compris la mise à jour ciblée de cellules,
ce que le connecteur Google Drive natif ne permet pas.

Lancement (stdio) :

    python -m gsheets_connector.mcp_server

Dépendance : le paquet `mcp` (voir requirements.txt).
"""

from __future__ import annotations

import json
from typing import Any

from .client import SheetsClient

try:
    from mcp.server.fastmcp import FastMCP
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "Le paquet 'mcp' est requis pour le serveur MCP. "
        "Installez-le : pip install \"mcp[cli]\""
    ) from exc


mcp = FastMCP("google-sheets-connector")

# Instancié paresseusement pour que --help ou l'import ne déclenchent pas l'auth.
_client: SheetsClient | None = None


def client() -> SheetsClient:
    global _client
    if _client is None:
        _client = SheetsClient()
    return _client


@mcp.tool()
def list_tabs(spreadsheet_id: str) -> str:
    """Liste les onglets (feuilles) d'un classeur Google Sheets."""
    return json.dumps(client().list_tabs(spreadsheet_id), ensure_ascii=False)


@mcp.tool()
def read_range(spreadsheet_id: str, a1_range: str) -> str:
    """Lit une plage A1 (ex. 'Prospects!A1:E50') et retourne une grille JSON."""
    return json.dumps(
        client().read(spreadsheet_id, a1_range), ensure_ascii=False
    )


@mcp.tool()
def read_records(spreadsheet_id: str, sheet: str) -> str:
    """Lit une feuille entière sous forme de liste d'objets {colonne: valeur}.

    La première ligne fournit les noms de colonnes.
    """
    return json.dumps(
        client().read_records(spreadsheet_id, sheet), ensure_ascii=False
    )


@mcp.tool()
def append_row(spreadsheet_id: str, sheet: str, values: list[Any]) -> str:
    """Ajoute une nouvelle ligne (liste de valeurs) à la fin d'une feuille."""
    res = client().append_row(spreadsheet_id, sheet, values)
    return json.dumps(res, ensure_ascii=False)


@mcp.tool()
def write_range(spreadsheet_id: str, a1_range: str, values: list[list[Any]]) -> str:
    """Écrit une grille de valeurs dans une plage A1 (écrase les cellules visées)."""
    res = client().write(spreadsheet_id, a1_range, values)
    return json.dumps(res, ensure_ascii=False)


@mcp.tool()
def upsert_row(
    spreadsheet_id: str,
    sheet: str,
    key_column: str,
    key_value: str,
    updates: dict[str, Any],
) -> str:
    """Met à jour la ligne où `key_column == key_value`, ou la crée si absente.

    Seules les colonnes présentes dans `updates` sont modifiées. Idéal pour
    tenir un CRM à jour (ex. key_column='Email', updates={'Statut': 'Relancé'}).
    """
    res = client().upsert(
        spreadsheet_id,
        sheet,
        key_column=key_column,
        key_value=key_value,
        updates=updates,
    )
    return json.dumps(res, ensure_ascii=False)


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
