/**
 * Serveur MCP hébergé — expose le connecteur Google Sheets/Docs à Claude
 * comme connecteur distant (Streamable HTTP).
 *
 * Endpoint public : https://<votre-domaine>/api/mcp
 * C'est cette URL que chaque membre ajoute dans Claude (Réglages → Connecteurs).
 */

import { createMcpHandler } from "@vercel/mcp-adapter";
import { z } from "zod";
import {
  listTabs,
  readRange,
  appendRow,
  upsertRow,
  readDoc,
  fillTemplate,
} from "../../../lib/google";

function jsonText(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "list_tabs",
      "Liste les onglets (feuilles) d'un classeur Google Sheets.",
      { spreadsheetId: z.string() },
      async ({ spreadsheetId }) => jsonText(await listTabs(spreadsheetId))
    );

    server.tool(
      "read_range",
      "Lit une plage A1 (ex. 'Prospects!A1:E50') et retourne une grille.",
      { spreadsheetId: z.string(), a1Range: z.string() },
      async ({ spreadsheetId, a1Range }) =>
        jsonText(await readRange(spreadsheetId, a1Range))
    );

    server.tool(
      "append_row",
      "Ajoute une ligne à la fin d'une feuille.",
      {
        spreadsheetId: z.string(),
        sheet: z.string(),
        values: z.array(z.any()),
      },
      async ({ spreadsheetId, sheet, values }) =>
        jsonText(await appendRow(spreadsheetId, sheet, values))
    );

    server.tool(
      "upsert_row",
      "Met à jour la ligne où keyColumn == keyValue, ou la crée si absente. " +
        "Seules les colonnes de `updates` sont modifiées. Idéal pour un CRM.",
      {
        spreadsheetId: z.string(),
        sheet: z.string(),
        keyColumn: z.string(),
        keyValue: z.string(),
        updates: z.record(z.any()),
      },
      async ({ spreadsheetId, sheet, keyColumn, keyValue, updates }) =>
        jsonText(
          await upsertRow(spreadsheetId, sheet, keyColumn, keyValue, updates)
        )
    );

    server.tool(
      "docs_read",
      "Lit le texte brut d'un Google Doc.",
      { documentId: z.string() },
      async ({ documentId }) => ({
        content: [{ type: "text" as const, text: await readDoc(documentId) }],
      })
    );

    server.tool(
      "docs_fill_template",
      "Remplit un modèle : remplace chaque marqueur par sa valeur dans tout le " +
        "doc. Ex. { '{{client}}': 'ACME', '{{montant}}': '25 000 €' }.",
      { documentId: z.string(), replacements: z.record(z.any()) },
      async ({ documentId, replacements }) =>
        jsonText(await fillTemplate(documentId, replacements))
    );
  },
  {},
  { basePath: "/api" }
);

export { handler as GET, handler as POST, handler as DELETE };
