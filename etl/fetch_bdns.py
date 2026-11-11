#!/usr/bin/env python3
"""
Descarga de la BDNS (Sistema Nacional de Publicidad de Subvenciones y Ayudas
Públicas, infosubvenciones.es) todas las convocatorias marcadas como
financiadas por el MRR (Mecanismo de Recuperación y Resiliencia, "Next
Generation EU") y sus concesiones, y genera los JSON que consume la web.

Solo usa la biblioteca estándar de Python (>= 3.9).

Uso:
    python3 etl/fetch_bdns.py                 # descarga completa
    python3 etl/fetch_bdns.py --limit 200     # prueba rápida
    python3 etl/fetch_bdns.py --workers 8

Privacidad: las concesiones a personas físicas NO se publican de forma
individual; solo se agregan (número e importe) por convocatoria.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.parse
import unicodedata
import urllib.request
from collections import defaultdict
from pathlib import Path

API = "https://www.infosubvenciones.es/bdnstrans/api"
FICHA_CONV = "https://www.infosubvenciones.es/bdnstrans/GE/es/convocatorias/{}"
ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "etl" / ".cache"
OUT = ROOT / "site" / "data"
UA = "nextgen-es-transparencia/1.0 (+open data reuse)"

# NIF de persona jurídica: letra inicial de entidad (no DNI/NIE).
NIF_ENTIDAD = re.compile(r"^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$")


def get(path: str, params: dict | None = None, retries: int = 5) -> dict:
    url = f"{API}/{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    delay = 2.0
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            if attempt == retries - 1:
                raise RuntimeError(f"{url}: {e}") from e
            time.sleep(delay)
            delay *= 2
    raise AssertionError


def list_convocatorias(limit: int | None) -> list[dict]:
    out, page = [], 0
    while True:
        d = get("convocatorias/busqueda", {"page": page, "pageSize": 1000, "mrr": "true"})
        out.extend(c for c in d["content"] if c.get("mrr"))
        print(f"  convocatorias: página {page + 1}/{d['totalPages']} ({len(out)})", file=sys.stderr)
        if d["last"] or (limit and len(out) >= limit):
            break
        page += 1
    return out[:limit] if limit else out


def parse_beneficiario(raw: str) -> tuple[str | None, str, bool]:
    """Devuelve (nif, nombre, es_persona_fisica)."""
    raw = (raw or "").strip()
    if raw.startswith("*"):
        return None, "", True
    parts = raw.split(" ", 1)
    nif = parts[0].upper()
    name = parts[1].strip() if len(parts) > 1 else raw
    if NIF_ENTIDAD.match(nif):
        return nif, name, False
    # DNI / NIE o formato desconocido -> tratamos como persona física
    if re.match(r"^[XYZ0-9KLM]\d{7}[A-Z]$", nif):
        return None, "", True
    # Entidades extranjeras u otros formatos: se conservan con el texto completo
    return None, raw, False


def fetch_one(conv: dict, refresh: bool) -> dict:
    num = conv["numeroConvocatoria"]
    cache_file = CACHE / f"{num}.json"
    if cache_file.exists() and not refresh:
        return json.loads(cache_file.read_text())

    det = get("convocatorias", {"numConv": num})
    concesiones, page = [], 0
    while True:
        d = get("concesiones/busqueda", {"page": page, "pageSize": 1000, "numeroConvocatoria": num})
        for c in d["content"]:
            if str(c.get("numeroConvocatoria")) != str(num):
                continue
            concesiones.append({
                "b": c.get("beneficiario"),
                "i": c.get("importe") or 0,
                "f": c.get("fechaConcesion"),
                "inst": (c.get("instrumento") or "").strip(),
            })
        if d["last"] or not d["content"]:
            break
        page += 1

    rec = {"conv": conv, "det": det, "concesiones": concesiones}
    cache_file.write_text(json.dumps(rec, ensure_ascii=False))
    return rec


def instrumento_grupo(inst: str | None) -> str:
    i = (inst or "").upper()
    if "GARANT" in i or "AVAL" in i:
        return "garantia"
    if "PRÉSTAMO" in i or "PRESTAMO" in i or "ANTICIPO" in i:
        return "prestamo"
    if "SUBVENCI" in i or "DINERARIA" in i:
        return "subvencion"
    return "otro"


def r2(x: float) -> float:
    return round(float(x or 0), 2)


# ---------- Índice de búsqueda de TODOS los beneficiarios (no solo los 5.000 mayores) ----------
# Se reparte en trozos pequeños para que la web solo descargue el que necesita:
#   benef_idx/w_XX.json  entidades con alguna palabra del nombre que empieza por XX
#   benef_idx/n_XX.json  entidades cuyo NIF tiene XX en las posiciones 2 y 3
# Fila: [nif, nombre, importe, nº convocatorias, [[convocatoria, importe], …10 mayores]]
PALABRAS_VACIAS = {"sl", "sa", "slu", "sau", "sll", "slne", "scoop", "coop", "sccl", "cb", "sc", "de", "del", "la", "las",
                   "los", "el", "y", "e", "i", "en", "para", "por", "sociedad", "limitada", "anonima", "unipersonal",
                   "cooperativa", "laboral", "profesional", "and", "the", "of"}


def palabras_indice(nombre: str) -> set[str]:
    n = unicodedata.normalize("NFD", (nombre or "").lower()).encode("ascii", "ignore").decode()
    return {w for w in re.split(r"[^a-z0-9]+", n) if len(w) >= 3 and w not in PALABRAS_VACIAS}


def indice_beneficiarios(entidades, max_bytes: int = 250_000) -> None:
    """Trozos por prefijo de palabra (2 letras; los que pasan de max_bytes se subdividen
    a 3, 4 o 5 letras) y por NIF. indice.json lista los prefijos para que la web sepa
    qué trozo pedir."""
    import shutil
    filas, palabras = [], []
    for b in entidades:
        convs = sorted(b["convs"].items(), key=lambda kv: -kv[1])
        filas.append([b["nif"] or "", b["nombre"], round(b["importe"]), len(convs), [[k, round(v)] for k, v in convs[:10]]])
        palabras.append(palabras_indice(b["nombre"]))
    tam = [len(json.dumps(f, ensure_ascii=False)) for f in filas]

    def reparte(ids, n):
        g = defaultdict(set)
        for i in ids:
            for w in palabras[i]:
                if len(w) >= n:
                    g[w[:n]].add(i)
        return g

    finales = {}
    pendientes = reparte(range(len(filas)), 2)
    while pendientes:
        k, ids = pendientes.popitem()
        if len(k) < 5 and sum(tam[i] for i in ids) > max_bytes:
            sub = {kk: v for kk, v in reparte(ids, len(k) + 1).items() if kk.startswith(k)}
            # las palabras que acaban justo en el prefijo se quedan en el trozo corto
            resto = {i for i in ids if any(w == k for w in palabras[i])}
            if resto:
                finales[k] = resto
            pendientes.update(sub)
        else:
            finales[k] = ids
    d = OUT / "benef_idx"
    shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True)
    dump = lambda path, obj: path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))
    for k, ids in finales.items():
        dump(d / f"w_{k}.json", sorted((filas[i] for i in ids), key=lambda f: -f[2]))
    por_nif = defaultdict(list)
    for f in filas:
        if len(f[0]) >= 3:
            por_nif[f[0][1:3].lower()].append(f)
    for k, fs in por_nif.items():
        dump(d / f"n_{k}.json", sorted(fs, key=lambda f: -f[2]))
    dump(d / "indice.json", {"w": sorted(finales), "n": sorted(por_nif), "total": len(filas)})
    print(f"  índice de beneficiarios: {len(filas)} entidades en {len(finales) + len(por_nif)} trozos", file=sys.stderr)


def build(records: list[dict], force: bool = False) -> None:
    today = dt.date.today()
    convs_out = []
    benef = {}  # key -> dict
    by_admin = defaultdict(lambda: {"n": 0, "importe": 0.0})
    by_org = defaultdict(lambda: {"n": 0, "importe": 0.0, "nivel1": ""})
    by_year = defaultdict(lambda: {"n": 0, "importe": 0.0})
    by_finalidad = defaultdict(lambda: {"n": 0, "importe": 0.0})
    flags_count = defaultdict(int)
    by_instr = defaultdict(lambda: {"n": 0, "importe": 0.0})
    by_tipo_benef = defaultdict(lambda: {"n": 0, "importe": 0.0})
    # Desglose sin doble cómputo: lo que llega a empresas, entidades y personas como
    # subvención a fondo perdido, separado de las transferencias a administraciones
    # (que a menudo lo vuelven a repartir en sus propias convocatorias) y de avales y préstamos.
    desglose = defaultdict(float)
    tot = {"convocatorias": 0, "concesiones": 0, "importe": 0.0,
           "personas_fisicas_n": 0, "personas_fisicas_importe": 0.0, "presupuesto": 0.0}

    for rec in records:
        conv, det, concs = rec["conv"], rec["det"] or {}, rec["concesiones"]
        num = conv["numeroConvocatoria"]
        org = det.get("organo") or {}
        n1 = org.get("nivel1") or conv.get("nivel1") or ""
        n2 = org.get("nivel2") or conv.get("nivel2") or ""
        n3 = org.get("nivel3") or conv.get("nivel3") or ""
        tipo = det.get("tipoConvocatoria") or ""
        presupuesto = r2(det.get("presupuestoTotal"))
        fecha = conv.get("fechaRecepcion") or ""

        importe = 0.0
        pf_n, pf_imp = 0, 0.0
        per_benef = defaultdict(lambda: {"nombre": "", "nif": None, "importe": 0.0, "n": 0})
        for c in concs:
            imp = float(c["i"] or 0)
            importe += imp
            nif, name, is_pf = parse_beneficiario(c["b"])
            ins = instrumento_grupo(c.get("inst"))
            by_instr[ins]["n"] += 1
            by_instr[ins]["importe"] += imp
            tb = "pf" if is_pf else ("publico" if nif and nif[0] in "PQS" else "privado")
            by_tipo_benef[tb]["n"] += 1
            by_tipo_benef[tb]["importe"] += imp
            if tb == "publico":
                desglose["a_administraciones"] += imp
            elif ins == "subvencion":
                desglose["fondo_perdido_" + tb] += imp
            else:
                desglose[ins if ins in ("garantia", "prestamo") else "otros"] += imp
            if is_pf:
                pf_n += 1
                pf_imp += imp
                continue
            key = nif or name
            pb = per_benef[key]
            pb["nombre"], pb["nif"] = name, nif
            pb["importe"] += imp
            pb["n"] += 1

        top = sorted(per_benef.values(), key=lambda x: -x["importe"])
        n_benef = len(per_benef) + (1 if pf_n else 0)

        # --- Indicadores objetivos (NO implican irregularidad) ---
        flags = []
        tl = tipo.lower()
        if "nominativa" in tl or "nominativa" in (conv.get("descripcion") or "").lower():
            flags.append("nominativa")
        elif "directa" in tl:
            flags.append("concesion_directa")
        if importe > 0 and top and len(per_benef) + pf_n >= 3 and top[0]["importe"] / importe >= 0.5:
            flags.append("concentracion")
        if top and top[0]["importe"] >= 1_000_000 and len(per_benef) + pf_n == 1:
            flags.append("beneficiario_unico_1m")
        if presupuesto > 0 and importe > presupuesto * 1.1:
            flags.append("supera_presupuesto")
        try:
            age_days = (today - dt.date.fromisoformat(fecha)).days
        except ValueError:
            age_days = 0
        if not concs and presupuesto >= 100_000 and age_days > 540:
            flags.append("sin_concesiones")
        for f in flags:
            flags_count[f] += 1

        convs_out.append({
            "id": num,
            "titulo": (conv.get("descripcion") or "").strip(),
            "fecha": fecha,
            "nivel1": n1, "nivel2": n2, "nivel3": n3,
            "tipo": tipo,
            "presupuesto": presupuesto,
            "importe": r2(importe),
            "n_concesiones": len(concs),
            "n_beneficiarios": n_benef,
            "pf_n": pf_n, "pf_importe": r2(pf_imp),
            "finalidad": det.get("descripcionFinalidad") or "",
            "instrumentos": [i.get("descripcion", "").strip() for i in det.get("instrumentos") or []],
            "sectores": [s.get("descripcion", "") for s in det.get("sectores") or []][:5],
            "regiones": [r.get("descripcion", "").strip() for r in det.get("regiones") or []][:5],
            "bases_url": det.get("urlBasesReguladoras") or "",
            "top": [{"nombre": b["nombre"], "nif": b["nif"], "importe": r2(b["importe"]), "n": b["n"]} for b in top[:25]],
            "flags": flags,
        })

        for b in per_benef.values():
            key = b["nif"] or b["nombre"]
            g = benef.setdefault(key, {"nif": b["nif"], "nombre": b["nombre"], "importe": 0.0, "n": 0, "convs": {}})
            g["importe"] += b["importe"]
            g["n"] += b["n"]
            g["convs"][num] = g["convs"].get(num, 0) + b["importe"]

        tot["convocatorias"] += 1
        tot["concesiones"] += len(concs)
        tot["importe"] += importe
        tot["presupuesto"] += presupuesto
        tot["personas_fisicas_n"] += pf_n
        tot["personas_fisicas_importe"] += pf_imp
        by_admin[n1]["n"] += 1
        by_admin[n1]["importe"] += importe
        by_org[n2]["n"] += 1
        by_org[n2]["importe"] += importe
        by_org[n2]["nivel1"] = n1
        y = fecha[:4] or "?"
        by_year[y]["n"] += 1
        by_year[y]["importe"] += importe
        fin = det.get("descripcionFinalidad") or "Sin especificar"
        by_finalidad[fin]["n"] += 1
        by_finalidad[fin]["importe"] += importe

    convs_out.sort(key=lambda c: -c["importe"])
    indice_beneficiarios(benef.values())
    benef_out = sorted(benef.values(), key=lambda b: -b["importe"])[:5000]
    for b in benef_out:
        b["importe"] = r2(b["importe"])
        b["n_convs"] = len(b["convs"])
        b["convs"] = [[k, r2(v)] for k, v in sorted(b["convs"].items(), key=lambda kv: -kv[1])[:30]]

    def ranked(d, n=None):
        items = [{"nombre": k, **{kk: (r2(vv) if kk == "importe" else vv) for kk, vv in v.items()}} for k, v in d.items()]
        items.sort(key=lambda x: -x["importe"])
        return items[:n] if n else items

    resumen = {
        "generado": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "fuente": "BDNS / SNPSAP — infosubvenciones.es (convocatorias con mrr=true)",
        "totales": {k: (r2(v) if isinstance(v, float) else v) for k, v in tot.items()},
        "por_administracion": ranked(by_admin),
        "por_organo": ranked(by_org, 40),
        "por_anio": sorted(ranked(by_year), key=lambda x: x["nombre"]),
        "por_finalidad": ranked(by_finalidad, 20),
        "indicadores": dict(flags_count),
        "por_instrumento": ranked(by_instr),
        "por_tipo_beneficiario": ranked(by_tipo_benef),
        "desglose": {k: r2(v) for k, v in desglose.items()},
    }

    # No publicar datos que han encogido de forma anormal (descarga incompleta o fallo de la fuente)
    prev = OUT / "resumen.json"
    if prev.exists():
        antes = json.loads(prev.read_text())["totales"]
        caidas = [k for k in ("convocatorias", "concesiones") if tot[k] < antes.get(k, 0) * 0.95]
        if caidas:
            msg = "Datos incompletos, NO se publican: " + ", ".join(f"{k} cae de {antes[k]} a {tot[k]}" for k in caidas)
            if not force:
                sys.exit(msg + ". Usa --force para publicar igualmente.")
            print("AVISO (se fuerza la publicación): " + msg, file=sys.stderr)

    OUT.mkdir(parents=True, exist_ok=True)
    dump = lambda name, obj: (OUT / name).write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))
    # Listado ligero: 5 mayores beneficiarios por convocatoria. La lista completa
    # (25) va en trozos que la web carga al abrir la ficha: convocatorias/det/NN.json
    N = 16
    trozos = [dict() for _ in range(N)]
    for c in convs_out:
        if len(c["top"]) > 5:
            trozos[int(c["id"]) % N if str(c["id"]).isdigit() else 0][str(c["id"])] = c["top"]
            c["top"] = c["top"][:5]
            c["top_mas"] = True
    dump("convocatorias.json", convs_out)
    (OUT / "convocatorias" / "det").mkdir(parents=True, exist_ok=True)
    for i, t in enumerate(trozos):
        dump(f"convocatorias/det/{i:02d}.json", t)
    dump("beneficiarios.json", benef_out)
    dump("resumen.json", resumen)
    print(f"OK: {tot['convocatorias']} convocatorias, {tot['concesiones']} concesiones, "
          f"{tot['importe']:,.0f} € concedidos", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--refresh", action="store_true", help="ignora la caché local")
    ap.add_argument("--build-only", action="store_true", help="regenera los JSON desde la caché")
    ap.add_argument("--force", action="store_true", help="publica aunque los datos caigan más de un 5 %%")
    ap.add_argument("--refresh-days", type=int, default=120,
                    help="re-descarga convocatorias publicadas en los últimos N días")
    args = ap.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)

    if args.build_only:
        build([json.loads(f.read_text()) for f in sorted(CACHE.glob("*.json"))], args.force)
        return
    print("Listando convocatorias MRR…", file=sys.stderr)
    convs = list_convocatorias(args.limit)
    cutoff = (dt.date.today() - dt.timedelta(days=args.refresh_days)).isoformat()

    records, errors = [], 0
    with cf.ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(fetch_one, c, args.refresh or (c.get("fechaRecepcion") or "") >= cutoff): c for c in convs}
        for i, fut in enumerate(cf.as_completed(futs), 1):
            try:
                records.append(fut.result())
            except Exception as e:  # noqa: BLE001
                errors += 1
                print(f"  ERROR {futs[fut]['numeroConvocatoria']}: {e}", file=sys.stderr)
            if i % 100 == 0:
                print(f"  {i}/{len(convs)} convocatorias procesadas", file=sys.stderr)

    if errors > len(convs) * 0.05:
        sys.exit(f"Demasiados errores ({errors}); no se sobrescriben los datos.")
    build(records, args.force)


if __name__ == "__main__":
    main()
