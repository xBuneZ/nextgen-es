#!/usr/bin/env python3
"""
Datos derivados que se calculan a partir de lo ya publicado en site/data:

  temas.json    convocatorias por finalidad oficial (BDNS) y por temas transversales
                (reglas revisables en etl/temas.json), con sus mayores receptores.
  tipos.json    importe recibido por tipo de organización (según la letra del NIF),
                en subvenciones y en contratos, con los mayores de cada tipo.
  cadena.json   «cadena del dinero»: para cada administración pública que recibe
                subvenciones Next Gen, lo que recibió, lo que repartió en sus propias
                convocatorias Next Gen, lo que contrató con contratos Next Gen y la
                diferencia sin destino publicado.

Se ejecuta al final de las actualizaciones de subvenciones y de contratos.
"""
from __future__ import annotations

import glob
import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "site" / "data"


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFD", (s or "").lower()).encode("ascii", "ignore").decode()).strip()


def dump(name, obj):
    (D / name).write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))


def receptores_convocatoria(c: dict) -> list:
    """Todos los beneficiarios (entidades) de una convocatoria: [nombre, nif, importe]."""
    if c.get("n_paginas"):
        out = []
        for i in range(c["n_paginas"]):
            f = D / "convocatorias" / "benef" / str(c["id"]) / f"{i}.json"
            if f.exists():
                out += [[r[0], r[1], r[2]] for r in json.loads(f.read_text())]
        return out
    return [[b["nombre"], b.get("nif") or "", b["importe"]] for b in c.get("top", [])]


# ---------- Temas ----------
def temas(convs: list[dict]) -> dict:
    cfg = json.loads((ROOT / "etl" / "temas.json").read_text())["temas"]
    total = sum(c["importe"] for c in convs) or 1

    def bloque(ids_convs):
        imp = sum(c["importe"] for c in ids_convs)
        rec = defaultdict(lambda: [None, None, 0.0])
        for c in ids_convs:
            for nombre, nif, i in receptores_convocatoria(c):
                k = nif or nombre
                rec[k][0], rec[k][1] = nombre, nif
                rec[k][2] += i
        top = sorted(rec.values(), key=lambda r: -r[2])[:15]
        g = sum(r[2] for k, r in rec.items() if (r[1] or "")[:1] == "G")
        return {"n": len(ids_convs), "importe": round(imp), "pct": round(imp / total, 4),
                "importe_asoc_fund": round(g),
                "ids": [str(c["id"]) for c in sorted(ids_convs, key=lambda c: -c["importe"])],
                "top": [[r[0], r[1], round(r[2])] for r in top]}

    fin = defaultdict(list)
    for c in convs:
        fin[c.get("finalidad") or "Sin especificar"].append(c)
    oficiales = [{"nombre": k, **bloque(v)} for k, v in sorted(fin.items(), key=lambda kv: -sum(c["importe"] for c in kv[1]))]
    trans = []
    for t in cfg:
        inc = re.compile(t["incluir"])
        exc = re.compile(t["excluir"]) if t.get("excluir") else None
        sel = [c for c in convs if (inc.search(norm(c["titulo"])) and not (exc and exc.search(norm(c["titulo"]))))
               or str(c["id"]) in map(str, t.get("forzar", []))]
        sel = [c for c in sel if str(c["id"]) not in map(str, t.get("quitar", []))]
        trans.append({"id": t["id"], "nombre": t["nombre"], "en": t.get("en", t["nombre"]), **bloque(sel)})
    return {"oficiales": oficiales, "transversales": trans, "total": round(total)}


# ---------- Tipos de organización (letra del NIF) ----------
TIPOS = [
    ("empresas", "Empresas (SA, SL…)", "Companies", "ABCD"),
    ("cooperativas", "Cooperativas", "Cooperatives", "F"),
    ("asociaciones", "Asociaciones y fundaciones", "Associations and foundations", "G"),
    ("religiosas", "Entidades religiosas", "Religious organisations", "R"),
    ("comunidades", "Comunidades de bienes, de propietarios y sociedades civiles", "Joint ownerships and civil partnerships", "EHJ"),
    ("publicas", "Administraciones y entes públicos", "Public administrations and bodies", "PQS"),
    ("ute", "Uniones temporales de empresas", "Joint ventures (UTE)", "U"),
    ("extranjeras", "Entidades extranjeras", "Foreign entities", "NW"),
    ("otras", "Otras / sin NIF", "Other / no tax ID", ""),
]


def tipo_de(nif: str) -> str:
    l = (nif or "")[:1].upper()
    for k, _, _, letras in TIPOS:
        if l and l in letras:
            return k
    return "otras"


def tipos() -> dict:
    sub = defaultdict(lambda: {"n": 0, "importe": 0.0, "top": []})
    vistos = set()
    for f in glob.glob(str(D / "benef_idx" / "n_*.json")) + glob.glob(str(D / "benef_idx" / "w_*.json")):
        for r in json.loads(Path(f).read_text()):
            k = r[0] or r[1]
            if k in vistos:
                continue
            vistos.add(k)
            t = sub[tipo_de(r[0])]
            t["n"] += 1
            t["importe"] += r[2]
            t["top"].append([r[1], r[0], r[2], r[3]])
    con = defaultdict(lambda: {"n": 0, "importe": 0.0, "top": []})
    emp = D / "contratos" / "empresas.json"
    for nif, nombre, n, imp, nno, impno, orgs in (json.loads(emp.read_text()) if emp.exists() else []):
        t = con[tipo_de(nif)]
        t["n"] += 1
        t["importe"] += imp
        t["top"].append([nombre, nif, imp, n])
    out = []
    for k, es, en, letras in TIPOS:
        s, c = sub[k], con[k]
        out.append({"id": k, "nombre": es, "en": en, "letras": letras,
                    "sub_n": s["n"], "sub_importe": round(s["importe"]), "sub_top": sorted(s["top"], key=lambda r: -r[2])[:300],
                    "con_n": c["n"], "con_importe": round(c["importe"]), "con_top": sorted(c["top"], key=lambda r: -r[2])[:300]})
    pf = json.loads((D / "resumen.json").read_text())["totales"]
    return {"tipos": out, "personas_fisicas": {"n": pf.get("personas_fisicas_n", 0), "importe": round(pf.get("personas_fisicas_importe", 0))}}


# ---------- Cadena del dinero ----------
TIPO_ADM = [
    ("ayuntamiento", r"\b(ayuntamiento|ajuntament|ajuntment|concello|udala|ayto|ajunt)\b"),
    ("comarca", r"\b(consell comarcal|consejo comarcal|comarca)\b"),
    ("diputacion", r"\b(diputacion provincial|diputacion foral|diputacio|diputacion de (?!.*general))\b"),
    ("cabildo", r"\b(cabildo|consell insular|consejo insular)\b"),
    ("mancomunidad", r"\b(mancomunidad|mancomunitat)\b"),
]
CCAA = {
    "andalucia": ["andalucia", "junta de andalucia"], "aragon": ["aragon"], "asturias": ["asturias", "principado de asturias"],
    "baleares": ["baleares", "illes balears", "islas baleares"], "canarias": ["canarias"], "cantabria": ["cantabria"],
    "castilla la mancha": ["castilla la mancha", "castilla-la mancha"], "castilla y leon": ["castilla y leon"],
    "cataluna": ["cataluna", "catalunya", "generalitat de catalunya"], "valenciana": ["valenciana", "generalitat valenciana", "generalitat de valencia"],
    "extremadura": ["extremadura"], "galicia": ["galicia", "xunta"], "madrid": ["comunidad de madrid"], "murcia": ["murcia region", "region de murcia"],
    "navarra": ["navarra"], "pais vasco": ["pais vasco", "euskadi"], "la rioja": ["la rioja", "rioja"], "ceuta": ["ceuta"], "melilla": ["melilla"],
}
VACIAS = {"de", "del", "la", "las", "los", "el", "els", "les", "l", "d", "i", "y", "a", "en", "ajuntament", "ayuntamiento", "concello",
          "consell", "consejo", "comarcal", "diputacion", "diputacio", "provincial", "foral", "cabildo", "insular", "mancomunidad",
          "mancomunitat", "udala", "ayto", "ajunt", "ajuntment", "excmo", "ilmo"}


def lugar(s: str) -> frozenset:
    return frozenset(w for w in re.split(r"[^a-z0-9]+", norm(s)) if w and w not in VACIAS and len(w) > 1)


def clase(nombre: str) -> str | None:
    n = norm(nombre)
    for k, p in TIPO_ADM:
        if re.search(p, n):
            return k
    return None


def ccaa_de(nombre: str) -> str | None:
    n = norm(nombre)
    if not re.search(r"comunidad autonoma|junta de|generalitat|xunta|gobierno de|principado|region de|comunidad de madrid|comunidad foral|diputacion general de aragon|^(castilla la mancha|cataluna|canarias|aragon|extremadura|cantabria|la rioja|navarra|galicia|andalucia)$", n):
        return None
    for k, al in CCAA.items():
        if any(a in n for a in al):
            return k
    return None


def cadena(convs: list[dict]) -> dict:
    # Receptores públicos (NIF P, Q, S) de subvenciones Next Gen
    rec = {}
    for f in glob.glob(str(D / "benef_idx" / "n_*.json")):
        for r in json.loads(Path(f).read_text()):
            if r[0][:1] in "PQS" and r[0] not in rec:
                rec[r[0]] = r
    # Convocatorias propias Next Gen, por clave (clase, lugar) o comunidad autónoma
    propias_loc, propias_ccaa = defaultdict(list), defaultdict(list)
    for c in convs:
        if c["nivel1"] == "LOCAL":
            cl = clase(c["nivel3"]) or clase(c["nivel2"]) or "ayuntamiento"
            nombre = c["nivel3"] if clase(c["nivel3"]) else c["nivel2"]
            propias_loc[(cl, lugar(nombre))].append(c)
        elif c["nivel1"] == "AUTONOMICA":
            k = next((k for k, al in CCAA.items() if any(a in norm(c["nivel2"]) for a in al)), None)
            if k:
                propias_ccaa[k].append(c)
    # Contratos Next Gen por NIF del órgano. Las plataformas autonómicas agregadas no
    # publican el NIF (usan códigos DIR3): esos contratos se emparejan por tipo y nombre.
    contr, contr_nombre = defaultdict(list), defaultdict(list)
    for f in glob.glob(str(D / "contratos" / "det" / "*.json")):
        for c in json.loads(Path(f).read_text()).values():
            if not c.get("importe"):
                continue
            if c.get("organo_nif"):
                contr[c["organo_nif"].upper()].append(c)
            else:
                cl = clase(c.get("organo", ""))
                if cl:
                    contr_nombre[(cl, lugar(c["organo"]))].append(c)
    out = []
    for nif, r in rec.items():
        if r[2] < 50_000:
            continue
        nombre = r[1]
        k_ccaa = ccaa_de(nombre) if nif[:1] == "S" else None
        cl = clase(nombre)
        if k_ccaa:
            props, tipo = propias_ccaa.get(k_ccaa, []), "ccaa"
        elif cl:
            props, tipo = propias_loc.get((cl, lugar(nombre)), []), cl
        elif nif[:1] == "Q":
            # universidades, CSIC, centros de investigación…: suelen ejecutar el dinero directamente
            props, tipo = [], "organismo"
        elif nif[:1] == "P":
            props, tipo = [], "local"
        else:
            props, tipo = [], "otro"
        cs = contr.get(nif.upper(), []) + (contr_nombre.get((cl, lugar(nombre)), []) if cl and not k_ccaa else [])
        repartido = sum(c["importe"] for c in props)
        contratado = sum(c["importe"] for c in cs)
        out.append({
            "nif": nif, "nombre": nombre, "tipo": tipo,
            "recibido": round(r[2]), "n_recibidas": r[3], "recibidas": r[4][:10],
            "repartido": round(repartido), "n_propias": len(props),
            "propias": [[str(c["id"]), round(c["importe"])] for c in sorted(props, key=lambda c: -c["importe"])[:15]],
            "contratado": round(contratado), "n_contratos": len(cs),
            "contratos": [[c["cid"], round(c["importe"]), (c.get("adj") or [{}])[0].get("nombre", "")] for c in sorted(cs, key=lambda c: -c["importe"])[:15]],
            "sin_rastro": round(max(0.0, r[2] - repartido - contratado)),
            "enlazado": bool(props) or bool(cs),
        })
    out.sort(key=lambda e: -e["sin_rastro"])
    return {"entidades": out,
            "nota": "Recibido = subvenciones Next Gen publicadas en la BDNS con la entidad como beneficiaria. Repartido = sus propias convocatorias marcadas como MRR. Contratado = contratos marcados como Plan de Recuperación con su NIF como órgano de contratación. La diferencia puede deberse a gasto en personal propio, cofinanciación, plazos o a gasto publicado sin la marca Next Gen."}


# ---------- Lo que España declara a Bruselas (Recovery and Resilience Scoreboard) ----------
RRF = ROOT / "etl" / ".cache" / "rrf"
FUENTE_RRF = "https://ec.europa.eu/economy_finance/recovery-and-resilience-scoreboard/disbursements.html"


def leer_xlsx(f: Path) -> list[tuple]:
    import openpyxl
    return list(openpyxl.load_workbook(f, read_only=True).active.iter_rows(values_only=True))


def bruselas(convs: list[dict]) -> dict | None:
    if not (RRF / "perceptores.xlsx").exists() or not (RRF / "pagos.xlsx").exists():
        return None
    # Pagos de la UE (todos los países, para comparar)
    pagos = [r for r in leer_xlsx(RRF / "pagos.xlsx")[1:] if r and r[0]]
    esp = sorted(([str(r[1])[:10], r[2], r[3], round(float(r[4] or 0))] for r in pagos if r[0] == "Spain"), key=lambda x: x[0])
    por_pais = defaultdict(lambda: {"subvenciones": 0, "prestamos": 0})
    for r in pagos:
        por_pais[r[0]]["subvenciones" if r[2] == "Grants" else "prestamos"] += float(r[4] or 0)
    paises = sorted(({"pais": k, "subvenciones": round(v["subvenciones"]), "prestamos": round(v["prestamos"])} for k, v in por_pais.items()),
                    key=lambda x: -x["subvenciones"])

    # Lo publicado en España para cada perceptor
    sub = {}
    for f in glob.glob(str(D / "benef_idx" / "n_*.json")):
        for r in json.loads(Path(f).read_text()):
            sub.setdefault(r[0].upper(), r[2])
    emp = D / "contratos" / "empresas.json"
    ganado = {e[0].upper(): e[3] for e in (json.loads(emp.read_text()) if emp.exists() else []) if e[0]}
    contratos = [c for f in glob.glob(str(D / "contratos" / "det" / "*.json")) for c in json.loads(Path(f).read_text()).values() if c.get("importe")]
    # Las plataformas autonómicas no publican el NIF del órgano: se cruza por nombre, tolerando
    # variantes de idioma y escritura (Infraestructuras/Infraestructures, Cataluña/Catalunya…):
    # se comparan las raíces (5 primeras letras) de las palabras significativas, y las siglas.
    VAC = {"de", "del", "la", "las", "los", "el", "els", "les", "i", "y", "a", "e", "do", "da", "para", "per", "sa", "sau", "sl", "slu",
           "sme", "mp", "s", "m", "p", "u", "l", "d", "ente", "publico", "sociedad", "anonima", "societat", "empresa"}
    def raices(x):
        return frozenset(w[:5] for w in re.split(r"[^a-z0-9]+", norm(x)) if w and w not in VAC and len(w) > 1)
    def siglas(x):
        m = re.search(r"\(([A-Z0-9]{3,})\)", x or "")
        return m.group(1) if m else None
    por_nif, por_raiz, por_sigla = defaultdict(list), defaultdict(list), defaultdict(list)
    for c in contratos:
        if c.get("organo_nif"):
            por_nif[c["organo_nif"].upper()].append(c)
        else:
            por_raiz[raices(c.get("organo", ""))].append(c)
            if siglas(c.get("organo")):
                por_sigla[siglas(c["organo"])].append(c)

    def por_nombre(nombre):
        r = raices(nombre)
        out = []
        if len(r) >= 2:
            for k, cs in por_raiz.items():
                if k and len(r & k) / len(r | k) >= 0.75:
                    out += cs
        if siglas(nombre):
            out += por_sigla.get(siglas(nombre), [])
        return out

    def contratos_de(nif: str, nombre: str) -> list:
        sel = {c["cid"]: c for c in por_nif.get(nif, [])}
        sel.update({c["cid"]: c for c in por_nombre(nombre)})
        n = norm(nombre)
        m = re.match(r"ministerio (?:de |del |para la |para el )?(?:la |el |los |las )?([a-z]+)", n)
        if m and nif[:1] == "S":  # todas las unidades del ministerio, aunque tengan NIF propio
            clave = m.group(1)
            for c in contratos:
                r0 = norm((c.get("ruta") or "").split(" › ")[0])
                if c.get("ambito") == "ADMINISTRACIÓN GENERAL DEL ESTADO" and r0.startswith("ministerio") and clave in r0:
                    sel[c["cid"]] = c
        k = ccaa_de(nombre) if nif[:1] == "S" else None
        if k:  # departamentos de la comunidad, sin las entidades locales
            for c in contratos:
                ruta = norm(c.get("ruta") or "")
                r0 = ruta.split(" › ")[0]
                if c.get("ambito") in ("COMUNIDADES Y CIUDADES AUTÓNOMAS", "PLATAFORMAS AUTONÓMICAS PROPIAS") \
                        and any(a in r0 for a in CCAA[k]) and not re.search(r"administracio local|entidades locales|ayuntamiento|ajuntament|concello|diputaci", ruta):
                    sel[c["cid"]] = c
        return list(sel.values())

    propias_ccaa = defaultdict(float)
    propias_min = defaultdict(float)
    for c in convs:
        if c["nivel1"] == "AUTONOMICA":
            k = next((k for k, al in CCAA.items() if any(a in norm(c["nivel2"]) for a in al)), None)
            if k:
                propias_ccaa[k] += c["importe"]
        elif c["nivel1"] == "ESTADO":
            propias_min[norm(c["nivel2"])] += c["importe"]

    out = []
    for r in leer_xlsx(RRF / "perceptores.xlsx")[1:]:
        if not r or r[0] != "Spain":
            continue
        nif = (r[2] or "").strip().upper()
        nombre = (r[1] or "").strip()
        declarado = float(r[4] or 0)
        cs = contratos_de(nif, nombre)
        contratado = sum(c["importe"] for c in cs)
        recibido = sub.get(nif, 0) + ganado.get(nif, 0)
        k = ccaa_de(nombre) if nif[:1] == "S" else None
        m = re.match(r"ministerio (?:de |del |para la |para el )?(?:la |el |los |las )?([a-z]+)", norm(nombre))
        repartido = propias_ccaa.get(k, 0) if k else (sum(v for kk, v in propias_min.items() if m and m.group(1) in kk) if m and nif[:1] == "S" else 0)
        publicado = max(recibido, repartido + contratado)
        rastro = min(declarado, publicado)
        medidas = [x.strip(" •\n") for x in str(r[3] or "").split("\n") if x.strip(" •\n")]
        out.append({"nif": nif, "nombre": nombre, "declarado": round(declarado), "medidas": medidas[:12],
                    "recibido": round(recibido), "repartido": round(repartido), "contratado": round(contratado), "n_contratos": len(cs),
                    "contratos": [[c["cid"], round(c["importe"]), (c.get("adj") or [{}])[0].get("nombre", "")] for c in sorted(cs, key=lambda c: -c["importe"])[:10]],
                    "con_rastro": round(rastro), "sin_rastro": round(declarado - rastro)})
    out.sort(key=lambda e: -e["declarado"])
    ref = json.loads((ROOT / "site" / "referencia.json").read_text()) if (ROOT / "site" / "referencia.json").exists() else {}
    return {
        "fuente": FUENTE_RRF,
        "pagos": esp,
        "pagado_subvenciones": round(sum(p[3] for p in esp if p[1] == "Grants")),
        "pagado_prestamos": round(sum(p[3] for p in esp if p[1] == "Loans")),
        "asignado_subvenciones": ref.get("subvenciones_asignadas"),
        "paises": paises,
        "perceptores": out,
        "declarado_total": round(sum(e["declarado"] for e in out)),
        "con_rastro_total": round(sum(e["con_rastro"] for e in out)),
    }


def main():
    convs = json.loads((D / "convocatorias.json").read_text())
    dump("temas.json", temas(convs))
    dump("tipos.json", tipos())
    dump("cadena.json", cadena(convs))
    b = bruselas(convs)
    if b:
        dump("bruselas.json", b)
    print("Derivados: temas.json, tipos.json, cadena.json" + (", bruselas.json" if b else " (sin datos del Scoreboard)"))


if __name__ == "__main__":
    main()
