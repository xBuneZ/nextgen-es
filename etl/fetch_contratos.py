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
import datetime as dt
import json
import re
import sys
import time
import unicodedata
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path
from xml.etree.ElementTree import iterparse

BASE = "https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3_{}.zip"
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


def process_period(period: str, keep: bool) -> int:
    out = CACHE / f"{period}.jsonl"
    if out.exists():
        return -1
    zpath = CACHE / f"{period}.zip"
    if not zpath.exists():
        print(f"  descargando {period}…", file=sys.stderr)
        if not download(BASE.format(period), zpath):
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
                            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                            n += 1
                        el.clear()
                    elif t == "deleted-entry":
                        f.write(json.dumps({"id": el.get("ref"), "upd": el.get("when"), "deleted": True}) + "\n")
                        el.clear()
    tmp.rename(out)
    if not keep:
        zpath.unlink(missing_ok=True)
    print(f"  {period}: {n} registros PRTR", file=sys.stderr)
    return n


def default_periods() -> list[str]:
    today = dt.date.today()
    years = [str(y) for y in range(2021, today.year)]
    months = [f"{today.year}{m:02d}" for m in range(1, today.month + 1)]
    return years + months


def build() -> None:
    latest: dict[str, dict] = {}
    for f in sorted(CACHE.glob("*.jsonl")):
        for line in open(f):
            r = json.loads(line)
            prev = latest.get(r["id"])
            if prev is None or (r.get("upd") or "") >= (prev.get("upd") or ""):
                latest[r["id"]] = r
    recs = [r for r in latest.values() if not r.get("deleted")]

    contratos = []
    by_adj = {}
    by_org = defaultdict(lambda: {"n": 0, "importe": 0.0})
    by_proc = defaultdict(lambda: {"n": 0, "importe": 0.0})
    flags_count = defaultdict(int)
    tot = {"contratos": 0, "adjudicados": 0, "importe": 0.0, "presupuesto": 0.0}

    for r in recs:
        lotes = [l for l in r["lotes"] if l.get("importe") and l.get("adj")]
        importe = sum(l["importe"] for l in lotes)
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
        for fl in flags:
            flags_count[fl] += 1

        tot["contratos"] += 1
        tot["presupuesto"] += r.get("presupuesto") or 0
        if lotes:
            tot["adjudicados"] += 1
            tot["importe"] += importe
        org = r["organo"] or "?"
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
            "lugar": r["lugar"], "organo": r["organo"], "ambito": ambito, "ruta": " › ".join(r["sup"][1:4]),
            "proc": r["proc"], "estado": r["estado"],
            "presupuesto": r.get("presupuesto") or 0, "importe": round(importe, 2),
            "fecha": max((l["fecha"] for l in lotes if l.get("fecha")), default=""),
            "ofertas": min((l["ofertas"] for l in lotes if l.get("ofertas")), default=None),
            "n_lotes": len(lotes),
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
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "contratos.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    print(f"OK: {tot['contratos']} contratos PRTR, {tot['adjudicados']} adjudicados, {tot['importe']:,.0f} €", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--periods", nargs="*", help="YYYY o YYYYMM (por defecto 2021..hoy)")
    ap.add_argument("--keep-zips", action="store_true")
    ap.add_argument("--refresh-last", type=int, default=2, help="re-procesa los N últimos periodos")
    ap.add_argument("--build-only", action="store_true")
    args = ap.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    if not args.build_only:
        periods = args.periods or default_periods()
        for p in periods[-args.refresh_last:] if args.refresh_last else []:
            (CACHE / f"{p}.jsonl").unlink(missing_ok=True)
        for p in periods:
            process_period(p, args.keep_zips)
    build()


if __name__ == "__main__":
    main()
