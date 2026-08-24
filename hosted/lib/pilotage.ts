/**
 * Opérations métier sur le fichier de pilotage Vectis (Google Sheet).
 *
 * Onglets : TODO (A:K), SAS (A:M), DOSSIERS (A:L), LISTES (référentiels).
 * Le classeur est en locale fr_FR : toute formule écrite ici DOIT utiliser
 * le point-virgule et les noms de fonctions français (SI, OU, TEXTE, LIGNE,
 * AUJOURDHUI, NB.SI.ENS). La syntaxe US produit #ERROR!.
 *
 * Les colonnes calculées (TODO!A « ID », TODO!J « J- », DOSSIERS!J « Ouvertes »,
 * DOSSIERS!K « En retard ») sont réinjectées par ces fonctions à chaque ligne
 * créée : un simple append les écraserait.
 */

import { sheetsClient, columnLetter } from "./google";

export const PILOTAGE_SHEET_ID =
  process.env.PILOTAGE_SHEET_ID ?? "1l_DIwVL0XP0FCJL7dLqf3arAyfKrAm5ZTDTAtwhuLJw";

const TODO = "TODO";
const SAS = "SAS";
const DOSSIERS = "DOSSIERS";
const LISTES = "LISTES";

// Plage LISTES!B réservée aux codes dossier (validations du classeur : $B$2:$B$20).
const LISTES_DOSSIER_FIRST_ROW = 2;
const LISTES_DOSSIER_LAST_ROW = 20;

// ---- Types ---------------------------------------------------------------

export interface TodoFields {
  entite: string;
  dossier: string;
  type: string;
  tache: string;
  contact?: string;
  echeance?: string;
  priorite?: string;
  statut?: string;
  notes?: string;
}

export interface TodoUpdates {
  entite?: string;
  dossier?: string;
  type?: string;
  tache?: string;
  contact?: string;
  echeance?: string;
  priorite?: string;
  statut?: string;
  notes?: string;
}

export interface DossierFields {
  code: string;
  dossier: string;
  entite: string;
  type_mission: string;
  contact_principal?: string;
  statut?: string;
  prochaine_etape?: string;
  echeance_cle?: string;
  honoraires?: string;
  notes?: string;
}

export interface TodoReadFilters {
  dossier?: string;
  statut?: string;
  en_retard?: boolean;
  echeance_sous_jours?: number;
  inclure_termines?: boolean;
}

// ---- Dates (Europe/Paris) ------------------------------------------------

/** Accepte JJ/MM/AAAA ou AAAA-MM-JJ, retourne la forme canonique JJ/MM/AAAA. */
export function canonicalDate(input: string): string {
  const s = input.trim();
  if (s === "") return "";
  let d: number, m: number, y: number;
  let match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      throw new Error(
        `Échéance « ${input} » invalide : format attendu JJ/MM/AAAA ou AAAA-MM-JJ.`
      );
    }
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  ) {
    throw new Error(`Échéance « ${input} » invalide : cette date n'existe pas.`);
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d)}/${pad(m)}/${y}`;
}

/** Date du jour en Europe/Paris, à minuit UTC (pour des différences en jours). */
function todayParis(): Date {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
}

/** J- : jours restants entre aujourd'hui (Paris) et une échéance JJ/MM/AAAA. */
function daysUntil(canonical: string): number | null {
  if (!canonical) return null;
  const [d, m, y] = canonical.split("/").map(Number);
  const due = new Date(Date.UTC(y, m - 1, d));
  return Math.round((due.getTime() - todayParis().getTime()) / 86_400_000);
}

/**
 * Normalise une échéance lue dans le classeur. Une cellule date sans format
 * d'affichage revient comme numéro de série Sheets (époque 30/12/1899) :
 * on la reconvertit en JJ/MM/AAAA au lieu de la traiter comme du bruit.
 */
function normalizeSheetDate(raw: string): string {
  const s = raw.trim();
  if (s === "") return "";
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return canonicalDate(s);
  if (/^\d{4,6}$/.test(s)) {
    const epoch = Date.UTC(1899, 11, 30);
    const date = new Date(epoch + Number(s) * 86_400_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
  }
  return s;
}

// ---- Aides internes ------------------------------------------------------

/** Clé de comparaison anti-doublon : intitulé normalisé (casse, accents, espaces). */
function normalizeTask(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function dupKey(tache: string, echeance: string): string {
  return `${normalizeTask(tache)}|${echeance}`;
}

async function readGrid(sheet: string, lastColumn: string): Promise<string[][]> {
  const api = sheetsClient();
  const res = await api.spreadsheets.values.get({
    spreadsheetId: PILOTAGE_SHEET_ID,
    range: `${sheet}!A1:${lastColumn}`,
    valueRenderOption: "FORMATTED_VALUE",
  });
  return ((res.data.values as string[][]) ?? []).map((row) =>
    row.map((c) => (c === undefined || c === null ? "" : String(c)))
  );
}

/** Ajoute une ligne et retourne le numéro de ligne où elle a atterri. */
async function appendAndLocate(sheet: string, values: unknown[]): Promise<number> {
  const api = sheetsClient();
  const res = await api.spreadsheets.values.append({
    spreadsheetId: PILOTAGE_SHEET_ID,
    range: sheet,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [values] },
  });
  const updatedRange = res.data.updates?.updatedRange ?? "";
  const match = updatedRange.match(/![A-Z]+(\d+)(?::[A-Z]+\d+)?$/);
  if (!match) {
    throw new Error(
      `Ligne ajoutée dans ${sheet} mais position introuvable (updatedRange = « ${updatedRange} »).`
    );
  }
  return Number(match[1]);
}

async function writeCells(
  data: { range: string; values: unknown[][] }[]
): Promise<void> {
  if (!data.length) return;
  const api = sheetsClient();
  await api.spreadsheets.values.batchUpdate({
    spreadsheetId: PILOTAGE_SHEET_ID,
    requestBody: { valueInputOption: "USER_ENTERED", data },
  });
}

/** Formules françaises des colonnes calculées du TODO, pour la ligne n. */
function todoFormulas(n: number): { a: string; j: string } {
  return {
    a: `=SI($E${n}="";"";"T"&TEXTE(LIGNE()-1;"000"))`,
    j: `=SI($E${n}="";"";SI(OU($I${n}="Fait";$I${n}="Annulé");"";SI($G${n}="";"";$G${n}-AUJOURDHUI())))`,
  };
}

// ---- Habillage des lignes ajoutées ---------------------------------------
// values.append en mode INSERT_ROWS insère une ligne neuve sous la dernière
// ligne remplie : elle n'hérite ni du format date ni des listes déroulantes
// posés plus bas dans la feuille. On les repose donc explicitement.

const sheetIdCache = new Map<string, number>();

async function getSheetId(title: string): Promise<number> {
  const cached = sheetIdCache.get(title);
  if (cached !== undefined) return cached;
  const api = sheetsClient();
  const res = await api.spreadsheets.get({
    spreadsheetId: PILOTAGE_SHEET_ID,
    fields: "sheets.properties(sheetId,title)",
  });
  for (const s of res.data.sheets ?? []) {
    if (s.properties?.title && s.properties.sheetId !== undefined) {
      sheetIdCache.set(s.properties.title, s.properties.sheetId ?? 0);
    }
  }
  const id = sheetIdCache.get(title);
  if (id === undefined) throw new Error(`Onglet « ${title} » introuvable.`);
  return id;
}

function oneOfRange(ref: string) {
  return {
    condition: { type: "ONE_OF_RANGE", values: [{ userEnteredValue: ref }] },
    showCustomUi: true,
  };
}

const TODO_VALIDATIONS: [number, object][] = [
  [1, oneOfRange("=LISTES!$A$2:$A$3")], // B Entité
  [2, oneOfRange("=LISTES!$B$2:$B$20")], // C Dossier
  [3, oneOfRange("=LISTES!$C$2:$C$20")], // D Type
  [7, oneOfRange("=LISTES!$D$2:$D$4")], // H Priorité
  [8, oneOfRange("=LISTES!$E$2:$E$6")], // I Statut
];

const SAS_VALIDATIONS: [number, object][] = [
  ...TODO_VALIDATIONS,
  [
    12, // M Valider
    {
      condition: {
        type: "ONE_OF_LIST",
        values: ["O", "N", "Modifier", "Basculé", "Rejeté"].map((v) => ({
          userEnteredValue: v,
        })),
      },
      showCustomUi: true,
    },
  ],
];

/** Repose sur la ligne n le format date et les listes déroulantes. */
async function dressRow(
  sheet: string,
  n: number,
  validations: [number, object][],
  dateCol = 6 // G par défaut (TODO et SAS) ; H pour DOSSIERS
): Promise<void> {
  const sheetId = await getSheetId(sheet);
  const cell = (col: number) => ({
    sheetId,
    startRowIndex: n - 1,
    endRowIndex: n,
    startColumnIndex: col,
    endColumnIndex: col + 1,
  });
  const requests: object[] = [
    {
      repeatCell: {
        range: cell(dateCol),
        cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "dd/mm/yyyy" } } },
        fields: "userEnteredFormat.numberFormat",
      },
    },
    ...validations.map(([col, rule]) => ({
      setDataValidation: { range: cell(col), rule },
    })),
  ];
  const api = sheetsClient();
  await api.spreadsheets.batchUpdate({
    spreadsheetId: PILOTAGE_SHEET_ID,
    requestBody: { requests: requests as never[] },
  });
}

// ---- Référentiels (onglet LISTES) ----------------------------------------

export interface Referentiels {
  entites: string[];
  dossiers: string[];
  types: string[];
  priorites: string[];
  statuts: string[];
}

export async function loadReferentiels(): Promise<Referentiels> {
  const grid = await readGrid(LISTES, "E");
  const column = (idx: number) =>
    grid
      .slice(1)
      .map((row) => (row[idx] ?? "").trim())
      .filter((v) => v !== "");
  return {
    entites: column(0),
    dossiers: column(1),
    types: column(2),
    priorites: column(3),
    statuts: column(4),
  };
}

function assertInList(value: string, allowed: string[], label: string): void {
  if (!allowed.includes(value)) {
    throw new Error(
      `${label} « ${value} » hors référentiel. Valeurs autorisées : ${allowed.join(", ")}.`
    );
  }
}

function validateTodoValues(
  fields: { entite?: string; dossier?: string; type?: string; priorite?: string; statut?: string },
  refs: Referentiels
): void {
  if (fields.entite !== undefined) assertInList(fields.entite, refs.entites, "Entité");
  if (fields.dossier !== undefined) assertInList(fields.dossier, refs.dossiers, "Dossier");
  if (fields.type !== undefined) assertInList(fields.type, refs.types, "Type");
  if (fields.priorite !== undefined) assertInList(fields.priorite, refs.priorites, "Priorité");
  if (fields.statut !== undefined) assertInList(fields.statut, refs.statuts, "Statut");
}

// ---- TODO ----------------------------------------------------------------

const TODO_COLUMNS: Record<keyof TodoUpdates, string> = {
  entite: "B",
  dossier: "C",
  type: "D",
  tache: "E",
  contact: "F",
  echeance: "G",
  priorite: "H",
  statut: "I",
  notes: "K",
};

export interface TodoRow {
  ligne: number;
  id: string;
  entite: string;
  dossier: string;
  type: string;
  tache: string;
  contact: string;
  echeance: string;
  priorite: string;
  statut: string;
  j_moins: number | null;
  notes: string;
}

function toTodoRow(row: string[], index: number): TodoRow {
  const echeance = normalizeSheetDate(row[6] ?? "");
  return {
    ligne: index + 1,
    id: (row[0] ?? "").trim(),
    entite: (row[1] ?? "").trim(),
    dossier: (row[2] ?? "").trim(),
    type: (row[3] ?? "").trim(),
    tache: (row[4] ?? "").trim(),
    contact: (row[5] ?? "").trim(),
    echeance,
    priorite: (row[7] ?? "").trim(),
    statut: (row[8] ?? "").trim(),
    j_moins: /^\d{2}\/\d{2}\/\d{4}$/.test(echeance) ? daysUntil(echeance) : null,
    notes: (row[10] ?? "").trim(),
  };
}

async function readTodoRows(): Promise<TodoRow[]> {
  const grid = await readGrid(TODO, "K");
  return grid
    .slice(1)
    .map((row, i) => toTodoRow(row, i + 1))
    .filter((r) => r.tache !== "");
}

/**
 * Ajoute une ligne au TODO en réinjectant les formules des colonnes A et J.
 * Refuse un doublon : même intitulé (normalisé) et même échéance.
 */
export async function todoAdd(fields: TodoFields) {
  const refs = await loadReferentiels();
  const echeance = fields.echeance ? canonicalDate(fields.echeance) : "";
  const complete: Required<Omit<TodoFields, "echeance">> & { echeance: string } = {
    entite: fields.entite,
    dossier: fields.dossier,
    type: fields.type,
    tache: fields.tache.trim(),
    contact: fields.contact ?? "",
    echeance,
    priorite: fields.priorite ?? "2-Moyenne",
    statut: fields.statut ?? "À faire",
    notes: fields.notes ?? "",
  };
  if (complete.tache === "") throw new Error("La tâche (intitulé) est obligatoire.");
  validateTodoValues(complete, refs);

  const existing = await readTodoRows();
  const key = dupKey(complete.tache, echeance);
  const clash = existing.find((r) => dupKey(r.tache, r.echeance) === key);
  if (clash) {
    throw new Error(
      `Doublon refusé : la ligne ${clash.id || clash.ligne} porte déjà « ${clash.tache} » ` +
        `avec la même échéance (${clash.echeance || "sans échéance"}).`
    );
  }

  const n = await appendAndLocate(TODO, [
    "", // A ID (formule posée juste après)
    complete.entite,
    complete.dossier,
    complete.type,
    complete.tache,
    complete.contact,
    complete.echeance,
    complete.priorite,
    complete.statut,
    "", // J J- (formule posée juste après)
    complete.notes,
  ]);
  const f = todoFormulas(n);
  await writeCells([
    { range: `${TODO}!A${n}`, values: [[f.a]] },
    { range: `${TODO}!J${n}`, values: [[f.j]] },
  ]);
  await dressRow(TODO, n, TODO_VALIDATIONS);
  return { ligne: n, id: `T${String(n - 1).padStart(3, "0")}`, tache: complete.tache };
}

/**
 * Met à jour une ligne du TODO identifiée par son ID (Txxx) ou par son
 * intitulé (correspondance exacte d'abord, partielle sinon). Ne touche
 * jamais aux colonnes calculées A et J.
 */
export async function todoUpdate(cle: string, updates: TodoUpdates) {
  const fields = Object.entries(updates).filter(([, v]) => v !== undefined);
  if (!fields.length) throw new Error("Aucune mise à jour fournie.");

  const refs = await loadReferentiels();
  validateTodoValues(updates, refs);

  const rows = await readTodoRows();
  const cleTrim = cle.trim();
  let matches: TodoRow[];
  if (/^T\d{3}$/i.test(cleTrim)) {
    matches = rows.filter((r) => r.id.toUpperCase() === cleTrim.toUpperCase());
  } else {
    const norm = normalizeTask(cleTrim);
    matches = rows.filter((r) => normalizeTask(r.tache) === norm);
    if (!matches.length) {
      matches = rows.filter((r) => normalizeTask(r.tache).includes(norm));
    }
  }
  if (!matches.length) {
    throw new Error(`Aucune ligne du TODO ne correspond à « ${cle} ».`);
  }
  if (matches.length > 1) {
    const list = matches.map((r) => `${r.id || r.ligne} : ${r.tache}`).join(" | ");
    throw new Error(
      `Clé ambiguë, ${matches.length} lignes correspondent à « ${cle} » : ${list}. ` +
        `Préciser l'ID ou l'intitulé exact.`
    );
  }

  const target = matches[0];
  const data = fields.map(([field, value]) => {
    const column = TODO_COLUMNS[field as keyof TodoUpdates];
    const cell =
      field === "echeance" ? canonicalDate(String(value)) : String(value);
    return { range: `${TODO}!${column}${target.ligne}`, values: [[cell]] };
  });
  await writeCells(data);
  return {
    ligne: target.ligne,
    id: target.id,
    tache: updates.tache ?? target.tache,
    champs_modifies: fields.map(([f]) => f),
  };
}

/** Lecture filtrée du TODO. Par défaut, exclut les lignes Fait et Annulé. */
export async function todoRead(filters: TodoReadFilters = {}) {
  let rows = await readTodoRows();
  if (!filters.inclure_termines) {
    rows = rows.filter((r) => r.statut !== "Fait" && r.statut !== "Annulé");
  }
  if (filters.dossier) rows = rows.filter((r) => r.dossier === filters.dossier);
  if (filters.statut) rows = rows.filter((r) => r.statut === filters.statut);
  if (filters.en_retard) {
    rows = rows.filter((r) => r.j_moins !== null && r.j_moins < 0);
  }
  if (filters.echeance_sous_jours !== undefined) {
    const horizon = filters.echeance_sous_jours;
    rows = rows.filter((r) => r.j_moins !== null && r.j_moins <= horizon);
  }
  rows.sort((a, b) => (a.j_moins ?? 9999) - (b.j_moins ?? 9999));
  return { nombre: rows.length, lignes: rows };
}

// ---- SAS -----------------------------------------------------------------

interface SasRow {
  ligne: number;
  fields: TodoFields;
  source: string;
  valider: string;
}

async function readSasRows(): Promise<SasRow[]> {
  const grid = await readGrid(SAS, "M");
  return grid
    .slice(1)
    .map((row, i) => ({
      ligne: i + 2,
      fields: {
        entite: (row[1] ?? "").trim(),
        dossier: (row[2] ?? "").trim(),
        type: (row[3] ?? "").trim(),
        tache: (row[4] ?? "").trim(),
        contact: (row[5] ?? "").trim(),
        echeance: normalizeSheetDate(row[6] ?? ""),
        priorite: (row[7] ?? "").trim(),
        statut: (row[8] ?? "").trim(),
        notes: (row[10] ?? "").trim(),
      },
      source: (row[11] ?? "").trim(),
      valider: (row[12] ?? "").trim(),
    }))
    .filter((r) => r.fields.tache !== "");
}

/**
 * Dépose une proposition dans le SAS (colonne Valider laissée vide, à cocher
 * par Enguérand). Refuse un doublon contre le SAS en attente ET contre le TODO.
 */
export async function sasAdd(fields: TodoFields, source: string) {
  if (!source || !source.trim()) {
    throw new Error(
      "La source est obligatoire (ex. « Mail de X du 24/08 » ou « Source : Google Agenda »)."
    );
  }
  const refs = await loadReferentiels();
  const echeance = fields.echeance ? canonicalDate(fields.echeance) : "";
  const tache = fields.tache.trim();
  if (tache === "") throw new Error("La tâche (intitulé) est obligatoire.");
  validateTodoValues(fields, refs);

  const key = dupKey(tache, echeance);
  const pendingStates = ["", "O", "N", "Modifier"];
  const sasClash = (await readSasRows()).find(
    (r) =>
      pendingStates.includes(r.valider) &&
      dupKey(r.fields.tache, r.fields.echeance ?? "") === key
  );
  if (sasClash) {
    throw new Error(
      `Doublon refusé : le SAS contient déjà « ${sasClash.fields.tache} » en ligne ${sasClash.ligne} ` +
        `avec la même échéance, en attente de validation.`
    );
  }
  const todoClash = (await readTodoRows()).find(
    (r) => dupKey(r.tache, r.echeance) === key
  );
  if (todoClash) {
    throw new Error(
      `Doublon refusé : le TODO contient déjà « ${todoClash.tache} » ` +
        `(${todoClash.id || `ligne ${todoClash.ligne}`}) avec la même échéance.`
    );
  }

  const n = await appendAndLocate(SAS, [
    "", // A vide dans le SAS
    fields.entite,
    fields.dossier,
    fields.type,
    tache,
    fields.contact ?? "",
    echeance,
    fields.priorite ?? "2-Moyenne",
    fields.statut ?? "À faire",
    "", // J vide dans le SAS
    fields.notes ?? "",
    source.trim(),
    "", // M Valider : décision d'Enguérand
  ]);
  await dressRow(SAS, n, SAS_VALIDATIONS);
  return { ligne: n, tache };
}

/**
 * Bascule du SAS vers le TODO : les lignes validées « O » sont créées dans le
 * TODO (avec formules) puis marquées « Basculé » ; les « N » passent à
 * « Rejeté ». Les « Modifier » et les vides restent intactes.
 */
export async function sasFlush() {
  const rows = await readSasRows();
  const result = {
    basculees: 0,
    rejetees: 0,
    deja_presentes: 0,
    erreurs: [] as string[],
  };

  for (const row of rows) {
    const decision = row.valider.trim().toUpperCase();
    if (decision === "N") {
      await writeCells([{ range: `${SAS}!M${row.ligne}`, values: [["Rejeté"]] }]);
      result.rejetees += 1;
      continue;
    }
    if (decision !== "O") continue;
    try {
      await todoAdd(row.fields);
      result.basculees += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.startsWith("Doublon refusé")) {
        result.deja_presentes += 1; // déjà au TODO : la marque Basculé suffit
      } else {
        result.erreurs.push(`SAS ligne ${row.ligne} (« ${row.fields.tache} ») : ${message}`);
        continue; // ligne laissée en « O » pour retraitement
      }
    }
    await writeCells([{ range: `${SAS}!M${row.ligne}`, values: [["Basculé"]] }]);
  }
  return result;
}

// ---- DOSSIERS ------------------------------------------------------------

/**
 * Crée un dossier : ligne dans DOSSIERS (avec les compteurs J/K en formule
 * française) puis code ajouté dans LISTES!B (plage des validations).
 * Refuse un code déjà présent dans l'un ou l'autre.
 */
export async function dossierAdd(fields: DossierFields) {
  const code = fields.code.trim().toUpperCase();
  if (!/^[A-Z0-9-]{2,12}$/.test(code)) {
    throw new Error(
      `Code « ${fields.code} » invalide : 2 à 12 caractères A-Z, 0-9 ou tiret.`
    );
  }
  const refs = await loadReferentiels();
  assertInList(fields.entite, refs.entites, "Entité");

  const dossiersGrid = await readGrid(DOSSIERS, "L");
  const existingCodes = dossiersGrid.slice(1).map((r) => (r[0] ?? "").trim().toUpperCase());
  if (existingCodes.includes(code)) {
    throw new Error(`Le code « ${code} » existe déjà dans DOSSIERS.`);
  }
  if (refs.dossiers.map((d) => d.toUpperCase()).includes(code)) {
    throw new Error(`Le code « ${code} » existe déjà dans LISTES.`);
  }

  // Première cellule libre de LISTES!B dans la plage couverte par les validations.
  const listesGrid = await readGrid(LISTES, "B");
  let freeRow: number | null = null;
  for (let row = LISTES_DOSSIER_FIRST_ROW; row <= LISTES_DOSSIER_LAST_ROW; row++) {
    const value = (listesGrid[row - 1]?.[1] ?? "").trim();
    if (value === "") {
      freeRow = row;
      break;
    }
  }
  if (freeRow === null) {
    throw new Error(
      `La plage LISTES!B${LISTES_DOSSIER_FIRST_ROW}:B${LISTES_DOSSIER_LAST_ROW} est pleine : ` +
        `étendre d'abord la plage de validation de la colonne Dossier.`
    );
  }

  const n = await appendAndLocate(DOSSIERS, [
    code,
    fields.dossier.trim(),
    fields.entite,
    fields.type_mission.trim(),
    fields.contact_principal ?? "",
    fields.statut ?? "Actif",
    fields.prochaine_etape ?? "",
    fields.echeance_cle ? canonicalDate(fields.echeance_cle) : "",
    fields.honoraires ?? "",
    "", // J Ouvertes (formule ci-dessous)
    "", // K En retard (formule ci-dessous)
    fields.notes ?? "",
  ]);
  await writeCells([
    {
      range: `${DOSSIERS}!J${n}`,
      values: [[
        `=SI($A${n}="";"";NB.SI.ENS(TODO!$C:$C;$A${n})-NB.SI.ENS(TODO!$C:$C;$A${n};TODO!$I:$I;"Fait")-NB.SI.ENS(TODO!$C:$C;$A${n};TODO!$I:$I;"Annulé"))`,
      ]],
    },
    {
      range: `${DOSSIERS}!K${n}`,
      values: [[`=SI($A${n}="";"";NB.SI.ENS(TODO!$C:$C;$A${n};TODO!$J:$J;"<0"))`]],
    },
    { range: `${LISTES}!B${freeRow}`, values: [[code]] },
  ]);
  await dressRow(DOSSIERS, n, [], 7); // H Échéance clé
  return { code, ligne_dossiers: n, ligne_listes: freeRow };
}

// ---- Aperçu global -------------------------------------------------------

/** Compte les lignes du SAS en attente de décision (Valider vide ou Modifier). */
export async function sasPending() {
  const rows = await readSasRows();
  const pending = rows.filter((r) => ["", "Modifier"].includes(r.valider));
  const decided = rows.filter((r) => ["O", "N"].includes(r.valider.toUpperCase()));
  return {
    en_attente: pending.length,
    decidees_non_basculees: decided.length,
    lignes: pending.map((r) => ({
      ligne: r.ligne,
      tache: r.fields.tache,
      dossier: r.fields.dossier,
      echeance: r.fields.echeance ?? "",
      source: r.source,
      valider: r.valider,
    })),
  };
}
