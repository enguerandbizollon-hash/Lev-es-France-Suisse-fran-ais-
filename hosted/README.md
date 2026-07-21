# Connecteur Scale Up — version hébergée (Vercel)

Serveur MCP distant qui permet à **Claude d'écrire dans les Google Sheets & Docs
du Drive partagé Scale Up**. Chaque membre l'ajoute comme connecteur dans Claude,
sans rien installer.

## Architecture

- **Une seule identité « robot » Scale Up** (jeton OAuth en variable
  d'environnement) qui n'accède **qu'aux fichiers partagés avec lui**.
- **Google uniquement** — ne peut pas atteindre un environnement Microsoft.
- Déployé sur **Vercel**, endpoint public `/api/mcp`.

## Déploiement (résumé)

1. **Google Cloud** : réutiliser le client OAuth « Application de bureau »
   existant. Activer les API **Sheets** et **Docs**.
2. **Obtenir le refresh token du robot** :
   ```bash
   cd hosted
   npm install
   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npm run get-token
   ```
   Suivre les instructions (autoriser dans le navigateur, coller le `code`).
3. **Vercel** : importer ce dépôt, définir le **Root Directory = `hosted`**,
   puis renseigner les variables d'environnement :
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REFRESH_TOKEN`
4. **Déployer**. L'URL du connecteur est `https://<votre-projet>.vercel.app/api/mcp`.
5. **Claude** : chaque membre → `Réglages → Connecteurs → Ajouter un connecteur`
   → coller l'URL `/api/mcp`.

## Cloisonnement

Le compte autorisé à l'étape 2 doit être un compte Scale Up qui **ne voit que
le Drive partagé Scale Up** — idéalement un compte « robot » dédié. Ainsi le
connecteur ne peut structurellement accéder à aucune donnée hors périmètre.

## Outils exposés

`list_tabs` · `read_range` · `append_row` · `upsert_row` · `docs_read` ·
`docs_fill_template`

## Sécurité (à durcir)

Cette version MVP expose l'endpoint sans authentification côté Claude. L'URL doit
être traitée comme un secret. Étape suivante recommandée : ajouter une
authentification (OAuth ou jeton porteur) avant un usage élargi.
