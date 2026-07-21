/**
 * Accès Google (Sheets + Docs) pour le connecteur hébergé.
 *
 * Authentification : une seule identité « robot » ScaleUp, via un jeton de
 * rafraîchissement OAuth stocké en variable d'environnement. Le robot n'accède
 * qu'aux fichiers partagés avec lui (Drive partagé ScaleUp) — jamais Vectis.
 *
 * Variables d'environnement attendues :
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REFRESH_TOKEN
 */

import { google, sheets_v4, docs_v1 } from "googleapis";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variable d'environnement manquante : ${name}. ` +
        `Configurez-la dans les réglages Vercel du projet.`
    );
  }
  return value;
}

function authClient() {
  const oauth2 = new google.auth.OAuth2(
    requireEnv("GOOGLE_CLIENT_ID"),
    requireEnv("GOOGLE_CLIENT_SECRET")
  );
  oauth2.setCredentials({ refresh_token: requireEnv("GOOGLE_REFRESH_TOKEN") });
  return oauth2;
}

export function sheetsClient(): sheets_v4.Sheets {
  return google.sheets({ version: "v4", auth: authClient() });
}

export function docsClient(): docs_v1.Docs {
  return google.docs({ version: "v1", auth: authClient() });
}

/** Convertit un index de colonne (0 -> A, 26 -> AA) en lettre(s). */
export function columnLetter(indexZeroBased: number): string {
  let letters = "";
  let n = indexZeroBased;
  while (true) {
    const rem = n % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor(n / 26);
    if (n === 0) break;
    n -= 1;
  }
  return letters;
}

// ---- Sheets --------------------------------------------------------------

export async function listTabs(spreadsheetId: string): Promise<string[]> {
  const api = sheetsClient();
  const res = await api.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  });
  return (res.data.sheets ?? []).map((s) => s.properties?.title ?? "");
}

export async function readRange(
  spreadsheetId: string,
  a1Range: string
): Promise<any[][]> {
  const api = sheetsClient();
  const res = await api.spreadsheets.values.get({
    spreadsheetId,
    range: a1Range,
  });
  return (res.data.values as any[][]) ?? [];
}

export async function appendRow(
  spreadsheetId: string,
  sheet: string,
  values: any[]
) {
  const api = sheetsClient();
  const res = await api.spreadsheets.values.append({
    spreadsheetId,
    range: sheet,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [values] },
  });
  return res.data;
}

/**
 * Met à jour la ligne où `keyColumn == keyValue`, ou la crée si absente.
 * Seules les colonnes présentes dans `updates` sont modifiées.
 */
export async function upsertRow(
  spreadsheetId: string,
  sheet: string,
  keyColumn: string,
  keyValue: string,
  updates: Record<string, any>
): Promise<{ action: "updated" | "inserted"; row: number | null }> {
  const grid = await readRange(spreadsheetId, sheet);
  if (grid.length === 0) {
    throw new Error(`La feuille « ${sheet} » est vide : en-têtes introuvables.`);
  }
  const headers = grid[0].map((h) => String(h));
  if (!headers.includes(keyColumn)) {
    throw new Error(
      `Colonne clé « ${keyColumn} » introuvable. Colonnes : ${headers.join(", ")}`
    );
  }
  const unknown = Object.keys(updates).filter((c) => !headers.includes(c));
  if (unknown.length) {
    throw new Error(
      `Colonnes inconnues dans updates : ${unknown.join(", ")}. ` +
        `Colonnes : ${headers.join(", ")}`
    );
  }

  const keyIdx = headers.indexOf(keyColumn);
  let rowNumber: number | null = null;
  for (let i = 1; i < grid.length; i++) {
    const cell = grid[i][keyIdx];
    if (cell !== undefined && String(cell) === String(keyValue)) {
      rowNumber = i + 1; // 1-indexé
      break;
    }
  }

  const api = sheetsClient();

  if (rowNumber === null) {
    const newRow = headers.map((h) =>
      h === keyColumn ? keyValue : updates[h] ?? ""
    );
    await appendRow(spreadsheetId, sheet, newRow);
    return { action: "inserted", row: null };
  }

  const data = Object.entries(updates).map(([header, value]) => ({
    range: `${sheet}!${columnLetter(headers.indexOf(header))}${rowNumber}`,
    values: [[value]],
  }));
  if (data.length) {
    await api.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: "USER_ENTERED", data },
    });
  }
  return { action: "updated", row: rowNumber };
}

// ---- Docs ----------------------------------------------------------------

export async function readDoc(documentId: string): Promise<string> {
  const api = docsClient();
  const res = await api.documents.get({ documentId });
  const parts: string[] = [];
  for (const el of res.data.body?.content ?? []) {
    for (const e of el.paragraph?.elements ?? []) {
      const t = e.textRun?.content;
      if (t) parts.push(t);
    }
  }
  return parts.join("");
}

export async function fillTemplate(
  documentId: string,
  replacements: Record<string, any>
) {
  const requests = Object.entries(replacements).map(([marker, value]) => ({
    replaceAllText: {
      containsText: { text: marker, matchCase: true },
      replaceText: String(value),
    },
  }));
  if (!requests.length) return { replies: [] };
  const api = docsClient();
  const res = await api.documents.batchUpdate({
    documentId,
    requestBody: { requests },
  });
  return res.data;
}
