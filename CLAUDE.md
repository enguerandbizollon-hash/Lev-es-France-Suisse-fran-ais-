# Brief Claude Code — Système de pilotage Vectis Finance
Document de contexte à charger en tête de session Claude Code (ou à placer en `CLAUDE.md`).
État au 24/08/2026.
---
## 1. Qui, quoi
Enguérand Bizollon, consultant M&A indépendant, travaille seul sur deux structures :
- **Vectis Finance** (VF) : sa société, M&A small cap 500k à 20 M€, sell-side, buy-side, cession d'actif. Positionnement sous les banques d'affaires. Lyon.
- **Scale Up Services** (SUS) : cabinet genevois où il intervient en mission (finance, CFO, fundraising, M&A). Il facture ces missions via Vectis Finance.
Le système a un seul objectif : qu'aucun engagement, aucune attente et aucune échéance ne se perde, sur les deux structures à la fois.
---
## 2. Architecture réelle
```
                    ┌─────────────────────────────┐
   Gmail            │                             │      Microsoft 365
   scaleup4u.ch ───►│    Routines planifiées      │◄───  vectis-finance.fr
   + Google Cal     │    matin 7h / soir 17h30    │      + Outlook Cal
                    │                             │
                    └──────────────┬──────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────┐
                    │  Connecteur MCP             │
                    │  Connecteur_Sheet_Doc_Web   │
                    │  (outils métier)            │
                    └──────────────┬──────────────┘
                                   │
                                   ▼
                    ┌─────────────────────────────┐
                    │  Google Sheet               │
                    │  Pilotage_Vectis            │
                    │  TODO / DOSSIERS / LISTES   │
                    │  / SAS                      │
                    └─────────────────────────────┘
```
### Les deux messageries, point critique
| | Scale Up | Vectis |
|---|---|---|
| Adresse | enguerand.bizollon@scaleup4u.ch | ebizollon@vectis-finance.fr |
| Plateforme | Google Workspace | Microsoft 365 |
| Connecteur MCP | `Gmail`, `Google_Calendar` | `Microsoft_365` |
| Outils | `mcp__Gmail__*` | `outlook_email_search`, `outlook_calendar_search`, `read_resource`, `get_me` |
| Dossiers portés | HJ, RP, SUS | VF, ROUSSON, TCF, TU, ADMIN |
**Les deux boîtes sont étanches.** Un mail Vectis n'apparaît jamais dans une recherche Gmail et inversement. C'est la cause de la panne du 24/08 : les routines ne lisaient que Gmail, et toute l'activité Vectis (dossier ROUSSON, facturation, prospection, URSSAF) était invisible. Corrigé dans les deux prompts.
Le brief du soir est envoyé **depuis Gmail vers ebizollon@vectis-finance.fr**. Seule adresse destinataire autorisée.
---
## 3. Le fichier Pilotage_Vectis
`1l_DIwVL0XP0FCJL7dLqf3arAyfKrAm5ZTDTAtwhuLJw`
Quatre onglets : `TODO`, `DOSSIERS`, `LISTES`, `SAS`.
### Le SAS, mécanisme central
Rien n'entre au TODO sans validation humaine. Le flux est :
```
mail ──► sas_add ──► [colonne Valider : O / N / Modifier / vide]
                              │
                     sas_flush│
                              ├─ « O »        ──► TODO, ligne marquée « Basculé »
                              ├─ « N »        ──► « Rejeté »
                              └─ vide/Modifier──► intact
```
`todo_add` est réservé aux RDV d'agenda et aux entrées déjà validées. Toute action déduite d'un mail passe par `sas_add`, avec `source` obligatoire.
### Outils métier exposés
| Outil | Rôle |
|---|---|
| `todo_read` | Lecture filtrée : `en_retard`, `echeance_sous_jours`, `dossier`, `statut`, `inclure_termines` |
| `todo_add` | Ajout direct, gère formules ID et J-, refuse doublon (même intitulé + même échéance) |
| `todo_update` | Mise à jour par ID `Txxx` ou intitulé |
| `sas_add` | Proposition au SAS, `source` obligatoire, avertit d'un recouvrement avec le TODO ouvert du même dossier |
| `sas_flush` | Bascule / rejet, retourne un décompte |
| `sas_pending` | Lignes en attente de décision |
| `dossier_add` | Création dossier (DOSSIERS + LISTES) |
| génériques | `read_range`, `list_tabs`, `append_row`, `upsert_row`, `docs_read`, `docs_fill_template` |
### Référentiels, validés serveur
- **Entité** : `VF` ou `SUS` uniquement
- **Dossier** : `VF`, `HJ`, `RP`, `TCF`, `TU`, `SUS`, `ADMIN`, `ROUSSON`
- **Type** : Production, Relance, RDV, Événement, Call, Admin, Décision, Veille, Mail
- **Priorité** : 1-Haute, 2-Moyenne, 3-Basse
- **Statut** : À faire, En cours, En attente, Fait, Annulé
Règle : **l'entité suit le dossier, pas la boîte d'origine**. Un mail arrivé sur Vectis qui concerne Redpeaks reste entité `SUS`.
Colonnes calculées à ne jamais écrire : ID, J-, Probabilité, Alerte.
---
## 4. Les routines planifiées
| Nom | ID | Cron (UTC) | Heure locale |
|---|---|---|---|
| Brief Vectis - matin | `trig_019VwGmfuqdsMk4AUzfq9xPv` | `0 5 * * 1-5` | 7h00 |
| Brief Vectis - soir | `trig_01K9uJXJVgJAuALNkMGQCAr5` | `30 15 * * 1-5` | 17h30 |
| CRM Scale Up | `trig_01NkRSxNjdppTznJoNZJD76J` | `0 2 * * 1-5` | 4h00 |
| CRM Vectis Finance | `trig_01HgPVrgjMxfXNx2rPr9vnv1` | `0 5 * * 1-5` | 7h00 |
| SUSR1 | `trig_012XPxBGiSyz5LbDYfz4NAVE` | `0 21 * * 0` | dim. 23h |
Les deux briefs partagent désormais le même bloc de périmètre (deux boîtes, deux agendas, reçus et envoyés) et les mêmes règles invariantes. **Les routines CRM n'ont pas été auditées, elles ont probablement le même angle mort Vectis.**
### Règles invariantes communes aux deux briefs
1. Action déduite d'un mail → `sas_add`, jamais `todo_add`.
2. Jamais de date inventée. Si la source n'en porte pas : date de travail réaliste + mention « Échéance proposée » dans les notes.
3. Jamais de fait inventé. Chaque ligne cite sa source.
4. Doublon refusé ≠ erreur.
5. Outil en échec → signalé précisément, pas de retry aveugle.
6. **Ne jamais conclure sur un fil à partir des seuls résultats de recherche.** `search_threads` ne renvoie que les cinq messages les plus **anciens** d'un fil, sans marqueur de troncature. Un fil de 20 messages peut sembler mort alors que la réponse est au 18e. Ouvrir avec `get_thread` / `read_resource`.
7. Mails personnels écartés du tri, mentionnés d'une ligne neutre sans contenu.
8. Côté Vectis, remontée systématique en priorité 1 : facture émise sans règlement constaté, échéance sociale ou fiscale évoquée dans un mail.
---
## 5. Conventions de rédaction des mails
- Police **Aptos, taille 12**, corps HTML.
- Ton sobre, M&A. Phrases courtes.
- Interdits : superlatifs, tiret cadratin, emoji, « rien à signaler » (une section vide est omise).
- Les chiffres et références cités dans les mails sources (montants, numéros de facture, noms de contrats, dates proposées) sont repris tels quels. C'est ce qui fait la valeur du brief.
- **Objet de tout mail sortant vers un contact** : ID en fin d'objet entre crochets, format 1 lettre + 3 chiffres, ex. `[HJ-C047]`, `[SUS-C007]`. L'ID se lit dans le CRM, jamais inventé. Identique sur toute la séquence, premier contact comme relances.
- Claude ne fait que rédiger. Enguérand envoie.
---
## 6. Défauts structurels constatés le 24/08
À traiter, par ordre d'impact.
### 6.1 Angle mort Vectis — corrigé
Les routines ne lisaient que Gmail. Toute l'activité Vectis était absente des briefs. Corrigé dans les deux prompts par un bloc de périmètre en tête, avec obligation de signaler explicitement toute boîte non lue plutôt que de rendre un brief silencieux.
### 6.2 Doublons sémantiques SAS / TODO — corrigé côté serveur
`sas_add` refuse un doublon strict (intitulé identique). Il ne détectait pas un recouvrement de sens. Résultat le 24/08 : trois propositions déposées au SAS recoupaient des lignes TODO déjà ouvertes.
| Ligne SAS déposée | Ligne TODO existante |
|---|---|
| Envoyer à JF le mail contrats Datadog + Grupo SBF | `T002` Contact Datadog : statut renouvellement ABB, CASD, Ferromex |
| Envoyer à Julie la demande de factures manquantes | `T006` Vérifier factures 15800163, 169, 170 et avoir 28000008 |
| Relancer Damien Rousson sur le créneau du 7 septembre | `T010` Confirmer le rendez-vous de cadrage et fixer une date |
**Correctif immédiat** : marquer `N` sur ces trois lignes du SAS, elles seront rejetées au prochain `sas_flush`.
**Correctif serveur — implémenté** : `sas_add` compare la proposition aux lignes TODO ouvertes du même dossier (même contact, ou similarité d'intitulé au-delà du seuil `SEUIL_SIMILARITE`) et retourne un champ `recouvrements` avec un avertissement. Sans bloquer : la décision reste au SAS. Voir `hosted/lib/pilotage.ts`.
**Mémoire inter-exécutions — implémentée le 25/08** : `sas_add` refuse aussi le doublon strict contre une proposition déjà rejetée (un « N » d'Enguérand ne se redépose pas à l'identique), et l'avertissement `recouvrements` couvre, par intitulé proche sur le même dossier, les tâches TODO déjà faites ou annulées et les propositions SAS déjà rejetées (champ `origine`). Une routine ne repropose donc plus mécaniquement ce qui a été fait ou tranché.
**Correctif de prompt, immédiat** : les routines doivent lire le TODO ouvert du dossier concerné avant de déposer une proposition sur ce dossier, et relayer tout avertissement `recouvrements` dans le brief.
### 6.3 Le TODO n'est jamais restitué en entier — ouvert
Le brief du soir ne montre le TODO qu'à travers deux filtres : « en retard » et « échéance à J+1 ». Le 24/08, les deux étaient vides et le brief a laissé croire à un TODO vide. Il contenait 11 lignes ouvertes, dont quatre en priorité 1.
**Correctif** : ajouter au brief du soir une section « TODO ouvert » restituant les lignes à J+7, groupées par dossier. La section « En retard » reste distincte.
### 6.4 Les compteurs de DOSSIERS ne sont pas fiables — à vérifier
L'onglet DOSSIERS affiche `Ouvertes = 7` pour RP et `0` pour tous les autres dossiers, alors que le TODO porte des lignes ouvertes sur ADMIN, ROUSSON et VF. Les formules de comptage sont à auditer.
### 6.5 Pas de CRM Vectis — ouvert
La convention d'ID contact `[XX-Cxxx]` s'applique à HJ, RP et SUS, qui ont chacun un CRM. Vectis Finance n'en a pas. Conséquence constatée : la séquence de prospection du 29/07 (Revenu, Averseng, Doremus) est partie sans ID, elle est donc non traçable et non rattachable automatiquement.
**À décider** : créer un CRM VF sur le même modèle, ou étendre le CRM SUS avec une colonne entité.
### 6.6 Détection des relances, non outillée — ouvert
Repérer les envois sans réponse est aujourd'hui refait à chaque exécution par raisonnement sur les fils. C'est coûteux en contexte, lent, et non reproductible d'un run à l'autre.
**À coder** : un outil `relances_a_faire(seuil_jours)` côté serveur MCP qui retourne, pour les deux boîtes, les fils dont le dernier message est un envoi d'Enguérand au-delà du seuil, avec destinataire, date, objet et dossier déduit. La routine consommerait un résultat structuré au lieu de le reconstruire. Contrainte : le connecteur `Connecteur_Sheet_Doc_Web` (ce dépôt) n'a que les API Google Sheets/Docs ; cet outil exige un accès Gmail et Microsoft Graph côté serveur, à ajouter avant de pouvoir l'implémenter.
---
## 7. État des dossiers au 24/08
| Code | Dossier | Entité | Type | Point en cours |
|---|---|---|---|---|
| VF | Vectis Finance | VF | Interne | Site internet et positionnement. Prospection du 29/07 sans réponse à 26 jours |
| HJ | Hello Justice | SUS | Fundraising 5 M€ | Litigation funding. Contact IVO Capital sans réponse à 7 jours |
| RP | Redpeaks | SUS | Fundraising | Dossier le plus actif. Base revenus en cours de fiabilisation, deux drafts en attente de validation |
| TCF | Cohen Transport | VF | M&A sell-side | Lettre de mission envoyée en janvier |
| TU | Tribus Urbaines | VF | CFO / Advisory | Pas de mouvement récent |
| SUS | Scale Up Services | SUS | Prospection | Contact Bpifrance, RDV du 06/08, aucune suite tracée |
| ADMIN | Administratif | VF | Interne | **Facture juillet 2026 sans règlement constaté à 23 jours, mention d'un retard URSSAF** |
| ROUSSON | Rousson | VF | M&A buy-side | Relance envoyée le 24/08, semaine du 7 septembre proposée |
Point RP, le plus dense : P&L mensuel janvier 2025 à avril 2026 réconcilié au grand livre, FY2025 bouclé à 94'354 de résultat net, 464 factures analysées, ARR Datacube 982.8k fin 2025 et 1'135.6k fin avril 2026. Deux inconnues bloquantes : le sort des trois contrats Datadog échus au 30.06.2026, et l'écart de 23.7k sur le FY2025 concentré sur décembre.
---
## 8. Garde-fous
- Ne jamais envoyer de mail à un tiers. Claude rédige, Enguérand envoie. Seule exception : le brief vers `ebizollon@vectis-finance.fr`.
- Ne jamais modifier les colonnes calculées.
- Modification de plus de 10 lignes d'un coup : demander confirmation.
- Ne jamais inventer. Une info manquante se demande, elle ne se comble pas.
- Un fil qui ne dit pas si un RDV a eu lieu se restitue tel quel : « aucun échange dans le fil depuis le [date] ».
