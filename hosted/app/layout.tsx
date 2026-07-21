export const metadata = {
  title: "Connecteur Scale Up — Sheets/Docs",
  description: "Serveur MCP hébergé pour les équipes Scale Up.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
