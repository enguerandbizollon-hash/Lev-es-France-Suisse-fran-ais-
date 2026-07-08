"""Interface en ligne de commande pour le connecteur Google Sheets.

Exemples :

    # Lister les onglets
    python -m gsheets_connector.cli tabs <spreadsheet_id>

    # Lire une plage
    python -m gsheets_connector.cli read <spreadsheet_id> "Prospects!A1:E20"

    # Ajouter une ligne
    python -m gsheets_connector.cli append <spreadsheet_id> Prospects \\
        --values "ACME" "contact@acme.com" "Nouveau"

    # Mettre à jour (ou créer) une ligne par colonne clé
    python -m gsheets_connector.cli upsert <spreadsheet_id> Prospects \\
        --key-column Email --key-value "contact@acme.com" \\
        --set Statut=Relancé "Dernier contact=2026-07-08"
"""

from __future__ import annotations

import argparse
import json
import sys

from .client import SheetsClient


def _parse_set(pairs: list[str]) -> dict[str, str]:
    updates = {}
    for pair in pairs:
        if "=" not in pair:
            raise SystemExit(f"--set attend 'Colonne=Valeur', reçu : {pair!r}")
        key, value = pair.split("=", 1)
        updates[key.strip()] = value
    return updates


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="gsheets_connector")
    sub = parser.add_subparsers(dest="command", required=True)

    p_tabs = sub.add_parser("tabs", help="Lister les onglets d'un classeur")
    p_tabs.add_argument("spreadsheet_id")

    p_read = sub.add_parser("read", help="Lire une plage A1")
    p_read.add_argument("spreadsheet_id")
    p_read.add_argument("range", help="Ex. 'Feuille1!A1:D20'")

    p_records = sub.add_parser("records", help="Lire une feuille en dictionnaires")
    p_records.add_argument("spreadsheet_id")
    p_records.add_argument("sheet")

    p_append = sub.add_parser("append", help="Ajouter une ligne")
    p_append.add_argument("spreadsheet_id")
    p_append.add_argument("sheet")
    p_append.add_argument("--values", nargs="+", required=True)

    p_write = sub.add_parser("write", help="Écrire une valeur dans une cellule/plage")
    p_write.add_argument("spreadsheet_id")
    p_write.add_argument("range")
    p_write.add_argument("--values", nargs="+", required=True,
                         help="Valeurs d'une seule ligne")

    p_upsert = sub.add_parser("upsert", help="Mettre à jour/créer une ligne par clé")
    p_upsert.add_argument("spreadsheet_id")
    p_upsert.add_argument("sheet")
    p_upsert.add_argument("--key-column", required=True)
    p_upsert.add_argument("--key-value", required=True)
    p_upsert.add_argument("--set", nargs="+", required=True, dest="set_pairs",
                          help="Paires Colonne=Valeur")

    args = parser.parse_args(argv)
    client = SheetsClient()

    if args.command == "tabs":
        print(json.dumps(client.list_tabs(args.spreadsheet_id), ensure_ascii=False))
    elif args.command == "read":
        rows = client.read(args.spreadsheet_id, args.range)
        print(json.dumps(rows, ensure_ascii=False, indent=2))
    elif args.command == "records":
        recs = client.read_records(args.spreadsheet_id, args.sheet)
        print(json.dumps(recs, ensure_ascii=False, indent=2))
    elif args.command == "append":
        res = client.append_row(args.spreadsheet_id, args.sheet, args.values)
        print(json.dumps(res, ensure_ascii=False))
    elif args.command == "write":
        res = client.write(args.spreadsheet_id, args.range, [args.values])
        print(json.dumps(res, ensure_ascii=False))
    elif args.command == "upsert":
        updates = _parse_set(args.set_pairs)
        res = client.upsert(
            args.spreadsheet_id,
            args.sheet,
            key_column=args.key_column,
            key_value=args.key_value,
            updates=updates,
        )
        print(json.dumps(res, ensure_ascii=False))
    else:  # pragma: no cover
        parser.error(f"Commande inconnue : {args.command}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
