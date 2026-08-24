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
import {
  todoAdd,
  todoUpdate,
  todoRead,
  sasAdd,
  sasFlush,
  sasPending,
  dossierAdd,
} from "../../../lib/pilotage";

function jsonText(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

/** Les outils pilotage retournent {ok:false, erreur} au lieu de lever. */
async function guarded<T>(fn: () => Promise<T>) {
  try {
    return jsonText({ ok: true, resultat: await fn() });
  } catch (e) {
    return jsonText({ ok: false, erreur: e instanceof Error ? e.message : String(e) });
  }
}

const todoFieldsShape = {
  entite: z.string().describe("VF ou SUS (référentiel LISTES, vérifié en direct)"),
  dossier: z.string().describe("Code dossier (VF, HJ, RP, TCF, TU, SUS, ADMIN, ROUSSON...)"),
  type: z.string().describe("Production, Relance, RDV, Événement, Call, Admin, Décision, Veille, Mail"),
  tache: z.string().describe("Intitulé de la tâche (colonne pivot)"),
  contact: z.string().optional(),
  echeance: z.string().optional().describe("JJ/MM/AAAA ou AAAA-MM-JJ"),
  priorite: z.string().optional().describe("1-Haute, 2-Moyenne (défaut), 3-Basse"),
  statut: z.string().optional().describe("À faire (défaut), En cours, En attente, Fait, Annulé"),
  notes: z.string().optional().describe("Notes / lien. Citer la source, et « Échéance proposée » si la date ne vient pas de la source."),
};

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

    // ---- Pilotage Vectis (fichier Pilotage_Vectis, opérations métier) ----

    server.tool(
      "todo_add",
      "Ajoute une ligne au TODO du fichier Pilotage_Vectis. Gère les formules " +
        "des colonnes calculées (ID, J-) et refuse un doublon (même intitulé " +
        "et même échéance). Réservé aux entrées sûres (RDV agenda, validation " +
        "humaine) : une action déduite d'un mail passe par sas_add.",
      todoFieldsShape,
      async (fields) => guarded(() => todoAdd(fields))
    );

    server.tool(
      "todo_update",
      "Met à jour une ligne du TODO identifiée par son ID (Txxx) ou par son " +
        "intitulé (exact, sinon partiel). Seuls les champs fournis changent ; " +
        "les colonnes calculées ne sont jamais touchées.",
      {
        cle: z.string().describe("ID Txxx ou intitulé (exact ou partiel) de la tâche"),
        updates: z.object(todoFieldsShape).partial(),
      },
      async ({ cle, updates }) => guarded(() => todoUpdate(cle, updates))
    );

    server.tool(
      "todo_read",
      "Lecture filtrée du TODO : par dossier, par statut, en retard (J- " +
        "négatif), ou échéance sous n jours. Exclut Fait et Annulé par défaut. " +
        "Retourne les lignes triées par urgence avec J- calculé.",
      {
        dossier: z.string().optional(),
        statut: z.string().optional(),
        en_retard: z.boolean().optional(),
        echeance_sous_jours: z.number().int().optional(),
        inclure_termines: z.boolean().optional(),
      },
      async (filters) => guarded(() => todoRead(filters))
    );

    server.tool(
      "sas_add",
      "Dépose une proposition d'action dans le SAS de validation du fichier " +
        "Pilotage_Vectis (rien n'entre au TODO sans validation humaine). La " +
        "source est obligatoire. Refuse un doublon contre le SAS et le TODO. " +
        "Si la proposition recoupe une ligne ouverte du TODO du même dossier " +
        "(même contact ou intitulé proche), la ligne est quand même déposée " +
        "et le résultat porte un avertissement `recouvrements` : le relayer " +
        "dans le brief, la décision reste au SAS.",
      {
        ...todoFieldsShape,
        source: z
          .string()
          .describe("Origine de la proposition, ex. « Mail de Julie du 24/08/2026 »"),
      },
      async ({ source, ...fields }) => guarded(() => sasAdd(fields, source))
    );

    server.tool(
      "sas_flush",
      "Bascule les lignes du SAS validées « O » vers le TODO (avec formules), " +
        "les marque « Basculé », passe les « N » à « Rejeté », laisse " +
        "« Modifier » et les vides intacts. Retourne le décompte.",
      {},
      async () => guarded(() => sasFlush())
    );

    server.tool(
      "sas_pending",
      "Compte et liste les lignes du SAS en attente de décision (colonne " +
        "Valider vide ou « Modifier »). Pour la section « À valider » des briefs.",
      {},
      async () => guarded(() => sasPending())
    );

    server.tool(
      "dossier_add",
      "Crée un dossier dans l'onglet DOSSIERS (compteurs Ouvertes/En retard en " +
        "formule) ET ajoute son code dans LISTES pour les listes déroulantes, " +
        "en une opération. Refuse un code déjà pris.",
      {
        code: z.string().describe("Code court unique, ex. ACME (2-12 car., A-Z/0-9/-)"),
        dossier: z.string().describe("Nom complet du dossier"),
        entite: z.string().describe("VF ou SUS"),
        type_mission: z
          .string()
          .describe("Ex. M&A Sell-side, M&A Buy-side, CFO / Advisory, Fundraising, Interne"),
        contact_principal: z.string().optional(),
        statut: z.string().optional().describe("Défaut : Actif"),
        prochaine_etape: z.string().optional(),
        echeance_cle: z.string().optional().describe("JJ/MM/AAAA"),
        honoraires: z.string().optional(),
        notes: z.string().optional(),
      },
      async (fields) => guarded(() => dossierAdd(fields))
    );
  },
  {},
  { basePath: "/api" }
);

export { handler as GET, handler as POST, handler as DELETE };
