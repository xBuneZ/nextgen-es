#!/usr/bin/env python3
"""
Registro público de correcciones: reúne los avisos de error (issues con la etiqueta
«correccion») y su resultado (etiquetas «corregido» o «no-procede») en
site/data/correcciones.json.

Variables: GITHUB_REPOSITORY y GITHUB_TOKEN.
"""
import datetime as dt
import json
import os
import re
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "site" / "data" / "correcciones.json"


def issues() -> list:
    out, page = [], 1
    while True:
        req = urllib.request.Request(
            f"https://api.github.com/repos/{os.environ['GITHUB_REPOSITORY']}/issues?labels=correccion&state=all&per_page=100&page={page}",
            headers={"Accept": "application/vnd.github+json", "Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}", "User-Agent": "nextgen-es"})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.load(r)
        out += [i for i in data if "pull_request" not in i]
        if len(data) < 100:
            return out
        page += 1


def campo(body: str, etiqueta: str) -> str:
    m = re.search(rf"^### {re.escape(etiqueta)}\s*\n+(.*?)(?=^### |\Z)", body or "", re.S | re.M)
    v = m.group(1).strip() if m else ""
    return "" if v == "_No response_" else v


def main():
    lista = []
    for it in issues():
        labels = {l["name"].lower() for l in it.get("labels", [])}
        if "spam" in labels or "invalida" in labels:
            continue
        estado = "corregido" if "corregido" in labels else "no_procede" if "no-procede" in labels else "en_revision"
        lista.append({
            "titulo": re.sub(r"^\[Correcci[oó]n\]\s*", "", it["title"]).strip() or "(sin título)",
            "ref": campo(it.get("body", ""), "Ficha o página afectada")[:300],
            "estado": estado, "url": it["html_url"],
            "abierto": it["created_at"][:10], "cerrado": (it.get("closed_at") or "")[:10],
        })
    lista.sort(key=lambda x: x["abierto"], reverse=True)
    OUT.write_text(json.dumps({"generado": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "correcciones": lista},
                              ensure_ascii=False, separators=(",", ":")))
    print(f"{len(lista)} avisos de corrección")


if __name__ == "__main__":
    main()
