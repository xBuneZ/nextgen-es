#!/usr/bin/env python3
"""
Contratos públicos financiados por el Plan de Recuperación (PRTR / MRR).

Fuente: datos abiertos de la Plataforma de Contratación del Sector Público
(PLACSP), ficheros ATOM/CODICE "licitacionesPerfilesContratanteCompleto3".
Se procesa periodo a periodo (año o mes): se descarga el ZIP, se extraen solo
los contratos asociados al PRTR y se borra el ZIP.

Un contrato se considera PRTR si:
  - su FundingProgramCode es "PRTR" (lista de códigos 2.08), o
  - el texto de financiación o el objeto mencionan el Plan de Recuperación,
    PRTR, MRR, Mecanismo de Recuperación o Next Generation (expedientes
    anteriores a la lista de códigos 2.08).

Uso:
    python3 etl/fetch_contratos.py                       # 2021..hoy
    python3 etl/fetch_contratos.py --periods 202610      # un mes (prueba)
    python3 etl/fetch_contratos.py --build-only          # regenera el JSON
"""
from __future__ import annotations

import argparse
import hashlib
import datetime as dt
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path
from xml.etree.ElementTree import iterparse

# Dos conjuntos de datos de la Plataforma de Contratación del Sector Público:
#  - placsp: órganos que publican en la propia Plataforma (Estado, muchas CCAA y entidades locales).
#  - agr: «plataformas agregadas», las CCAA con plataforma propia (Cataluña, Andalucía,
#    País Vasco, Madrid, Galicia, Navarra, La Rioja…), que la Plataforma republica aparte.
FUENTES = {
    "placsp": ("", "https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3_{}.zip"),
    "agr": ("agr-", "https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_1044/PlataformasAgregadasSinMenores_{}.zip"),
}
REGION_HOST = [("contractaciopublica.cat", "Cataluña"), ("gencat.cat", "Cataluña"), ("juntadeandalucia.es", "Andalucía"),
               ("euskadi.eus", "País Vasco"), ("euskadi.net", "País Vasco"), ("comunidad.madrid", "Comunidad de Madrid"), ("madrid.org", "Comunidad de Madrid"),
               ("contratosdegalicia.gal", "Galicia"), ("xunta.gal", "Galicia"), ("xunta.es", "Galicia"), ("navarra.es", "Navarra"), ("larioja.org", "La Rioja"),
               ("gobiernodecanarias.org", "Canarias"), ("carm.es", "Región de Murcia"), ("jcyl.es", "Castilla y León")]
ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "etl" / ".cache" / "contratos"
OUT = ROOT / "site" / "data"
UA = "nextgen-es-transparencia/1.0 (+open data reuse)"
ATOM = "{http://www.w3.org/2005/Atom}"

PROCEDIMIENTOS = {
    "1": "Abierto", "2": "Restringido", "3": "Negociado sin publicidad", "4": "Negociado con publicidad",
    "5": "Diálogo competitivo", "6": "Contrato menor", "7": "Derivado de acuerdo marco", "8": "Concurso de proyectos",
    "9": "Abierto simplificado", "10": "Asociación para la innovación", "11": "Derivado de asociación para la innovación",
    "12": "Basado en sistema dinámico", "13": "Licitación con negociación", "100": "Normas internas", "999": "Otros",
}
TIPOS = {"1": "Suministros", "2": "Servicios", "3": "Obras", "21": "Gestión de servicios públicos",
         "22": "Concesión de servicios", "31": "Concesión de obras públicas", "32": "Concesión de obras",
         "40": "Colaboración público-privada", "7": "Administrativo especial", "8": "Privado", "50": "Patrimonial", "999": "Otros"}
PRTR_TXT = re.compile(r"prtr|plan de recuperacion|mecanismo de recuperacion|\bmrr\b|next ?generation|nextgeneration")


def norm(s: str) -> str:
    return unicodedata.normalize("NFD", (s or "").lower()).encode("ascii", "ignore").decode()


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def kids(el, name):
    return [c for c in el if local(c.tag) == name]


def find(el, *path):
    """Primer descendiente siguiendo nombres locales."""
    cur = [el]
    for p in path:
        nxt = []
        for c in cur:
            nxt.extend(kids(c, p))
        if not nxt:
            return None
        cur = nxt
    return cur[0]


def findall(el, *path):
    cur = [el]
    for p in path:
        nxt = []
        for c in cur:
            nxt.extend(kids(c, p))
        cur = nxt
    return cur


def txt(el, *path):
    e = find(el, *path) if path else el
    return (e.text or "").strip() if e is not None and e.text else ""


def num(s):
    try:
        return round(float(s), 2)
    except (TypeError, ValueError):
        return None


def parse_entry(entry) -> dict | None:
    cfs = None
    for c in entry:
        if local(c.tag) == "ContractFolderStatus":
            cfs = c
            break
    if cfs is None:
        return None
    terms = find(cfs, "TenderingTerms")
    fcodes = [(e.text or "").strip() for e in findall(cfs, "TenderingTerms", "FundingProgramCode")]
    ftext = " ".join((e.text or "") for e in findall(cfs, "TenderingTerms", "FundingProgram"))
    proj = find(cfs, "ProcurementProject")
    objeto = txt(proj, "Name") if proj is not None else ""
    title = next((c.text or "" for c in entry if local(c.tag) == "title"), "")
    is_prtr = "PRTR" in fcodes or bool(PRTR_TXT.search(norm(ftext + " " + objeto + " " + title)))
    if not is_prtr:
        return None

    party = find(cfs, "LocatedContractingParty", "Party")
    organo = txt(party, "PartyName", "Name") if party is not None else ""
    organo_nif = ""
    if party is not None:
        for pid in findall(party, "PartyIdentification", "ID"):
            if (pid.get("schemeName") or "").upper() == "NIF":
                organo_nif = (pid.text or "").strip()
    # Cadena de órganos superiores (ministerio, comunidad…)
    sup, p = [], find(cfs, "LocatedContractingParty", "ParentLocatedParty")
    while p is not None and len(sup) < 6:
        n = txt(p, "PartyName", "Name")
        if n:
            sup.append(n)
        p = find(p, "ParentLocatedParty")

    proc = find(cfs, "TenderingProcess")
    # Fecha de la primera publicación del anuncio de licitación y si salió en el DOUE
    pubs, doue = [], False
    for vni in findall(cfs, "ValidNoticeInfo"):
        if txt(vni, "NoticeTypeCode") != "DOC_CN":
            continue
        for aps in findall(vni, "AdditionalPublicationStatus"):
            if txt(aps, "PublicationMediaName").upper() == "DOUE":
                doue = True
            pubs += [d for d in (txt(r, "IssueDate") for r in findall(aps, "AdditionalPublicationDocumentReference")) if d]
    lotes = []
    for tr in findall(cfs, "TenderResult"):
        w = find(tr, "WinningParty")
        lotes.append({
            "res": txt(tr, "ResultCode"),
            "fecha": txt(tr, "AwardDate"),
            "ofertas": int(txt(tr, "ReceivedTenderQuantity") or 0) or None,
            "nif": txt(w, "PartyIdentification", "ID") if w is not None else "",
            "adj": txt(w, "PartyName", "Name") if w is not None else "",
            "importe": num(txt(tr, "AwardedTenderedProject", "LegalMonetaryTotal", "TaxExclusiveAmount")),
            "lote": txt(tr, "AwardedTenderedProject", "ProcurementProjectLotID"),
            "pyme": txt(tr, "SMEAwardedIndicator") == "true",
        })

    link = next((c.get("href") for c in entry if local(c.tag) == "link"), "")
    return {
        "id": next((c.text for c in entry if local(c.tag) == "id"), ""),
        "upd": next((c.text for c in entry if local(c.tag) == "updated"), ""),
        "url": link,
        "exp": txt(cfs, "ContractFolderID"),
        "estado": txt(cfs, "ContractFolderStatusCode"),
        "objeto": objeto or title,
        "tipo": TIPOS.get(txt(proj, "TypeCode") if proj is not None else "", ""),
        "cpv": txt(proj, "RequiredCommodityClassification", "ItemClassificationCode") if proj is not None else "",
        "lugar": txt(proj, "RealizedLocation", "CountrySubentity") if proj is not None else "",
        "presupuesto": num(txt(proj, "BudgetAmount", "TaxExclusiveAmount")) if proj is not None else None,
        "organo": organo, "organo_nif": organo_nif,
        "sup": [x for x in sup[::-1] if x.lower() != "sector público"],
        "proc": PROCEDIMIENTOS.get(txt(proc, "ProcedureCode") if proc is not None else "", ""),
        "urg": txt(proc, "UrgencyCode") if proc is not None else "",
        "pub": min(pubs)[:10] if pubs else "",
        "plazo_fin": txt(proc, "TenderSubmissionDeadlinePeriod", "EndDate")[:10] if proc is not None else "",
        "doue": doue,
        "fcode": "PRTR" if "PRTR" in fcodes else (fcodes[0] if fcodes else ""),
        "lotes": lotes,
    }


def download(url: str, dest: Path, retries: int = 4) -> bool:
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=300) as r, open(dest, "wb") as f:
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk)
            return zipfile.is_zipfile(dest)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return False
            err = e
        except Exception as e:  # noqa: BLE001
            err = e
        print(f"    reintento {attempt + 1}: {err}", file=sys.stderr)
        time.sleep(5 * 2 ** attempt)
    return False


def process_period(period: str, keep: bool, fuente: str = "placsp") -> int:
    pref, base = FUENTES[fuente]
    out = CACHE / f"{pref}{period}.jsonl"
    if out.exists():
        return -1
    zpath = CACHE / f"{pref}{period}.zip"
    if not zpath.exists():
        print(f"  descargando {pref}{period}…", file=sys.stderr)
        if not download(base.format(period), zpath):
            zpath.unlink(missing_ok=True)
            print(f"  {period}: no disponible", file=sys.stderr)
            return 0
    n = 0
    tmp = out.with_suffix(".tmp")
    with zipfile.ZipFile(zpath) as z, open(tmp, "w") as f:
        for name in z.namelist():
            if not name.endswith(".atom"):
                continue
            with z.open(name) as fh:
                for ev, el in iterparse(fh, events=("end",)):
                    t = local(el.tag)
                    if t == "entry":
                        rec = parse_entry(el)
                        if rec:
                            rec["fuente"] = fuente
                            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                            n += 1
                        el.clear()
                    elif t == "deleted-entry":
                        f.write(json.dumps({"id": el.get("ref"), "upd": el.get("when"), "deleted": True}) + "\n")
                        el.clear()
    tmp.rename(out)
    if not keep:
        zpath.unlink(missing_ok=True)
    print(f"  {pref}{period}: {n} registros PRTR", file=sys.stderr)
    return n


def month_range(start: str, end: str) -> list[str]:
    y, m = int(start[:4]), int(start[4:6])
    out = []
    while f"{y}{m:02d}" <= end:
        out.append(f"{y}{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def default_periods() -> list[str]:
    today = dt.date.today()
    return month_range("202101", f"{today.year}{today.month:02d}")


def comprobar(fuentes: list[str], n_contratos: int, force: bool) -> None:
    """Evita publicar datos incompletos: todos los meses cerrados deben estar procesados
    y el número de contratos no puede caer más de un 5 % respecto a lo publicado."""
    errores = []
    hoy = dt.date.today()
    ultimo = (hoy.replace(day=1) - dt.timedelta(days=1)).strftime("%Y%m")
    for f in fuentes:
        pref = FUENTES[f][0]
        falta = [m for m in month_range("202101", ultimo) if not (CACHE / f"{pref}{m}.jsonl").exists()]
        if falta:
            errores.append(f"faltan {len(falta)} meses de «{f}»: {', '.join(falta[:8])}{'…' if len(falta) > 8 else ''}")
    prev = DIR / "indice.json"
    if prev.exists():
        antes = json.loads(prev.read_text())["totales"]["contratos"]
        if n_contratos < antes * 0.95:
            errores.append(f"el número de contratos cae de {antes} a {n_contratos} (más de un 5 %)")
    if errores:
        msg = "Datos incompletos, NO se publican:\n  - " + "\n  - ".join(errores)
        if force:
            print("AVISO (se fuerza la publicación): " + msg, file=sys.stderr)
        else:
            sys.exit(msg + "\nUsa --force para publicar igualmente.")


def region_de(url: str) -> str:
    return next((r for h, r in REGION_HOST if h in (url or "")), "Otra plataforma autonómica")


def build(fuentes: list[str] | None = None, force: bool = False) -> None:
    latest: dict[str, dict] = {}
    for f in sorted(CACHE.glob("*.jsonl")):
        for line in open(f):
            r = json.loads(line)
            prev = latest.get(r["id"])
            if prev is None or (r.get("upd") or "") >= (prev.get("upd") or ""):
                latest[r["id"]] = r
    recs = [r for r in latest.values() if not r.get("deleted")]
    comprobar(fuentes or list(FUENTES), len(recs), force)

    contratos = []
    by_adj = {}
    by_org = defaultdict(lambda: {"n": 0, "importe": 0.0})
    by_proc = defaultdict(lambda: {"n": 0, "importe": 0.0})
    flags_count = defaultdict(int)
    tot = {"contratos": 0, "adjudicados": 0, "importe": 0.0, "presupuesto": 0.0}

    # Ganador recurrente sin competencia: misma empresa, mismo órgano, >=3 contratos
    # que por sí mismos no tuvieron competencia (un solo licitador en un procedimiento
    # competitivo, o negociado sin publicidad). No cuentan los derivados de acuerdos
    # marco (la competencia se hizo al seleccionar proveedores) ni los contratos con
    # más de dos adjudicatarios.
    SIN_LICITACION_PROPIA = ("Negociado sin publicidad", "Derivado de acuerdo marco", "Contrato menor")

    def sin_competencia(r) -> bool:
        lot = [l for l in r["lotes"] if l.get("importe") and l.get("adj")]
        if not lot or len({(l.get("nif") or l["adj"]).upper() for l in lot}) > 2:
            return False
        if r["proc"] == "Negociado sin publicidad":
            return True
        return r["proc"] not in SIN_LICITACION_PROPIA and all(l.get("ofertas") == 1 for l in lot)

    nocomp = defaultdict(set)
    for r in recs:
        if sin_competencia(r):
            for l in r["lotes"]:
                if l.get("importe") and l.get("adj"):
                    nocomp[(r["organo"], (l.get("nif") or l["adj"]).upper())].add(r["id"])
    recurrentes = {k: len(v) for k, v in nocomp.items() if len(v) >= 3}

    def plazo_dias(r):
        try:
            return (dt.date.fromisoformat(r.get("plazo_fin", "")) - dt.date.fromisoformat(r.get("pub", ""))).days
        except ValueError:
            return None

    for r in recs:
        lotes = [dict(l) for l in r["lotes"] if l.get("importe") and l.get("adj")]
        importe = sum(l["importe"] for l in lotes)
        # Acuerdos marco con varios lotes o adjudicatarios: la Plataforma suele registrar a cada
        # adjudicatario con el valor máximo del acuerdo, y sumarlos multiplica el importe. Si la suma
        # supera el presupuesto, el contrato computa por su presupuesto y los lotes se escalan.
        ajustado = None
        pres = r.get("presupuesto") or 0
        if pres and importe > pres * 1.1 and (len(lotes) > 1 or len({l.get("nif") or l["adj"] for l in lotes}) > 1):
            ajustado = round(importe, 2)
            f = pres / importe
            for l in lotes:
                l["importe"] = round(l["importe"] * f, 2)
            importe = pres
        flags = []
        if r["proc"] == "Negociado sin publicidad":
            flags.append("negociado_sin_publicidad")
        if r["urg"] == "3":
            flags.append("emergencia")
        if lotes and r["proc"] not in ("Negociado sin publicidad", "Derivado de acuerdo marco", "Contrato menor") \
                and all(l.get("ofertas") == 1 for l in lotes):
            flags.append("licitador_unico")
        if r.get("presupuesto") and importe > r["presupuesto"] * 1.1:
            flags.append("supera_presupuesto")
        if lotes and r.get("presupuesto") and len(lotes) == 1 and lotes[0].get("ofertas") == 1 \
                and importe >= r["presupuesto"] * 0.995:
            flags.append("sin_baja")
        plazo = plazo_dias(r)
        if plazo is not None and 0 <= plazo < 20 and (r.get("presupuesto") or 0) >= 1_000_000 \
                and r["proc"] not in ("Negociado sin publicidad", "Derivado de acuerdo marco", "Contrato menor"):
            flags.append("plazo_corto")
        rec_n = max((recurrentes.get((r["organo"], (l.get("nif") or l["adj"]).upper()), 0) for l in lotes), default=0) \
            if sin_competencia(r) else 0
        if rec_n:
            flags.append("ganador_recurrente")
        for fl in flags:
            flags_count[fl] += 1

        tot["contratos"] += 1
        tot["presupuesto"] += r.get("presupuesto") or 0
        if lotes:
            tot["adjudicados"] += 1
            tot["importe"] += importe
        org = r["organo"] or "?"
        if r.get("fuente") == "agr":
            ambito = "PLATAFORMAS AUTONÓMICAS PROPIAS"
            r["sup"] = [ambito, region_de(r.get("url"))] + [x for x in r["sup"] if x]
        else:
            ambito = r["sup"][0] if r["sup"] else ""
        by_org[org]["n"] += 1
        by_org[org]["importe"] += importe
        by_proc[r["proc"] or "?"]["n"] += 1
        by_proc[r["proc"] or "?"]["importe"] += importe
        for l in lotes:
            key = (l["nif"] or l["adj"]).upper()
            a = by_adj.setdefault(key, {"nif": l["nif"], "nombre": l["adj"], "importe": 0.0, "n": 0, "unico": 0})
            a["importe"] += l["importe"]
            a["n"] += 1
            a["unico"] += 1 if l.get("ofertas") == 1 else 0

        adjs = {}
        for l in lotes:
            k = (l["nif"] or l["adj"]).upper()
            adjs.setdefault(k, {"nombre": l["adj"], "nif": l["nif"], "importe": 0.0})["importe"] += l["importe"]
        contratos.append({
            "exp": r["exp"], "url": r["url"], "objeto": r["objeto"][:300], "tipo": r["tipo"], "cpv": r["cpv"],
            "lugar": r["lugar"], "organo": r["organo"], "organo_nif": (r.get("organo_nif") or "").upper(), "ambito": ambito, "ruta": " › ".join(r["sup"][1:4]),
            "proc": r["proc"], "estado": r["estado"],
            "presupuesto": r.get("presupuesto") or 0, "importe": round(importe, 2),
            "fecha": max((l["fecha"] for l in lotes if l.get("fecha")), default=""),
            "ofertas": min((l["ofertas"] for l in lotes if l.get("ofertas")), default=None),
            "n_lotes": len(lotes),
            "importe_publicado": ajustado,
            "pub": r.get("pub", ""), "plazo": plazo, "doue": r.get("doue", False), "recurrente": rec_n or None,
            "adj": sorted(({**v, "importe": round(v["importe"], 2)} for v in adjs.values()), key=lambda x: -x["importe"])[:10],
            "flags": flags,
        })

    contratos.sort(key=lambda c: -c["importe"])
    r2 = lambda x: round(x, 2)
    ranked = lambda d, n=None: sorted(({"nombre": k, "n": v["n"], "importe": r2(v["importe"])} for k, v in d.items()),
                                      key=lambda x: -x["importe"])[:n]
    adj_out = sorted(by_adj.values(), key=lambda a: -a["importe"])[:3000]
    for a in adj_out:
        a["importe"] = r2(a["importe"])
    out = {
        "generado": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "fuente": "Plataforma de Contratación del Sector Público — datos abiertos (FundingProgramCode PRTR y menciones al Plan)",
        "totales": {k: (r2(v) if isinstance(v, float) else v) for k, v in tot.items()},
        "indicadores": dict(flags_count),
        "por_organo": ranked(by_org, 40),
        "por_procedimiento": ranked(by_proc),
        "adjudicatarios": adj_out,
        "contratos": contratos,
    }
    write_split(out)
    print(f"OK: {tot['contratos']} contratos PRTR, {tot['adjudicados']} adjudicados, {tot['importe']:,.0f} €", file=sys.stderr)


# ---------- Salida para la web: índice ligero + detalle en trozos ----------
CFLAGS = ["licitador_unico", "sin_baja", "ganador_recurrente", "plazo_corto",
          "negociado_sin_publicidad", "emergencia", "supera_presupuesto"]
N_TROZOS = 64
DIR = OUT / "contratos"


def cid_de(c: dict) -> str:
    if c.get("cid"):
        return c["cid"]
    m = re.search(r"idEvl=([^&]+)", c.get("url") or "")
    if m:
        return urllib.parse.unquote(m.group(1))
    base = c.get("url") or (c.get("exp") or "") + "|" + (c.get("organo") or "")
    return "a" + hashlib.sha1(base.encode()).hexdigest()[:16]


def trozo(cid: str) -> int:
    """FNV-1a de 32 bits (igual que en site/app.js) módulo N_TROZOS."""
    h = 0x811C9DC5
    for ch in cid:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h % N_TROZOS


# Medios propios (TRAGSA, INECO, ISDEFE…): hacen encargos para la Administración y compran
# mucho material a proveedores locales; su comportamiento no es comparable al de un ministerio
# o un ayuntamiento, así que el ranking los muestra aparte.
MEDIO_PROPIO = re.compile(r"\bM\.\s?P\.|medio propio|\bTRAGSA|TRAGSATEC", re.I)
NOCOMP = ("licitador_unico", "negociado_sin_publicidad", "emergencia")
PERSONA = re.compile(r"^[0-9XYZKLM]\d{7}[A-Z]$")


def portada(contratos: list[dict]) -> dict:
    """Casos destacados del último año y los organismos con más importe sin competencia."""
    desde = (dt.date.today() - dt.timedelta(days=365)).isoformat()
    fuertes = ("sin_baja", "negociado_sin_publicidad", "plazo_corto", "ganador_recurrente")
    dest = sorted((c for c in contratos if (c.get("fecha") or "") >= desde and c["importe"] >= 1_000_000
                   and any(f in c["flags"] for f in fuertes) and c.get("adj")), key=lambda c: -c["importe"])[:6]
    g, imp, imp_no = {}, 0.0, 0.0
    for c in contratos:
        if not c["importe"] or MEDIO_PROPIO.search(c.get("organo") or ""):
            continue
        no = any(f in c["flags"] for f in NOCOMP)
        a = g.setdefault(c["organo"], {"organo": c["organo"], "ambito": c.get("ambito", ""), "n": 0, "importe": 0.0, "sin_comp": 0.0})
        a["n"] += 1
        a["importe"] += c["importe"]
        a["sin_comp"] += c["importe"] if no else 0
        imp += c["importe"]
        imp_no += c["importe"] if no else 0
    rk = [a for a in g.values() if a["n"] >= 20]
    for a in rk:
        a["pct"] = round(a["sin_comp"] / a["importe"], 4) if a["importe"] else 0
    rk.sort(key=lambda a: (-a["pct"], -a["importe"]))
    return {
        "destacados": [{"cid": cid_de(c), "objeto": re.sub(r"\s+", " ", c["objeto"])[:140], "organo": c["organo"],
                        "adj": c["adj"][0]["nombre"], "importe": round(c["importe"]), "fecha": c.get("fecha"), "flags": c["flags"]}
                       for c in dest],
        "ranking_top": [{k: (round(v) if k in ("importe", "sin_comp") else v) for k, v in a.items()} for a in rk[:6]],
        "media_sin_comp": round(imp_no / imp, 4) if imp else 0,
    }


def empresas(contratos: list[dict]) -> list:
    """Todos los adjudicatarios agregados (sin personas físicas): [nif, nombre, contratos, importe,
    contratos sin competencia, importe sin competencia, [organismos principales]]."""
    agg = {}
    for c in contratos:
        no = any(f in c["flags"] for f in NOCOMP)
        for a in c.get("adj", []):
            nif = (a.get("nif") or "").upper()
            if PERSONA.match(nif):
                continue
            e = agg.setdefault(nif or a["nombre"].upper(), {"nif": nif, "nombre": a["nombre"], "n": 0, "imp": 0.0, "nno": 0, "impno": 0.0, "org": defaultdict(float)})
            e["n"] += 1
            e["imp"] += a.get("importe") or 0
            e["nno"] += no
            e["impno"] += (a.get("importe") or 0) if no else 0
            e["org"][c.get("organo") or ""] += a.get("importe") or 0
    top = sorted(agg.values(), key=lambda e: -e["imp"])  # todas: la lista completa pesa poco
    return [[e["nif"], e["nombre"], e["n"], round(e["imp"]), e["nno"], round(e["impno"]),
             [o for o, _ in sorted(e["org"].items(), key=lambda kv: -kv[1])[:3]]] for e in top]


def write_split(out: dict) -> None:
    """Escribe site/data/contratos/indice.json (lo que necesitan listado, búsqueda
    y ranking, con textos repetidos en diccionarios) y det/NN.json (fichas completas)."""
    dic = {"org": [], "proc": [], "emp": [], "flags": CFLAGS}
    idx = {"org": {}, "proc": {}, "emp": {}}

    def ref(kind, key, value):
        i = idx[kind].get(key)
        if i is None:
            i = idx[kind][key] = len(dic[kind])
            dic[kind].append(value)
        return i

    cols = {k: [] for k in ("id", "exp", "org", "proc", "emp", "imp", "fecha", "of", "fl")}
    textos = []
    trozos = [dict() for _ in range(N_TROZOS)]
    for c in out["contratos"]:
        cid = cid_de(c)
        c = {**c, "cid": cid}
        if "idEvl=" in (c.get("url") or ""):
            c.pop("url", None)  # se reconstruye a partir del cid
        cols["id"].append(cid)
        cols["exp"].append(c.get("exp") or "")
        textos.append(re.sub(r"\s+", " ", c.get("objeto") or "").strip()[:100])
        cols["org"].append(ref("org", c.get("organo") or "", [c.get("organo") or "", c.get("ambito") or "", c.get("ruta") or ""]))
        cols["proc"].append(ref("proc", c.get("proc") or "", c.get("proc") or ""))
        cols["emp"].append([ref("emp", (a.get("nif") or a["nombre"]).upper(), [a["nombre"], a.get("nif") or ""]) for a in c.get("adj", [])])
        cols["imp"].append(round(c.get("importe") or 0))
        cols["fecha"].append(c.get("fecha") or "")
        cols["of"].append(c.get("ofertas"))
        cols["fl"].append(sum(1 << i for i, f in enumerate(CFLAGS) if f in c.get("flags", [])))
        trozos[trozo(cid)][cid] = c

    DIR.mkdir(parents=True, exist_ok=True)
    (DIR / "det").mkdir(exist_ok=True)
    meta = {k: out[k] for k in ("generado", "fuente", "totales", "indicadores", "por_procedimiento")}
    dump = lambda path, obj: path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))
    dump(DIR / "indice.json", {**meta, "n_trozos": N_TROZOS, "dic": dic, "cols": cols})
    dump(DIR / "textos.json", textos)
    dump(DIR / "totales.json", {**meta, **portada(out["contratos"])})  # pequeño: lo usa la portada
    dump(DIR / "empresas.json", empresas(out["contratos"]))  # objeto de cada contrato (mismo orden); solo lo carga el listado
    for i, t in enumerate(trozos):
        dump(DIR / "det" / f"{i:02d}.json", t)
    (OUT / "contratos.json").unlink(missing_ok=True)  # formato antiguo, de un solo fichero


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--periods", nargs="*", help="YYYY o YYYYMM (por defecto 2021..hoy)")
    ap.add_argument("--keep-zips", action="store_true")
    ap.add_argument("--refresh-last", type=int, default=2, help="re-procesa los N últimos periodos")
    ap.add_argument("--build-only", action="store_true")
    ap.add_argument("--fuentes", nargs="*", default=list(FUENTES), choices=list(FUENTES), help="conjuntos de datos a procesar")
    ap.add_argument("--force", action="store_true", help="publica aunque falten meses o caigan los datos")
    ap.add_argument("--split-from", help="convierte un contratos.json antiguo al formato en trozos y sale")
    ap.add_argument("--no-build", action="store_true", help="solo descarga y extrae (para trabajos en paralelo)")
    ap.add_argument("--list-months", nargs=2, metavar=("DESDE", "HASTA"), help="imprime los meses como JSON y sale")
    args = ap.parse_args()
    if args.split_from:
        write_split(json.loads(Path(args.split_from).read_text()))
        return
    if args.list_months:
        print(json.dumps(month_range(*args.list_months)))
        return
    CACHE.mkdir(parents=True, exist_ok=True)
    if not args.build_only:
        periods = args.periods or default_periods()
        for f in args.fuentes:
            for p in periods[-args.refresh_last:] if args.refresh_last else []:
                (CACHE / f"{FUENTES[f][0]}{p}.jsonl").unlink(missing_ok=True)
            for p in periods:
                process_period(p, args.keep_zips, f)
    if not args.no_build:
        build(list(FUENTES), args.force)


if __name__ == "__main__":
    main()
