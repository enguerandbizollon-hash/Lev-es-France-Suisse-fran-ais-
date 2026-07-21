"""Authentification Google.

Deux modes sont supportés, dans cet ordre de priorité :

1. Compte de service (RECOMMANDÉ pour l'automatisation, sans intervention humaine).
   Fournir le chemin du fichier JSON via la variable d'environnement
   GOOGLE_SERVICE_ACCOUNT_FILE, ou le contenu JSON directement via
   GOOGLE_SERVICE_ACCOUNT_JSON.

2. OAuth utilisateur (pour un usage interactif sur poste). Fournir le fichier
   client OAuth via GOOGLE_OAUTH_CLIENT_FILE ; le jeton est mis en cache dans
   le fichier indiqué par GOOGLE_OAUTH_TOKEN_FILE (défaut : token.json).

Dans les deux cas, le périmètre (scope) demandé est l'écriture sur Sheets.
"""

from __future__ import annotations

import json
import os

from google.oauth2 import service_account
from googleapiclient.discovery import build

# Écriture complète sur les feuilles de calcul ET les documents Google Docs.
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/documents",
]


def _service_account_credentials():
    """Construit les credentials à partir d'un compte de service, si configuré."""
    raw_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if raw_json:
        info = json.loads(raw_json)
        return service_account.Credentials.from_service_account_info(
            info, scopes=SCOPES
        )

    path = os.environ.get("GOOGLE_SERVICE_ACCOUNT_FILE")
    if path:
        if not os.path.exists(path):
            raise FileNotFoundError(
                f"GOOGLE_SERVICE_ACCOUNT_FILE pointe vers un fichier introuvable : {path}"
            )
        return service_account.Credentials.from_service_account_file(
            path, scopes=SCOPES
        )

    return None


def _oauth_credentials():
    """Construit/rafraîchit des credentials OAuth utilisateur, si configuré.

    Importé paresseusement pour ne pas exiger google-auth-oauthlib quand on
    utilise uniquement un compte de service.
    """
    client_file = os.environ.get("GOOGLE_OAUTH_CLIENT_FILE")
    if not client_file:
        return None

    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow

    token_file = os.environ.get("GOOGLE_OAUTH_TOKEN_FILE", "token.json")
    creds = None
    if os.path.exists(token_file):
        creds = Credentials.from_authorized_user_file(token_file, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(client_file, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(token_file, "w", encoding="utf-8") as fh:
            fh.write(creds.to_json())

    return creds


def get_credentials():
    """Retourne des credentials valides, en essayant le compte de service puis OAuth."""
    creds = _service_account_credentials()
    if creds is not None:
        return creds

    creds = _oauth_credentials()
    if creds is not None:
        return creds

    raise RuntimeError(
        "Aucune authentification Google configurée. Définissez "
        "GOOGLE_SERVICE_ACCOUNT_FILE (recommandé) ou GOOGLE_OAUTH_CLIENT_FILE. "
        "Voir le README pour la procédure pas à pas."
    )


def build_sheets_service():
    """Construit un client bas niveau de l'API Google Sheets."""
    creds = get_credentials()
    # cache_discovery=False évite un warning bruyant quand oauth2client est absent.
    return build("sheets", "v4", credentials=creds, cache_discovery=False)


def build_docs_service():
    """Construit un client bas niveau de l'API Google Docs."""
    creds = get_credentials()
    return build("docs", "v1", credentials=creds, cache_discovery=False)
