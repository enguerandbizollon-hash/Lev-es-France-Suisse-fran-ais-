# Connecteur Google Workspace (Sheets + Docs) pour Claude

Un connecteur qui permet à **Claude — ou à n'importe quel script planifié — de lire
ET d'écrire directement dans vos Google Sheets et Google Docs existants** : mise à
jour ciblée de cellules (`écris "Relancé" dans la colonne Statut de la ligne dont
l'email est contact@acme.com`) et remplissage de documents modèles
(`remplace {{client}} par ACME dans la proposition`).

C'est la brique qui manque au connecteur Google Drive natif : celui-ci lit et crée
des fichiers, mais ne modifie pas une cellule précise dans une feuille existante,
ni ne remplit un modèle Docs. Ce connecteur comble ce vide, sans changer d'outil
et sans passer par Make.

## Ce qu'il sait faire

| Opération | Description |
|---|---|
| `list_tabs` | Lister les onglets d'un classeur |
| `read_range` / `read_records` | Lire une plage, ou une feuille entière en objets `{colonne: valeur}` |
| `append_row` | Ajouter une ligne en fin de feuille |
| `write_range` | Écrire/écraser une plage de cellules |
| `upsert_row` | **Mettre à jour une ligne repérée par une colonne clé (ex. Email), ou la créer si absente** — idéal pour tenir un CRM à jour |
| `docs_read` | Lire le texte brut d'un Google Doc |
| `docs_fill_template` | **Remplir un modèle** : remplacer `{{client}}`, `{{montant}}`… par les vraies valeurs (propositions, comptes-rendus) |
| `docs_append` | Ajouter du texte à la fin d'un Google Doc |

Trois façons de l'utiliser :
1. **Serveur MCP** — Claude appelle le connecteur comme un outil (lecture/écriture en direct).
2. **CLI** — commandes ponctuelles ou dans un cron pour l'automatisation récurrente.
3. **Bibliothèque Python** — `from gsheets_connector import SheetsClient`.

---

## Installation

```bash
pip install -r requirements.txt
```

---

## Configuration de l'accès Google (à faire une seule fois)

Deux méthodes d'authentification. Choisissez selon votre contexte :

- **Compte de service** (§ ci-dessous) — idéal pour l'automatisation, mais
  **de nombreuses organisations Google Workspace bloquent le téléchargement des
  clés** (règle `iam.disableServiceAccountKeyCreation`). Si vous rencontrez le
  message « La création de clés de compte de service est désactivée », passez à
  la méthode OAuth.
- **OAuth utilisateur** (§ « Alternative : OAuth » plus bas) — non bloqué par
  cette règle, et **aucun partage de feuille n'est requis** : le connecteur agit
  en votre nom et accède directement à tous vos fichiers.

Activez au préalable **deux** API dans la Bibliothèque : **Google Sheets API**
et **Google Docs API**.

### 1. Créer un projet et activer les API
1. Ouvrez [Google Cloud Console](https://console.cloud.google.com/).
2. Créez un projet (ou réutilisez-en un).
3. Menu **APIs & Services → Library**, cherchez **Google Sheets API**, cliquez **Enable**.

### 2. Créer le compte de service
1. **APIs & Services → Credentials → Create credentials → Service account**.
2. Donnez-lui un nom (ex. `claude-sheets`), validez.
3. Dans l'onglet **Keys** du compte de service → **Add key → Create new key → JSON**.
4. Un fichier JSON se télécharge. Placez-le dans ce dossier sous le nom
   `service_account.json` (il est déjà ignoré par git — **ne le committez jamais**).

### 3. Partager vos feuilles avec le compte de service
Le compte de service a une adresse e-mail du type
`claude-sheets@mon-projet.iam.gserviceaccount.com` (visible dans le fichier JSON,
champ `client_email`).

Pour **chaque** Google Sheet que Claude doit modifier :
1. Ouvrez la feuille → bouton **Partager**.
2. Collez l'e-mail du compte de service.
3. Donnez le rôle **Éditeur**.

> Sans ce partage, l'accès sera refusé : le compte de service ne voit que les
> fichiers qu'on lui partage explicitement.

### 4. Renseigner l'environnement
```bash
cp .env.example .env
# puis, dans .env :
# GOOGLE_SERVICE_ACCOUNT_FILE=./service_account.json
```
La CLI et la bibliothèque lisent `GOOGLE_SERVICE_ACCOUNT_FILE` (ou
`GOOGLE_SERVICE_ACCOUNT_JSON` pour coller le JSON directement, utile en CI).

> **Trouver le `spreadsheet_id`** : c'est la portion de l'URL entre `/d/` et `/edit`.
> Ex. `https://docs.google.com/spreadsheets/d/`**`14sHvy2R5AOl...j2PA`**`/edit`.

---

## Alternative : OAuth (si les clés de compte de service sont bloquées)

À utiliser quand votre organisation interdit les clés de compte de service, ou
si vous préférez que le connecteur agisse **en votre nom** (accès direct à tous
vos fichiers, sans partage préalable).

1. **Écran de consentement** (Google Auth Platform → *Audience*) : Type
   d'utilisateur **Interne** de préférence (réservé à votre organisation, pas de
   validation Google, jetons sans expiration à 7 jours).
2. **Autorisations** (Google Auth Platform → *Accès aux données*) : ajoutez les
   scopes `.../auth/spreadsheets` et `.../auth/documents`.
3. **Client OAuth** (Google Auth Platform → *Clients* → *Créer un client*) : type
   **Application de bureau**. Téléchargez le JSON (ce téléchargement **n'est pas**
   bloqué par la règle des comptes de service).
4. Placez-le sous `client_secret.json` et renseignez `.env` :
   ```bash
   GOOGLE_OAUTH_CLIENT_FILE=./client_secret.json
   ```
5. **Autorisez une fois** : lancez n'importe quelle commande (ex.
   `python -m gsheets_connector.cli tabs <id>`). Un navigateur s'ouvre → vous vous
   connectez → un fichier `token.json` est créé. Ensuite tout est automatique.

> Avec OAuth, **l'étape « partager avec le compte de service » est inutile** : le
> connecteur accède aux fichiers auxquels vous avez déjà accès.

---

## Utilisation en CLI

```bash
# Lister les onglets
python -m gsheets_connector.cli tabs <spreadsheet_id>

# Lire une plage
python -m gsheets_connector.cli read <spreadsheet_id> "Prospects!A1:E20"

# Lire toute une feuille en objets
python -m gsheets_connector.cli records <spreadsheet_id> Prospects

# Ajouter une ligne
python -m gsheets_connector.cli append <spreadsheet_id> Prospects \
    --values "ACME" "contact@acme.com" "Nouveau"

# Mettre à jour (ou créer) une ligne par colonne clé
python -m gsheets_connector.cli upsert <spreadsheet_id> Prospects \
    --key-column Email --key-value "contact@acme.com" \
    --set "Statut=Relancé" "Dernier contact=2026-07-08"

# --- Google Docs ---
# Lire le texte d'un document
python -m gsheets_connector.cli docs-read <document_id>

# Remplir un modèle (remplacer des marqueurs)
python -m gsheets_connector.cli docs-fill <document_id> \
    --set "{{client}}=ACME" "{{montant}}=25 000 €"

# Ajouter du texte à la fin
python -m gsheets_connector.cli docs-append <document_id> --text "Nouveau paragraphe."
```

### Automatisation récurrente (cron)
Exemple : mise à jour quotidienne à 8h.
```cron
0 8 * * *  cd /chemin/vers/le/projet && /usr/bin/python3 -m gsheets_connector.cli upsert ...
```

---

## Utilisation comme serveur MCP (Claude appelle le connecteur)

Lancez le serveur en stdio :
```bash
python -m gsheets_connector.mcp_server
```

### Le brancher dans Claude Desktop
Ajoutez ceci à votre `claude_desktop_config.json`
(**Settings → Developer → Edit Config**) :
```json
{
  "mcpServers": {
    "google-sheets": {
      "command": "python",
      "args": ["-m", "gsheets_connector.mcp_server"],
      "cwd": "/chemin/absolu/vers/le/projet",
      "env": {
        "GOOGLE_SERVICE_ACCOUNT_FILE": "/chemin/absolu/vers/service_account.json"
      }
    }
  }
}
```

### Le brancher dans Claude Code
```bash
claude mcp add google-sheets -- python -m gsheets_connector.mcp_server
```
(depuis le dossier du projet, avec `GOOGLE_SERVICE_ACCOUNT_FILE` dans l'environnement).

Une fois branché, vous pourrez demander à Claude, en langage naturel :
> « Dans le CRM Vectis, passe le statut de contact@acme.com à "Relancé" et note la
> date du jour. »

Claude appellera l'outil `upsert_row` du connecteur pour l'écrire réellement dans
la feuille.

---

## Utilisation comme bibliothèque

```python
from gsheets_connector import SheetsClient

client = SheetsClient()  # auth via GOOGLE_SERVICE_ACCOUNT_FILE
client.upsert(
    "<spreadsheet_id>",
    sheet="Prospects",
    key_column="Email",
    key_value="contact@acme.com",
    updates={"Statut": "Relancé", "Dernier contact": "2026-07-08"},
)
```

---

## Tests

```bash
python tests/test_client.py
```
Les tests utilisent une fausse API Sheets en mémoire — **aucune credential Google
n'est nécessaire** pour les exécuter.

---

## Sécurité

- `service_account.json`, `.env`, `token.json` sont **ignorés par git** — ne les
  committez jamais.
- Le compte de service n'a accès **qu'aux** feuilles que vous lui partagez.
- Le périmètre demandé est limité à Google Sheets (`spreadsheets`).
