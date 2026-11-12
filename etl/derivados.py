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
    # Contratos Next Gen por NIF del órgano
    contr = defaultdict(list)
    for f in glob.glob(str(D / "contratos" / "det" / "*.json")):
        for c in json.loads(Path(f).read_text()).values():
            if c.get("organo_nif") and c.get("importe"):
                contr[c["organo_nif"].upper()].append(c)
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
        cs = contr.get(nif.upper(), [])
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


def main():
    convs = json.loads((D / "convocatorias.json").read_text())
    dump("temas.json", temas(convs))
    dump("tipos.json", tipos())
    dump("cadena.json", cadena(convs))
    print("Derivados: temas.json, tipos.json, cadena.json")


if __name__ == "__main__":
    main()
