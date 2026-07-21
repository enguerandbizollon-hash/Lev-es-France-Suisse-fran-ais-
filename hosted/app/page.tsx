export default function Home() {
  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 640,
        margin: "0 auto",
        padding: "3rem 1.5rem",
        lineHeight: 1.6,
      }}
    >
      <h1 style={{ letterSpacing: "-0.02em" }}>Connecteur Scale Up — Sheets/Docs</h1>
      <p style={{ color: "#555" }}>
        Serveur MCP privé pour les équipes Scale Up. Il permet à Claude d'écrire
        dans les Google Sheets et Docs du Drive partagé Scale Up.
      </p>
      <p>
        Point de terminaison à ajouter dans Claude (Réglages → Connecteurs) :{" "}
        <code
          style={{
            background: "#f0f0f0",
            padding: "0.15rem 0.4rem",
            borderRadius: 4,
          }}
        >
          /api/mcp
        </code>
      </p>
      <p style={{ color: "#999", fontSize: "0.9rem" }}>
        Périmètre : Google uniquement, Drive partagé Scale Up. Aucun accès à une
        activité privée hors périmètre.
      </p>
    </main>
  );
}
