"""Client haut niveau pour manipuler des Google Docs.

Cas d'usage principal : remplir un document modèle (proposition commerciale,
compte-rendu) en remplaçant des marqueurs comme {{client}} ou {{montant}} par
les vraies valeurs, via l'opération `replaceAllText` de l'API Docs.
"""

from __future__ import annotations

from typing import Any


def _extract_text(document: dict) -> str:
    """Reconstruit le texte brut d'un document Docs à partir de sa structure."""
    parts: list[str] = []
    for element in document.get("body", {}).get("content", []):
        paragraph = element.get("paragraph")
        if not paragraph:
            continue
        for run in paragraph.get("elements", []):
            text_run = run.get("textRun")
            if text_run and "content" in text_run:
                parts.append(text_run["content"])
    return "".join(parts)


def _document_end_index(document: dict) -> int:
    """Retourne l'index de fin du corps (pour insérer à la fin)."""
    content = document.get("body", {}).get("content", [])
    if not content:
        return 1
    return content[-1].get("endIndex", 1)


class DocsClient:
    """Wrapper pratique autour de l'API Google Docs v1."""

    def __init__(self, service=None):
        if service is None:
            from .auth import build_docs_service

            service = build_docs_service()
        self._service = service

    @property
    def _docs(self):
        return self._service.documents()

    def read_text(self, document_id: str) -> str:
        """Retourne le texte brut d'un document."""
        doc = self._docs.get(documentId=document_id).execute()
        return _extract_text(doc)

    def fill_template(
        self,
        document_id: str,
        replacements: dict[str, Any],
        match_case: bool = True,
    ) -> dict:
        """Remplace chaque clé de `replacements` par sa valeur dans tout le doc.

        Exemple : {"{{client}}": "ACME", "{{montant}}": "25 000 €"}.
        Astuce : copiez d'abord le modèle (via le connecteur Drive) pour ne pas
        écraser l'original, puis remplissez la copie.
        """
        requests = []
        for marker, value in replacements.items():
            requests.append(
                {
                    "replaceAllText": {
                        "containsText": {"text": marker, "matchCase": match_case},
                        "replaceText": str(value),
                    }
                }
            )
        if not requests:
            return {"replies": []}
        return self._docs.batchUpdate(
            documentId=document_id, body={"requests": requests}
        ).execute()

    def append_text(self, document_id: str, text: str) -> dict:
        """Ajoute du texte à la fin du document."""
        doc = self._docs.get(documentId=document_id).execute()
        end_index = _document_end_index(doc)
        # On ne peut pas insérer sur le tout dernier saut de ligne : end_index - 1.
        insert_at = max(1, end_index - 1)
        return self._docs.batchUpdate(
            documentId=document_id,
            body={
                "requests": [
                    {"insertText": {"location": {"index": insert_at}, "text": text}}
                ]
            },
        ).execute()
