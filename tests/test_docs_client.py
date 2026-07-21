"""Tests de la logique du client Docs, avec une fausse API Docs en mémoire.

Aucune credential Google n'est nécessaire.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from gsheets_connector.docs_client import (  # noqa: E402
    DocsClient,
    _extract_text,
    _document_end_index,
)


def _doc_from_text(text: str) -> dict:
    """Construit une structure Docs minimale contenant `text`."""
    return {
        "body": {
            "content": [
                {"endIndex": 1},  # élément initial (section break)
                {
                    "endIndex": 1 + len(text),
                    "paragraph": {
                        "elements": [
                            {"textRun": {"content": text}}
                        ]
                    },
                },
            ]
        }
    }


class _FakeDocs:
    def __init__(self, doc):
        self.doc = doc
        self.last_requests = None

    def get(self, documentId):
        return _Exec(lambda: self.doc)

    def batchUpdate(self, documentId, body):
        def run():
            self.last_requests = body["requests"]
            return {"replies": [{} for _ in body["requests"]]}
        return _Exec(run)


class _Exec:
    def __init__(self, fn):
        self._fn = fn

    def execute(self):
        return self._fn()


class _FakeService:
    def __init__(self, doc):
        self._docs = _FakeDocs(doc)

    def documents(self):
        return self._docs


def test_extract_text():
    doc = _doc_from_text("Bonjour {{client}}")
    assert _extract_text(doc) == "Bonjour {{client}}"


def test_end_index():
    doc = _doc_from_text("abc")
    assert _document_end_index(doc) == 4  # 1 + len("abc")


def test_fill_template_builds_replace_requests():
    doc = _doc_from_text("Cher {{client}}, montant {{montant}}.")
    service = _FakeService(doc)
    client = DocsClient(service=service)
    client.fill_template(
        "docid", {"{{client}}": "ACME", "{{montant}}": "25 000 €"}
    )
    reqs = service._docs.last_requests
    assert len(reqs) == 2
    markers = {r["replaceAllText"]["containsText"]["text"] for r in reqs}
    assert markers == {"{{client}}", "{{montant}}"}
    values = {r["replaceAllText"]["replaceText"] for r in reqs}
    assert values == {"ACME", "25 000 €"}


def test_fill_template_empty_noop():
    doc = _doc_from_text("rien")
    client = DocsClient(service=_FakeService(doc))
    assert client.fill_template("docid", {}) == {"replies": []}


def test_append_inserts_before_final_newline():
    doc = _doc_from_text("abc")  # end_index = 4
    service = _FakeService(doc)
    client = DocsClient(service=service)
    client.append_text("docid", "XYZ")
    req = service._docs.last_requests[0]["insertText"]
    assert req["text"] == "XYZ"
    assert req["location"]["index"] == 3  # end_index - 1


if __name__ == "__main__":
    import traceback

    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except Exception:
            failed += 1
            print(f"FAIL {t.__name__}")
            traceback.print_exc()
    print(f"\n{len(tests) - failed}/{len(tests)} tests réussis")
    sys.exit(1 if failed else 0)
