#!/usr/bin/env python3
"""
Reúne las solicitudes de transparencia registradas como issues (etiqueta
«transparencia») y genera site/data/solicitudes.json para mostrarlas en cada ficha.

Variables: GITHUB_REPOSITORY (owner/repo) y GITHUB_TOKEN.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "site" / "data" / "solicitudes.json"
PLAZO_DIAS = 31  # un mes (art. 20 Ley 19/2013); puede ampliarse otro mes si se notifica


def api(path: str) -> list:
    out, page = [], 1
    while True:
        req = urllib.request.Request(
            f"https://api.github.com/repos/{os.environ['GITHUB_REPOSITORY']}/{path}&per_page=100&page={page}",
            headers={"Accept": "application/vnd.github+json", "Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}",
                     "User-Agent": "nextgen-es"})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.load(r)
        out += data
        if len(data) < 100:
            return out
        page += 1


def fields(body: str) -> dict:
    """Las issue forms generan «### Etiqueta\\n\\nvalor»."""
    res = {}
    for m in re.finditer(r"^### (.+?)\s*\n+(.*?)(?=^### |\Z)", body or "", re.S | re.M):
        v = m.group(2).strip()
        res[m.group(1).strip().lower()] = "" if v == "_No response_" else v
    return res


def main() -> None:
    today = dt.date.today()
    sol = {}
    for it in api("issues?labels=transparencia&state=all"):
        if "pull_request" in it:
            continue
        f = fields(it.get("body", ""))
        ref = (f.get("referencia en la web") or "").strip()
        if not re.match(r"^[cs]:\S+$", ref):
            continue
        labels = {l["name"].lower() for l in it.get("labels", [])}
        if "invalida" in labels or "spam" in labels:
            continue
        est = norm_estado(f.get("estado", ""), labels)
        try:
            dias = (today - dt.date.fromisoformat(f.get("fecha de presentación", "")[:10])).days
        except ValueError:
            dias = None
        if est == "pendiente" and dias is not None and dias > PLAZO_DIAS:
            est = "vencida"
        s = sol.setdefault(ref, {"total": 0, "respondidas": 0, "denegadas": 0, "pendientes": 0, "vencidas": 0, "reclamadas": 0, "items": []})
        s["total"] += 1
        s[{"respondida": "respondidas", "denegada": "denegadas", "pendiente": "pendientes",
           "vencida": "vencidas", "reclamada": "reclamadas"}[est]] += 1
        s["items"].append({"url": it["html_url"], "estado": est, "dias": dias})
    OUT.write_text(json.dumps({"generado": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                               "solicitudes": sol}, ensure_ascii=False, separators=(",", ":")))
    print(f"{sum(s['total'] for s in sol.values())} solicitudes en {len(sol)} expedientes")


def norm_estado(v: str, labels: set) -> str:
    v = (v or "").lower()
    for k in ("respondida", "denegada", "reclamada"):
        if k in labels or v.startswith(k):
            return k
    return "pendiente"


if __name__ == "__main__":
    main()
