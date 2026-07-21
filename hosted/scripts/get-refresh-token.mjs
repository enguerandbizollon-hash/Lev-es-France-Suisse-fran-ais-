/**
 * Obtient le GOOGLE_REFRESH_TOKEN du robot Scale Up, une seule fois.
 *
 * Usage :
 *   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/get-refresh-token.mjs
 *
 * 1. Le script affiche une URL. Ouvrez-la dans le navigateur, connecté avec le
 *    compte Scale Up qui aura accès au Drive partagé (idéalement un compte
 *    « robot » dédié, jamais un compte qui voit des données privées).
 * 2. Autorisez. Vous êtes redirigé vers http://localhost/?code=... (page
 *    d'erreur normale). Copiez la valeur `code` de la barre d'adresse.
 * 3. Collez-la dans le terminal. Le script imprime le refresh token.
 * 4. Placez ce token dans la variable d'environnement GOOGLE_REFRESH_TOKEN
 *    du projet Vercel.
 *
 * Node 18+ (fetch intégré). Aucune dépendance externe.
 */

import http from "node:http";
import readline from "node:readline";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost";
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/documents",
].join(" ");

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "Définissez GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET avant de lancer ce script."
  );
  process.exit(1);
}

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  }).toString();

console.log("\n1) Ouvrez cette URL dans votre navigateur :\n");
console.log(authUrl);
console.log(
  "\n2) Après avoir autorisé, copiez le paramètre `code` de l'URL localhost.\n"
);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question("Collez le code ici : ", async (code) => {
  rl.close();
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: code.trim(),
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    const data = await res.json();
    if (data.refresh_token) {
      console.log("\n✅ GOOGLE_REFRESH_TOKEN =\n");
      console.log(data.refresh_token);
      console.log(
        "\nAjoutez-le dans Vercel (Settings → Environment Variables). Ne le committez jamais.\n"
      );
    } else {
      console.error("\n❌ Pas de refresh_token dans la réponse :", data);
    }
  } catch (err) {
    console.error("Erreur lors de l'échange du code :", err);
  }
});
