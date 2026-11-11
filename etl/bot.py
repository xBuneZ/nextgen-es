#!/usr/bin/env python3
"""
Bot de redes sociales: publica en Bluesky y Mastodon los contratos del Plan de
Recuperación adjudicados recientemente que tienen indicadores de falta de
competencia, con enlace a su ficha en la web.

Solo publica hechos que constan en los datos oficiales y siempre enlaza a la
ficha, donde se explica que un indicador no implica irregularidad.

Secretos (si faltan, el bot solo muestra lo que publicaría):
  BSKY_HANDLE, BSKY_APP_PASSWORD            Bluesky (contraseña de aplicación)
  MASTODON_INSTANCE, MASTODON_TOKEN         p. ej. https://mastodon.social

Uso:
  python3 etl/bot.py --dry-run
  python3 etl/bot.py --max 4 --days 14
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "site" / "data" / "contratos" / "det"  # fichas completas, repartidas en trozos
STATE = ROOT / "etl" / "bot_estado.json"
SITE = os.environ.get("SITE_URL", "https://xbunez.github.io/nextgen-es/")
MIN_IMPORTE = 300_000
LIMIT = 300  # caracteres de Bluesky (grafemas); Mastodon admite 500
PRIORIDAD = ["sin_baja", "negociado_sin_publicidad", "plazo_corto", "ganador_recurrente", "licitador_unico", "emergencia"]


def eur(n: float) -> str:
    if n >= 1e6:
        return f"{n / 1e6:,.1f} millones de €".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{n:,.0f} €".replace(",", ".")


def cid(c: dict) -> str:
    if c.get("cid"):
        return c["cid"]
    m = re.search(r"idEvl=([^&]+)", c.get("url") or "")
    return urllib.parse.unquote(m.group(1)) if m else ""


def motivo(c: dict) -> str:
    f = c["flags"]
    pres = c.get("presupuesto") or 0
    if "sin_baja" in f and pres:
        return f"con una sola oferta y al {100 * c['importe'] / pres:.1f}".replace(".", ",") + " % del precio máximo"
    if "negociado_sin_publicidad" in f:
        return "por procedimiento negociado sin publicidad"
    if "plazo_corto" in f and c.get("plazo") is not None:
        return f"dando solo {c['plazo']} días para presentar ofertas"
    if "ganador_recurrente" in f and c.get("recurrente"):
        return f"sin competencia: ya van {c['recurrente']} contratos ganados así en este organismo"
    if "licitador_unico" in f:
        return "con una sola oferta"
    if "emergencia" in f:
        return "por tramitación de emergencia"
    return ""


def corta(s: str, n: int) -> str:
    s = re.sub(r"\s+", " ", s or "").strip()
    return s if len(s) <= n else s[: n - 1].rstrip(" ,.;-") + "…"


ENTE_LOCAL = re.compile(r"\b(Ayuntamiento|Ajuntament|Concello|Udala|Diputaci[oó]n|Diputaci[oó]|Cabildo|Consell|Mancomunidad|Comarca)\b.*", re.I)
PREFIJOS = re.compile(r"^(Presidencia|Alcald[ií]a|Junta de Gobierno( Local)?|Pleno|Consejo de Administraci[oó]n|Consejo Rector|"
                      r"Direcci[oó]n Gerencia|Gerencia|Secretar[ií]a General|Rectorado)\s+(de la|del|de los|de las|de)\s+", re.I)
OBJ_PREF = re.compile(r"^(constituye el objeto del (presente )?contrato( la| el)?|el objeto del (presente )?contrato es( la| el)?|"
                      r"contrato (de|para)( la| el)?|objeto:?)\s*", re.I)


def organismo(c: dict) -> str:
    o = re.sub(r"\s+", " ", c.get("organo") or "").strip()
    m = re.search(r"\(([A-ZÁÉÍÓÚÑ0-9\-]{3,})\)\s*$", o)
    if m:  # Empresa de Transformación Agraria ... (TRAGSA) -> TRAGSA
        return m.group(1)
    m = ENTE_LOCAL.search(o)
    if m:
        return m.group(0)
    return PREFIJOS.sub("", o)


def objeto(c: dict) -> str:
    o = OBJ_PREF.sub("", re.sub(r"\s+", " ", c.get("objeto") or "").strip())
    return o[:1].upper() + o[1:]


def texto(c: dict, link: str) -> str:
    adj = c["adj"][0]["nombre"] if c["adj"] else "—"
    org = organismo(c)
    fijo = f"\n\nContrato pagado con fondos NextGenerationEU.\n{link}"
    # Primero se sacrifica la descripción del objeto; los nombres, solo si no queda otra
    for lo, la, lobj in ((90, 70, 110), (90, 70, 70), (90, 70, 0), (60, 45, 0), (40, 30, 0)):
        cuerpo = f"{corta(org, lo)} adjudicó {eur(c['importe'])} a {corta(adj, la)} {motivo(c)}."
        if lobj:
            cuerpo += f"\n\n«{corta(objeto(c), lobj)}»"
        t = cuerpo + fijo
        if len(t) <= LIMIT:
            return t
    return t[:LIMIT]


def candidatos(d: dict, dias: int, ya: set) -> list[dict]:
    desde = (dt.date.today() - dt.timedelta(days=dias)).isoformat()
    out = []
    for c in d["contratos"]:
        i = cid(c)
        if not i or i in ya or c["importe"] < MIN_IMPORTE or (c.get("fecha") or "") < desde:
            continue
        if not any(f in c["flags"] for f in PRIORIDAD) or not motivo(c):
            continue
        c["_cid"] = i
        out.append(c)
    # Primero los más graves y, dentro de cada tipo, los de mayor importe
    rank = lambda c: min(PRIORIDAD.index(f) for f in c["flags"] if f in PRIORIDAD)
    return sorted(out, key=lambda c: (rank(c), -c["importe"]))


def http_json(url: str, data: dict | None = None, headers: dict | None = None) -> dict:
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None,
                                 headers={"Content-Type": "application/json", "User-Agent": "nextgen-es-bot", **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def bluesky(text: str, link: str, title: str, desc: str) -> None:
    s = http_json("https://bsky.social/xrpc/com.atproto.server.createSession",
                  {"identifier": os.environ["BSKY_HANDLE"], "password": os.environ["BSKY_APP_PASSWORD"]})
    b = text.encode("utf-8")
    start = b.find(link.encode("utf-8"))
    record = {
        "$type": "app.bsky.feed.post", "text": text, "langs": ["es"],
        "createdAt": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "facets": [{"index": {"byteStart": start, "byteEnd": start + len(link.encode("utf-8"))},
                    "features": [{"$type": "app.bsky.richtext.facet#link", "uri": link}]}] if start >= 0 else [],
        "embed": {"$type": "app.bsky.embed.external", "external": {"uri": link, "title": title[:300], "description": desc[:300]}},
    }
    http_json("https://bsky.social/xrpc/com.atproto.repo.createRecord",
              {"repo": s["did"], "collection": "app.bsky.feed.post", "record": record},
              {"Authorization": f"Bearer {s['accessJwt']}"})


def mastodon(text: str, key: str) -> None:
    inst = os.environ["MASTODON_INSTANCE"].rstrip("/")
    http_json(f"{inst}/api/v1/statuses", {"status": text, "language": "es", "visibility": "public"},
              {"Authorization": f"Bearer {os.environ['MASTODON_TOKEN']}", "Idempotency-Key": key[:64]})


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=4, help="publicaciones por ejecución")
    ap.add_argument("--days", type=int, default=14, help="solo contratos adjudicados en los últimos N días")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    d = {"contratos": [c for f in sorted(DATA.glob("*.json")) for c in json.loads(f.read_text()).values()]}
    estado = json.loads(STATE.read_text()) if STATE.exists() else {"publicados": []}
    ya = {p["id"] for p in estado["publicados"]}
    bsky = bool(os.environ.get("BSKY_HANDLE") and os.environ.get("BSKY_APP_PASSWORD"))
    masto = bool(os.environ.get("MASTODON_INSTANCE") and os.environ.get("MASTODON_TOKEN"))
    dry = args.dry_run or not (bsky or masto)
    if dry and not args.dry_run:
        print("Sin credenciales: modo prueba (no se publica nada).")

    publicados = 0
    for c in candidatos(d, args.days, ya)[: args.max]:
        link = f"{SITE}#/contrato/{urllib.parse.quote(c['_cid'], safe='')}"
        t = texto(c, link)
        print("-" * 60 + f"\n{t}\n({len(t)} caracteres)")
        if dry:
            continue
        redes = []
        try:
            if bsky:
                bluesky(t, link, corta(objeto(c), 200), f"{c['organo']} · {eur(c['importe'])} · Next Gen España")
                redes.append("bluesky")
            if masto:
                mastodon(t, c["_cid"])
                redes.append("mastodon")
        except Exception as e:  # noqa: BLE001
            print(f"  ERROR al publicar: {e}", file=sys.stderr)
        if redes:
            estado["publicados"].append({"id": c["_cid"], "fecha": dt.date.today().isoformat(), "redes": redes})
            publicados += 1
    if not dry:
        estado["publicados"] = estado["publicados"][-5000:]
        STATE.write_text(json.dumps(estado, ensure_ascii=False, indent=1))
    print(f"Publicados: {publicados}")


if __name__ == "__main__":
    main()
