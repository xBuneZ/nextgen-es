"use strict";

// Repositorio de GitHub donde se reciben propuestas de revisión (issues).
// Cámbialo por el tuyo, p. ej. "usuario/nextgen-es".
const REPO = "xBuneZ/nextgen-es";

const FLAGS = ["nominativa", "concesion_directa", "concentracion", "beneficiario_unico_1m", "supera_presupuesto", "sin_concesiones"];
const PAGE = 50;

let lang = (() => { try { return localStorage.getItem("lang") || (navigator.language.startsWith("es") ? "es" : "en"); } catch { return "es"; } })();
const t = (k) => (I18N[lang] && I18N[lang][k]) || I18N.es[k] || k;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const locale = () => (lang === "es" ? "es-ES" : "en-GB");
const eur = (n) => new Intl.NumberFormat(locale(), { style: "currency", currency: "EUR", maximumFractionDigits: 0, useGrouping: "always" }).format(n || 0);
const eurShort = (n) => {
  n = n || 0;
  if (lang === "es") {
    if (Math.abs(n) >= 1e6) return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: Math.abs(n) < 1e7 ? 1 : 0, useGrouping: "always" }).format(n / 1e6)} M€`;
    return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0, useGrouping: "always" }).format(n)} €`;
  }
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 1 }).format(n);
};
const num = (n) => new Intl.NumberFormat(locale(), { useGrouping: "always" }).format(n || 0);
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const DB = { resumen: null, convs: [], benef: [], convById: new Map() };
const state = { q: "", admin: "", flag: "", tipo: "", min: "", tema: "", fin: "", sort: "importe", dir: -1, page: 0 };

async function load() {
  const [r, c, b] = await Promise.all(["resumen", "convocatorias", "beneficiarios"].map((f) => fetch(`data/${f}.json`).then((x) => x.json())));
  DB.resumen = r; DB.convs = c; DB.benef = b;
  for (const x of c) {
    x.ficha_url = `https://www.infosubvenciones.es/bdnstrans/GE/es/convocatorias/${x.id}`;
    DB.convById.set(String(x.id), x);
    x._s = norm([x.titulo, x.nivel2, x.nivel3, x.id, ...x.top.map((b) => b.nombre + " " + (b.nif || ""))].join(" "));
  }
  for (const x of b) x._s = norm(x.nombre + " " + (x.nif || ""));
  DB.temas = await fetch("data/temas.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  DB.temaIds = new Map();
  if (DB.temas) [...DB.temas.transversales, ...DB.temas.oficiales].forEach((x) => DB.temaIds.set(x.id || "fin:" + x.nombre, new Set(x.ids)));
}

function applyI18n() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => (el.placeholder = t(el.dataset.i18nPh)));
  $("#lang").textContent = lang === "es" ? "EN" : "ES";
  if (DB.resumen) $("#generated").textContent = `${t("generated")} ${new Date(DB.resumen.generado).toLocaleDateString(locale())}`;
}

// Filtro por indicadores: lista separada por comas; "*" = cualquier indicador. Se exigen todos los elegidos.
const selFlags = (v) => (v ? v.split(",").filter(Boolean) : []);
const flagMatch = (flags, v) => { const sel = selFlags(v); return !sel.length || (sel.includes("*") ? flags.length > 0 : sel.every((f) => flags.includes(f))); };
const toggleFlag = (v, f) => { const sel = selFlags(v).filter((x) => x !== "*"); const i = sel.indexOf(f); if (i >= 0) sel.splice(i, 1); else sel.push(f); return f === "*" ? (v === "*" ? "" : "*") : sel.join(","); };
function chipBar(id, list, prefix, counts, cur) {
  const sel = selFlags(cur);
  return `<div class="chips" id="${id}" role="group" aria-label="${esc(t("all_flags"))}">
    <button type="button" class="chip any" data-f="*" aria-pressed="${sel.includes("*")}">${esc(t("any_flag"))}</button>
    ${list.filter((f) => counts[f]).map((f) => `<button type="button" class="chip" data-f="${f}" aria-pressed="${sel.includes(f)}" title="${esc(t(prefix + "d_" + f))}">${esc(t(prefix + "_" + f))} <span>${num(counts[f])}</span></button>`).join("")}
    ${sel.length ? `<button type="button" class="chip clear" data-f="">${esc(t("clear_filters"))}</button>` : ""}
    ${sel.filter((x) => x !== "*").length > 1 ? `<p class="sub chips-note">${esc(t("chips_all"))}</p>` : ""}
  </div>`;
}
const flagTags = (flags) => (flags || []).map((f) => `<span class="tag" data-f="${f}" title="${esc(t("flagd_" + f))}">${esc(t("flag_" + f))}</span>`).join("");

function bars(items, { value = "importe", label = "nombre", href, fmt = eurShort, limit = 10 } = {}) {
  const list = items.slice(0, limit);
  const max = Math.max(...list.map((i) => i[value]), 1);
  return `<ul class="bars">${list.map((i) => {
    const l = esc(i[label] || "—");
    return `<li><span class="lbl" title="${l}">${href ? `<a href="${href(i)}">${l}</a>` : l}</span><span class="val">${fmt(i[value])}</span>
      <span class="track"><span class="fill" style="width:${(100 * i[value]) / max}%"></span></span></li>`;
  }).join("")}</ul>`;
}

// ---------- Vistas ----------
const COLORS = ["var(--c1)", "var(--c2)", "var(--c3)"];
const initials = (s) => (String(s).replace(/[,.]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !/^(S\.?A|S\.?L|SLU|SAU|DEL?|LAS?|LOS|PARA|AND)$/i.test(w)).slice(0, 2).map((w) => w[0]).join("") || "?").toUpperCase();
const isPublic = (b) => /^[PQS]/.test(b.nif || "");

function card(title, sub, body, link) {
  return `<section class="card">
    <div class="card-head"><div><h2>${esc(title)}</h2>${sub ? `<p class="sub">${esc(sub)}</p>` : ""}</div>${link || ""}</div>${body}</section>`;
}
const btn = (href, label) => `<a class="btn-sm" href="${href}">${esc(label)}</a>`;

function yearChart(years) {
  const max = Math.max(...years.map((y) => y.importe), 1);
  return `<div class="vbars" role="img" aria-label="${esc(t("by_year"))}">${years.map((y) => `
    <div class="vbar"><span class="v">${(y.importe / 1e9).toLocaleString(locale(), { maximumFractionDigits: 1 })}</span>
      <span class="b${y.importe === max ? " hi" : ""}" style="height:${Math.max(3, (110 * y.importe) / max)}px"></span>
      <span class="x">${esc(y.nombre)}</span></div>`).join("")}</div>
    <p class="sub">${esc(t("bn_note"))}</p>`;
}

function bubbles(items) {
  const tot = items.reduce((s, i) => s + i.importe, 0) || 1;
  const sh = items.map((i) => i.importe / tot);
  const d = sh.map((s) => Math.max(54, Math.round(210 * Math.sqrt(s / sh[0]))));
  const pos = [[0, 20], [d[0] - 24, 0], [d[0] - 6, (d[1] || 0) + 6]];
  const bub = items.slice(0, 3).map((i, k) => `<div class="bubble b${k}" style="width:${d[k]}px;height:${d[k]}px;left:${pos[k][0]}px;top:${pos[k][1]}px;font-size:${Math.max(13, d[k] / 6)}px">${Math.round(sh[k] * 100)}%</div>`).join("");
  const legend = items.slice(0, 3).map((i, k) => `<div><span class="lg"><i style="background:${COLORS[k]}"></i>${esc(t("tb_" + i.nombre))}</span><span class="lv">${eurShort(i.importe)}</span></div>`).join("");
  return `<div class="bubbles" role="img" aria-label="${esc(items.map((i, k) => t("tb_" + i.nombre) + " " + Math.round(sh[k] * 100) + "%").join(", "))}">${bub}</div><div class="legend">${legend}</div>`;
}

function gauge(part, total) {
  const p = total ? part / total : 0, a = Math.PI * p;
  const x = (130 - 110 * Math.cos(a)).toFixed(1), y = (135 - 110 * Math.sin(a)).toFixed(1);
  return `<div class="gauge"><svg viewBox="0 0 260 150" role="img" aria-label="${Math.round(p * 100)}%">
    <path d="M20 135 A110 110 0 0 1 240 135" class="g-bg"></path>
    <path d="M20 135 A110 110 0 0 1 ${x} ${y}" class="g-fg"></path>
    <circle cx="${x}" cy="${y}" r="9" class="g-dot"></circle></svg>
    <div class="g-txt"><b>${num(part)}</b><span>${t("of")} ${num(total)} ${t("k_convs")}</span></div></div>`;
}

function moneyCard(r, grant) {
  const T = r.totales, d = r.desglose;
  if (!d) {
    return card(t("k_importe_t"), t("by_year"), `<p class="big">${eurShort(T.importe)}</p>
      <p class="delta">${grant ? Math.round((100 * grant.importe) / T.importe) : 0}% ${t("grant_share")}</p>${yearChart(r.por_anio)}`, btn("#/proyectos", t("see_projects")));
  }
  const fp = (d.fondo_perdido_privado || 0) + (d.fondo_perdido_pf || 0);
  return card(t("k_importe_t"), t("money_sub"), `<p class="big">${eurShort(fp)}</p>
    <p class="delta">${t("money_fp")}</p>
    <ul class="brk">
      <li><span>${t("money_admin")}<small>${t("money_admin_note")}</small></span><b>${eurShort(d.a_administraciones || 0)}</b></li>
      <li><span>${t("money_loans")}</span><b>${eurShort((d.garantia || 0) + (d.prestamo || 0))}</b></li>
      <li class="tot"><span>${t("money_gross")}</span><b>${eurShort(T.importe)}</b></li>
    </ul>
    <h3 class="mini">${t("money_years")}</h3>${yearChart(r.por_anio)}`, btn("#/proyectos", t("see_projects")));
}

function fillHome() {
  const el = $("#cov-contr");
  if (!el) return;
  fetch("referencia.json").then((r) => (r.ok ? r.json() : null)).then((ref) => {
    const li = $("#cov-ref");
    if (!ref || !li) return;
    li.innerHTML = `<b>${t("ref_title")}</b><span>${t("ref_alloc").replace("{a}", eurShort(ref.subvenciones_asignadas))}
      ${ref.subvenciones_perdidas ? `<strong class="lost">${t("ref_lost").replace("{p}", eurShort(ref.subvenciones_perdidas))}</strong>` : ""}
      <a href="${esc(ref.url)}" target="_blank" rel="noopener">${t("ref_source")} ↗</a>
      <a href="#/bruselas">${t("bru_home_link")} →</a></span>`;
    li.hidden = false;
  }).catch(() => {});
  fetch("data/contratos/totales.json").then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (!$("#cov-contr")) return;
    $("#cov-contr").textContent = d ? `${num(d.totales.adjudicados)} ${t("c_awarded_n")} · ${eurShort(d.totales.importe)} ${t("no_vat")}` : "—";
    const box = $("#home-contr");
    if (!d || !box) return;
    const T = d.totales, I = d.indicadores, pct = (n) => (T.adjudicados ? Math.round((100 * n) / T.adjudicados) : 0);
    box.innerHTML = `<h2 class="sect">${t("hc_title")}</h2>
    <div class="cols">
      <div class="col">${card(t("hc_kpis"), t("hc_kpis_sub"), `<p class="big">${eurShort(T.importe)}</p><p class="delta">${num(T.adjudicados)} ${t("c_awarded_n")} · ${t("no_vat")}</p>
        <ul class="brk">
          <li><span>${t("cflag_licitador_unico")}</span><b>${pct(I.licitador_unico || 0)}%</b></li>
          <li><span>${t("cflag_sin_baja")}</span><b>${num(I.sin_baja || 0)}</b></li>
          <li><span>${t("cflag_negociado_sin_publicidad")}</span><b>${num(I.negociado_sin_publicidad || 0)}</b></li>
          <li><span>${t("cflag_plazo_corto")}</span><b>${num(I.plazo_corto || 0)}</b></li>
        </ul>`, btn("#/contratos", t("see_all")))}</div>
      <div class="col">${d.ranking_top ? card(t("hc_rank"), t("hc_rank_sub").replace("{m}", pctf(d.media_sin_comp || 0)), `<ol class="mini-rank">${d.ranking_top.map((r) => `<li><a href="${cHref(r.organo)}">${esc(prettyOrg(r.organo))}</a>
          <span class="pbar"><span style="width:${Math.round(100 * r.pct)}%"></span></span><b>${pctf(r.pct)}</b></li>`).join("")}</ol>`, btn("#/ranking", t("nav_ranking"))) : ""}</div>
      <div class="col">${d.destacados ? card(t("hc_cases"), t("hc_cases_sub"), `<div class="cases">${d.destacados.map((c) => `<a class="case" href="#/contrato/${encodeURIComponent(c.cid)}">
          <span class="ct"><b>${esc(c.adj)}</b><b>${eurShort(c.importe)}</b></span><span class="sub">${esc(oneLine(c.objeto, 100))}</span>
          <span class="sub">${esc(prettyOrg(c.organo))} · ${esc((c.fecha || "").slice(0, 4))}</span>${cflagTags(c.flags)}</a>`).join("")}</div>`) : ""}</div>
    </div>`;
  }).catch(() => { el.textContent = "—"; });
}

function viewHome() {
  queueMicrotask(fillHome);
  const r = DB.resumen, T = r.totales;
  const noComp = DB.convs.filter((c) => c.flags.includes("concesion_directa") || c.flags.includes("nominativa")).length;
  const grant = (r.por_instrumento || []).find((i) => i.nombre === "subvencion");
  const tiles = ["sin_concesiones", "beneficiario_unico_1m", "nominativa", "supera_presupuesto"].map((f, k) => {
    const n = r.indicadores[f] || 0;
    return `<a class="tile t${k}" href="#/proyectos?flag=${f}"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4h11l-2 4 2 4H5"></path></svg></span>
      <b>${esc(t("flag_" + f))}</b><span class="sub">${num(n)} ${t("k_convs")}</span>
      <span class="prog"><span style="width:${Math.max(2, (100 * n) / T.convocatorias)}%"></span></span></a>`;
  }).join("");
  const benef = DB.benef.slice(0, 5).map((b) => `<a class="row" href="#/beneficiario/${encodeURIComponent(b.nif || b.nombre)}">
      <span class="av ${isPublic(b) ? "pub" : ""}">${esc(initials(b.nombre))}</span>
      <span class="rt"><b>${esc(b.nombre)}</b><span class="sub">${t(isPublic(b) ? "kind_pub" : "kind_priv")}</span></span>
      <span class="ra">${eurShort(b.importe)}</span></a>`).join("");
  const cases = DB.convs.filter((c) => c.flags.includes("beneficiario_unico_1m") && c.top[0] && !/^[PQS]/.test(c.top[0].nif || "")).slice(0, 4).map((c) => `
    <a class="case" href="#/proyecto/${c.id}"><span class="ct"><b>${esc(c.top[0].nombre)}</b><b>${eurShort(c.importe)}</b></span>
      <span class="sub">${esc(c.titulo.slice(0, 90))}${c.titulo.length > 90 ? "…" : ""}</span>
      <span class="sub">${esc(c.nivel2)} · ${esc(c.fecha.slice(0, 4))}</span>${flagTags(c.flags)}</a>`).join("");
  const fines = r.por_finalidad.slice(0, 6);
  const fmax = fines[0] ? fines[0].importe : 1;

  return `
  <div class="hero"><h1>${esc(t("home_title"))}</h1>
    <p class="lead">${num(T.convocatorias)} ${t("k_convs")} · ${num(T.concesiones)} ${t("k_concesiones")} · BDNS</p></div>
  <h2 class="sect">${t("hs_title")}</h2>
  <div class="cols">
    <div class="col">
      ${moneyCard(r, grant)}
      ${card(t("exec_t"), t("exec_sub"), `<p class="big">${eurShort(T.importe)} <small>${t("of")} ${eurShort(T.presupuesto)}</small></p>
        <div class="seg">${Array.from({ length: 10 }, (_, i) => `<span class="${i < Math.round((10 * T.importe) / T.presupuesto) ? "on" : ""}"></span>`).join("")}</div>`)}
      <h2 class="list-h">${t("top_benef")}</h2>
      <div class="rows">${benef}</div>
      <a class="more" href="#/beneficiarios">${t("see_all")}</a>
    </div>
    <div class="col">
      ${card(t("who_t"), t("who_sub"), bubbles(r.por_tipo_beneficiario || []))}
      ${card(t("cov_t"), t("cov_sub"), `<ul class="cov">
        <li><b>${t("cov_grants")}</b><span>${num(T.convocatorias)} ${t("k_convs")} · ${eurShort(T.importe)} ${t("cov_gross")}</span></li>
        <li><b>${t("cov_contracts")}</b><span id="cov-contr">${t("loading")}</span></li>
        <li id="cov-ref" hidden></li>
        <li class="no"><b>${t("cov_missing")}</b><span>${t("cov_missing_list")}</span></li></ul>`, btn("#/metodologia", t("nav_method")))}
      ${card(t("what_t"), t("what_sub"), `<div class="hbars">${fines.map((f, k) => `<a href="#/proyectos?q=${encodeURIComponent(f.nombre)}"><span class="hl"><span>${esc(f.nombre)}</span><span class="sub">${eurShort(f.importe)}</span></span>
        <span class="track"><span style="width:${(100 * f.importe) / fmax}%;background:${COLORS[k % 3]}"></span></span></a>`).join("")}</div>`)}
    </div>
    <div class="col">
      ${card(t("nocomp_t"), t("nocomp_sub"), gauge(noComp, T.convocatorias), btn("#/proyectos?flag=concesion_directa", t("see")))}
      <div class="tiles">${tiles}</div>
      ${card(t("cases_t"), "", `<div class="cases">${cases}</div>`)}
    </div>
  </div>
  <div id="home-contr"></div>
  `;
}

function filteredConvs() {
  const q = norm(state.q), min = Number(state.min) || 0;
  let rows = DB.convs.filter((c) =>
    (!q || c._s.includes(q) || (state.extraIds && state.extraIds.has(String(c.id)))) &&
    (!state.admin || c.nivel1 === state.admin) &&
    (!state.tipo || c.tipo === state.tipo) &&
    (!state.tema || (DB.temaIds.get(state.tema) || new Set()).has(String(c.id))) &&
    (!state.fin || c.finalidad === state.fin) &&
    flagMatch(c.flags, state.flag) &&
    c.importe >= min);
  const k = state.sort, d = state.dir;
  rows.sort((a, b) => (a[k] > b[k] ? d : a[k] < b[k] ? -d : 0));
  return rows;
}

function viewProjects() {
  const admins = DB.resumen.por_administracion.map((a) => a.nombre);
  const tipos = [...new Set(DB.convs.map((c) => c.tipo).filter(Boolean))].sort();
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`;
  return `<h1>${t("projects_title")}</h1>
  <div class="filters">
    <input type="search" id="q" placeholder="${esc(t("search_projects"))}" value="${esc(state.q)}">
    <select id="admin">${opt("", t("all_admins"), state.admin)}${admins.map((a) => opt(a, a, state.admin)).join("")}</select>
    <select id="tipo">${opt("", t("all_types"), state.tipo)}${tipos.map((a) => opt(a, a, state.tipo)).join("")}</select>
    ${DB.temas ? `<select id="tema">${opt("", t("all_temas"), state.tema)}${DB.temas.transversales.map((x) => opt(x.id, lang === "es" ? x.nombre : x.en, state.tema)).join("")}</select>
    <select id="fin">${opt("", t("all_fin"), state.fin)}${DB.temas.oficiales.map((x) => opt(x.nombre, x.nombre, state.fin)).join("")}</select>` : ""}
    <input type="number" id="min" min="0" step="10000" placeholder="${esc(t("min_amount"))}" value="${esc(state.min)}" style="width:170px">
  </div>
  ${chipBar("chips", FLAGS, "flag", DB.resumen.indicadores, state.flag)}
  <div id="results"></div>`;
}

function renderProjectRows() {
  const rows = filteredConvs();
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  state.page = Math.min(state.page, pages - 1);
  const slice = rows.slice(state.page * PAGE, (state.page + 1) * PAGE);
  const th = (k, l, cls = "") => `<th class="${cls}" data-sort="${k}">${esc(l)}${state.sort === k ? (state.dir < 0 ? " ↓" : " ↑") : ""}</th>`;
  $("#results").innerHTML = `<p class="count">${num(rows.length)} ${t("results")} · ${eur(rows.reduce((s, r) => s + r.importe, 0))}</p>
  <div class="table-wrap"><table>
    <thead><tr>${th("titulo", t("c_title"))}${th("fecha", t("c_date"), "hide-sm")}${th("n_beneficiarios", t("c_benef"), "num hide-sm")}${th("presupuesto", t("c_budget"), "num hide-sm")}${th("importe", t("c_amount"), "num")}</tr></thead>
    <tbody>${slice.map((c) => `<tr data-id="${esc(c.id)}">
      <td class="t-title">${esc(c.titulo)}<div class="t-sub">${esc(c.nivel2)}${c.nivel3 ? " · " + esc(c.nivel3) : ""}</div>${flagTags(c.flags)}</td>
      <td class="hide-sm">${esc(c.fecha)}</td><td class="num hide-sm">${num(c.n_beneficiarios)}</td>
      <td class="num hide-sm">${eur(c.presupuesto)}</td><td class="num">${eur(c.importe)}</td></tr>`).join("")}</tbody>
  </table></div>
  ${pager(pages, state.page)}`;
}

function pager(pages, cur) {
  return `<div class="pager"><button data-p="-1" ${cur === 0 ? "disabled" : ""}>${t("prev")}</button>
    <span>${t("page")} ${cur + 1} / ${pages}</span>
    <button data-p="1" ${cur >= pages - 1 ? "disabled" : ""}>${t("next")}</button></div>`;
}

function bindProjects() {
  const upd = () => { state.page = 0; syncUrl(); renderProjectRows(); };
  // Además del título y los 5 mayores beneficiarios, busca en el índice completo de beneficiarios
  const refresh = () => {
    const q0 = state.q;
    state.extraIds = new Set();
    benefSearch(q0).then((rows) => {
      if (state.q !== q0 || !$("#results")) return;
      rows.forEach((r) => r[4].forEach(([id]) => state.extraIds.add(String(id))));
      if (state.extraIds.size) renderProjectRows();
    });
  };
  $("#q").addEventListener("input", (e) => { state.q = e.target.value; upd(); refresh(); });
  refresh();
  ["admin", "tipo", "min", "tema", "fin"].forEach((id) => $("#" + id) && $("#" + id).addEventListener("input", (e) => { state[id] = e.target.value; upd(); }));
  const setFlag = (v) => { state.flag = v; $("#chips").outerHTML = chipBar("chips", FLAGS, "flag", DB.resumen.indicadores, v); bindChips(); upd(); };
  const bindChips = () => $("#chips").addEventListener("click", (e) => { const b = e.target.closest("button[data-f]"); if (b) setFlag(b.dataset.f ? toggleFlag(state.flag, b.dataset.f) : ""); });
  bindChips();
  $("#results").addEventListener("click", (e) => {
    const tg = e.target.closest(".tag[data-f]");
    if (tg) { if (!selFlags(state.flag).includes(tg.dataset.f)) setFlag(toggleFlag(state.flag, tg.dataset.f)); return; }
    const s = e.target.closest("th[data-sort]");
    if (s) { const k = s.dataset.sort; state.dir = state.sort === k ? -state.dir : -1; state.sort = k; renderProjectRows(); return; }
    const p = e.target.closest("button[data-p]");
    if (p) { state.page += Number(p.dataset.p); renderProjectRows(); window.scrollTo(0, 0); return; }
    const tr = e.target.closest("tr[data-id]");
    if (tr) location.hash = `#/proyecto/${tr.dataset.id}`;
  });
  renderProjectRows();
}

function syncUrl() {
  const p = new URLSearchParams();
  for (const k of ["q", "admin", "flag", "tipo", "min", "tema", "fin"]) if (state[k]) p.set(k, state[k]);
  history.replaceState(null, "", `#/proyectos${p.toString() ? "?" + p : ""}`);
}

function issueUrl(c) {
  const title = `[Revisión] ${c.titulo.slice(0, 120)}`;
  const body = `**Convocatoria BDNS:** ${c.id}\n**Ficha oficial:** ${c.ficha_url}\n**Órgano:** ${c.nivel2} · ${c.nivel3}\n**Importe concedido:** ${eur(c.importe)}\n\n### ¿Por qué merece revisión? / Why does it deserve scrutiny?\n\n<!-- Aporta hechos verificables y fuentes. Evita acusaciones sin pruebas. -->\n\n### Fuentes / Sources\n\n- `;
  return `https://github.com/${REPO}/issues/new?labels=revision&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

const CTOP = new Map();
async function showProject(id) {
  const c = DB.convById.get(String(id));
  if (!c) return;
  if (c.top_mas) {
    const k = String(/^\d+$/.test(String(c.id)) ? Number(c.id) % 16 : 0).padStart(2, "0");
    if (!CTOP.has(k)) CTOP.set(k, fetch(`data/convocatorias/det/${k}.json`).then((r) => r.json()).catch(() => ({})));
    openModal(`<p class="muted">${t("loading")}</p>`);
    const full = (await CTOP.get(k))[String(c.id)];
    if (full) { c.top = full; c.top_mas = false; }
  }
  const row = (k, v) => (v ? `<dt>${t(k)}</dt><dd>${v}</dd>` : "");
  openModal(`<h3>${esc(c.titulo)}</h3>
    <p class="muted">${esc(c.nivel1)} · ${esc(c.nivel2)}${c.nivel3 ? " · " + esc(c.nivel3) : ""} · BDNS ${esc(c.id)} · ${esc(c.fecha)}</p>
    ${c.flags.length ? `<div class="notice">${c.flags.map((f) => `<b>${esc(t("flag_" + f))}</b>: ${esc(t("flagd_" + f))}`).join("<br>")}</div>` : ""}
    <div class="kpis"><div class="kpi"><b>${eur(c.importe)}</b><span>${t("c_amount")}</span></div>
      <div class="kpi"><b>${eur(c.presupuesto)}</b><span>${t("c_budget")}</span></div>
      <div class="kpi"><b>${num(c.n_concesiones)}</b><span>${t("c_n")}</span></div></div>
    <dl class="meta">${row("m_type", esc(c.tipo))}${row("m_purpose", esc(c.finalidad))}${row("m_instr", esc(c.instrumentos.join(", ")))}
      ${row("m_regions", esc(c.regiones.join(", ")))}${row("m_sectors", esc(c.sectores.join("; ")))}
      ${row("m_pf", c.pf_n ? `${num(c.pf_n)} · ${eur(c.pf_importe)}` : "")}
      ${row("m_official", `<a href="${esc(c.ficha_url)}" target="_blank" rel="noopener">infosubvenciones.es ↗</a>`)}
      ${c.bases_url ? row("m_bases", `<a href="${esc(c.bases_url)}" target="_blank" rel="noopener">${esc(t("m_bases"))} ↗</a>`) : ""}</dl>
    ${c.n_paginas ? `<h2>${t("m_allb").replace("{n}", num(c.n_entidades))}</h2><div id="cb-list" data-conv="${esc(c.id)}" data-pages="${c.n_paginas}"><p class="muted">${t("loading")}</p></div>`
      : `<h2>${t("m_topb")}</h2>${c.top.length ? `<div class="table-wrap"><table><tbody>${c.top.map((b) => `<tr data-k="${esc(b.nif || b.nombre)}"><td>${esc(b.nombre)}<div class="t-sub">${esc(b.nif || "")}</div></td><td class="num">${eur(b.importe)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">${t("none")}</p>`}`}
    ${explainBlock("s", "s:" + c.id, c, c.nivel3 || c.nivel2, c.nivel1 === "ESTADO")}
    <h2>${t("m_signal")}</h2>
    <a class="btn-sm" href="${issueUrl(c)}" target="_blank" rel="noopener">${t("m_signal_btn")} ↗</a>
    ${shareBlock(t("share_s").replace("{o}", prettyOrg(c.nivel3 || c.nivel2)).replace("{i}", eurShort(c.importe)).replace("{t}", oneLine(c.titulo, 90)) + (c.flags.length ? ` (${shareFlags(c.flags, "flag_")})` : "") + ". " + t("share_tail"), "#/proyecto/" + c.id)}`);
  if (c.n_paginas) convBenefPage(0);
}

// Lista completa de beneficiarios de una convocatoria, 200 por página, cargadas bajo demanda
async function convBenefPage(i) {
  const box = $("#cb-list");
  if (!box) return;
  const id = box.dataset.conv, pages = Number(box.dataset.pages);
  i = Math.max(0, Math.min(pages - 1, i));
  box.innerHTML = `<p class="muted">${t("loading")}</p>`;
  const rows = await fetch(`data/convocatorias/benef/${id}/${i}.json`).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  if (!$("#cb-list") || $("#cb-list").dataset.conv !== id) return;
  const pager = pages > 1 ? `<div class="pager"><button type="button" data-bp="${i - 1}" ${i === 0 ? "disabled" : ""}>${t("prev")}</button>
    <span>${t("page")} ${i + 1} / ${num(pages)}</span><button type="button" data-bp="${i + 1}" ${i >= pages - 1 ? "disabled" : ""}>${t("next")}</button></div>` : "";
  box.innerHTML = `${pager}<div class="table-wrap"><table><tbody>${rows.map(([nombre, nif, imp, n], k) => `<tr data-k="${esc(nif || nombre)}">
    <td class="muted">${num(i * 200 + k + 1)}</td><td>${esc(nombre)}<div class="t-sub">${esc(nif)}${n > 1 ? ` · ${num(n)} ${t("k_concesiones")}` : ""}</div></td><td class="num">${eur(imp)}</td></tr>`).join("")}</tbody></table></div>${pager}`;
  if (i > 0 || pages > 1) box.scrollIntoView({ block: "start" });
}

// ---------- Compartir ----------
function shareBlock(text, path) {
  const url = location.origin + location.pathname + path;
  const e = encodeURIComponent, full = text + " " + url;
  return `<div class="share" data-url="${esc(url)}" data-text="${esc(text)}"><span class="sub">${t("share")}</span>
    <a class="btn-sm" href="https://bsky.app/intent/compose?text=${e(full)}" target="_blank" rel="noopener">Bluesky</a>
    <a class="btn-sm" href="https://twitter.com/intent/tweet?text=${e(text)}&url=${e(url)}" target="_blank" rel="noopener">X</a>
    <a class="btn-sm" href="https://wa.me/?text=${e(full)}" target="_blank" rel="noopener">WhatsApp</a>
    <a class="btn-sm" href="https://t.me/share/url?url=${e(url)}&text=${e(text)}" target="_blank" rel="noopener">Telegram</a>
    <button type="button" class="btn-sm copylink">${t("share_copy")}</button></div>`;
}
const shareFlags = (flags, pref) => (flags || []).slice(0, 2).map((f) => t(pref + f).toLowerCase()).join(", ");

function openModal(html) {
  const tit = (html.match(/<h3>([\s\S]*?)<\/h3>/) || [])[1];
  if (tit) html += `<p class="err-link"><a href="${corrUrl(location.href, tit.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&"))}" target="_blank" rel="noopener">${t("corr_link")} ↗</a></p>`;
  $("#modal-body").innerHTML = html;
  const m = $("#modal");
  if (!m.open) m.showModal();
  m.scrollTop = 0;
}

function viewMethod() {
  const li = (list, pref) => list.map((f) => `<li><b>${esc(t(pref + "_" + f))}</b> — ${esc(t(pref + "d_" + f))}</li>`).join("");
  const repo = "https://github.com/xBuneZ/nextgen-es/blob/main/docs/METODOLOGIA.md";
  if (lang === "es") return `<div class="prose"><h1>Metodología</h1>
    <p>Todo lo que muestra esta web sale de registros oficiales y se puede comprobar: cada ficha enlaza a su expediente original. El código es abierto y la <a href="${repo}" target="_blank" rel="noopener">metodología detallada</a> está en el repositorio.</p>
    <h2>Fuentes</h2><ul>
      <li><b>Subvenciones:</b> <a href="https://www.infosubvenciones.es" target="_blank" rel="noopener">Base de Datos Nacional de Subvenciones (BDNS)</a>. Todas las convocatorias marcadas como financiadas por el Mecanismo de Recuperación y Resiliencia, con todas sus concesiones.</li>
      <li><b>Contratos:</b> datos abiertos de la <a href="https://contrataciondelsectorpublico.gob.es" target="_blank" rel="noopener">Plataforma de Contratación del Sector Público</a>, incluidas las plataformas autonómicas que agrega (Cataluña, Andalucía, País Vasco, Madrid, Galicia, Navarra, La Rioja…). Se incluyen los contratos con código de financiación PRTR o que mencionan el Plan de Recuperación.</li>
      <li><b>Lo asignado a España:</b> Comisión Europea, propuesta COM(2026) 435.</li></ul>
    <h2>Cómo se cuentan las cifras</h2><ul>
      <li>La cifra principal de subvenciones es lo concedido <b>a fondo perdido a empresas, entidades y personas</b>. Lo transferido a administraciones se muestra aparte, porque a menudo lo vuelven a repartir y sumarlo contaría dos veces el mismo dinero. Los avales y préstamos también van aparte, porque se devuelven.</li>
      <li>«Concedido» y «adjudicado» son importes publicados, no pagos efectivos. Los contratos se dan sin IVA.</li>
      <li>En los acuerdos marco con varios adjudicatarios, si la suma publicada supera el presupuesto, el contrato computa por su presupuesto (cada adjudicatario suele figurar con el valor máximo del acuerdo).</li>
      <li>Las concesiones a <b>personas físicas</b> solo se muestran agregadas.</li>
      <li>Si una actualización llega incompleta (faltan meses o los datos caen más de un 5 %), no se publica y se mantienen los datos anteriores.</li></ul>
    <h2>Indicadores en subvenciones</h2><ul>${li(FLAGS, "flag")}</ul>
    <h2>Indicadores en contratos</h2><ul>${li(CFLAGS, "cflag")}</ul>
    <p>Son reglas automáticas, inspiradas en metodologías de riesgo de la OCDE y la Comisión Europea. <b>Un indicador no implica irregularidad</b>: hay mercados con pocos proveedores y concesiones directas previstas por ley. Sirven para decidir qué mirar.</p>
    <h2>Ranking de organismos</h2>
    <p>Porcentaje del importe adjudicado sin competencia real (un solo licitador, negociado sin publicidad o emergencia), comparado con la media. Por defecto aparecen organismos con 20 o más contratos y se excluyen los medios propios (TRAGSA, INECO…), cuyo funcionamiento no es comparable.</p>
    <h2>Qué no cubre</h2><ul><li>Contratos menores, pagos realmente ejecutados y fondos que las administraciones no hayan publicado o marcado como Plan de Recuperación.</li></ul>
    <h2>Correcciones</h2><p>Si encuentras un error, <a href="https://github.com/${REPO}/issues/new" target="_blank" rel="noopener">avísanos</a>. Las correcciones se publican.</p></div>`;
  return `<div class="prose"><h1>Methodology</h1>
    <p>Everything on this site comes from official registries and can be checked: each record links to its original file. The code is open source and the <a href="${repo}" target="_blank" rel="noopener">detailed methodology</a> (in Spanish) is in the repository.</p>
    <h2>Sources</h2><ul>
      <li><b>Grants:</b> Spain's <a href="https://www.infosubvenciones.es" target="_blank" rel="noopener">National Grants Database (BDNS)</a>. Every call flagged as funded by the Recovery and Resilience Facility, with all its awards.</li>
      <li><b>Contracts:</b> open data from the <a href="https://contrataciondelsectorpublico.gob.es" target="_blank" rel="noopener">Public Sector Procurement Platform</a>, including the regional platforms it aggregates (Catalonia, Andalusia, Basque Country, Madrid, Galicia, Navarre, La Rioja…). Contracts with the PRTR funding code or mentioning the Recovery Plan are included.</li>
      <li><b>Spain's allocation:</b> European Commission, proposal COM(2026) 435.</li></ul>
    <h2>How figures are counted</h2><ul>
      <li>The headline grants figure is what was granted <b>as non-repayable aid to companies, organisations and individuals</b>. Transfers to public administrations are shown separately because they are often re-granted, and adding them would count the same money twice. Guarantees and loans are also separate, because they are repaid.</li>
      <li>"Granted" and "awarded" are published amounts, not actual payments. Contracts exclude VAT.</li>
      <li>In framework agreements with several winners, if the published sum exceeds the budget, the contract counts for its budget (each winner is usually recorded with the agreement's full ceiling).</li>
      <li>Awards to <b>private individuals</b> are only shown in aggregate.</li>
      <li>If an update arrives incomplete (missing months, or data dropping by more than 5%), it is not published and the previous data stays online.</li></ul>
    <h2>Grant indicators</h2><ul>${li(FLAGS, "flag")}</ul>
    <h2>Contract indicators</h2><ul>${li(CFLAGS, "cflag")}</ul>
    <p>These are automatic rules inspired by OECD and European Commission risk methodologies. <b>An indicator does not imply wrongdoing</b>: some markets have few suppliers and some direct grants are set by law. They help decide what to look at.</p>
    <h2>Ranking of bodies</h2>
    <p>Share of the awarded amount without real competition (single bidder, negotiated without notice or emergency), compared with the average. By default it shows bodies with 20+ contracts and excludes in-house entities (TRAGSA, INECO…), whose activity is not comparable.</p>
    <h2>Not covered</h2><ul><li>Minor contracts, amounts actually paid, and funds that administrations did not publish or flag as Recovery Plan.</li></ul>
    <h2>Corrections</h2><p>If you find an error, <a href="https://github.com/${REPO}/issues/new" target="_blank" rel="noopener">let us know</a>. Corrections are published.</p></div>`;
}

function viewReport() {
  return lang === "es" ? `<div class="prose"><h1>¿Sospechas de fraude o corrupción?</h1>
    <p>Esta web no investiga ni acusa: muestra datos públicos. Si tienes <b>indicios concretos</b> de fraude con fondos europeos, los canales oficiales son:</p><ul>
      <li><b>Servicio Nacional de Coordinación Antifraude (SNCA)</b> — canal Infofraude de la IGAE (Ministerio de Hacienda), específico para fondos europeos.</li>
      <li><b>Fiscalía Europea (EPPO)</b> — competente para delitos contra el presupuesto de la UE: <a href="https://www.eppo.europa.eu/en/reporting-crime-eppo" target="_blank" rel="noopener">eppo.europa.eu</a>.</li>
      <li><b>OLAF</b>, Oficina Europea de Lucha contra el Fraude: <a href="https://anti-fraud.ec.europa.eu/olaf-and-you/report-fraud_en" target="_blank" rel="noopener">anti-fraud.ec.europa.eu</a>.</li>
      <li>La <b>Autoridad Independiente de Protección del Informante</b> y los canales internos de cada administración (Ley 2/2023).</li></ul>
    <p>Si crees que un proyecto merece atención pública, puedes <b>proponerlo para revisión</b> desde su ficha. Aporta hechos y fuentes verificables.</p></div>`
  : `<div class="prose"><h1>Suspect fraud or corruption?</h1>
    <p>This site does not investigate or accuse anyone: it shows public data. If you have <b>concrete evidence</b> of fraud involving EU funds, the official channels are:</p><ul>
      <li><b>European Public Prosecutor's Office (EPPO)</b> — competent for crimes against the EU budget: <a href="https://www.eppo.europa.eu/en/reporting-crime-eppo" target="_blank" rel="noopener">eppo.europa.eu</a>.</li>
      <li><b>OLAF</b>, the European Anti-Fraud Office: <a href="https://anti-fraud.ec.europa.eu/olaf-and-you/report-fraud_en" target="_blank" rel="noopener">anti-fraud.ec.europa.eu</a>.</li>
      <li>Spain's <b>National Anti-Fraud Coordination Service (SNCA)</b>, part of the Ministry of Finance (IGAE), with a dedicated channel for EU funds.</li></ul>
    <p>If you think a project deserves public attention, you can <b>submit it for review</b> from its detail page. Please provide verifiable facts and sources.</p></div>`;
}


// ---------- Contratos públicos (PLACSP) ----------
const CFLAGS = ["licitador_unico", "sin_baja", "ganador_recurrente", "plazo_corto", "negociado_sin_publicidad", "emergencia", "supera_presupuesto"];
const CT = { data: null, loading: null };
const cstate = { q: "", proc: "", flag: "", ambito: "", page: 0, sort: "importe", dir: -1 };

// Índice ligero (listado, búsqueda y ranking) + textos aparte + detalle en trozos
function loadContratos() {
  if (!CT.loading) {
    CT.loading = fetch("data/contratos/indice.json").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return null;
      const D = d.dic, C = d.cols, emp = D.emp.map(([nombre, nif]) => ({ nombre, nif }));
      CT.byId = new Map();
      CT.n = d.n_trozos;
      d.contratos = C.id.map((cid, i) => {
        const [organo, ambito, ruta] = D.org[C.org[i]];
        const c = { _i: i, cid, exp: C.exp[i], objeto: "", organo, ambito, ruta, proc: D.proc[C.proc[i]],
          adj: C.emp[i].map((k) => emp[k]), importe: C.imp[i], fecha: C.fecha[i], ofertas: C.of[i],
          flags: D.flags.filter((_, b) => C.fl[i] & (1 << b)) };
        CT.byId.set(cid, c);
        return c;
      });
      CT.data = d;
      return d;
    }).catch(() => null);
  }
  return CT.loading;
}

function loadTextos() {
  if (!CT.textos) {
    CT.textos = loadContratos().then((d) => d && fetch("data/contratos/textos.json").then((r) => r.json()).then((tx) => {
      d.contratos.forEach((c, i) => { c.objeto = c.objeto || tx[i] || ""; c._s = norm([c.objeto, c.organo, c.exp, c.ruta, ...c.adj.map((a) => a.nombre + " " + a.nif)].join(" ")); });
      return d;
    })).catch(() => CT.data);
  }
  return CT.textos;
}

function trozoDe(cid) {
  let h = 0x811c9dc5;
  for (let i = 0; i < cid.length; i++) { h ^= cid.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return String(h % CT.n).padStart(2, "0");
}
const TROZOS = new Map();
function loadDetalle(c) {
  const k = trozoDe(c.cid);
  if (!TROZOS.has(k)) TROZOS.set(k, fetch(`data/contratos/det/${k}.json`).then((r) => r.json()).catch(() => ({})));
  return TROZOS.get(k).then((t) => {
    const d = t[c.cid];
    if (d && !c._det) Object.assign(c, d, { _det: true });
    c.url = c.url || "https://contrataciondelestado.es/wps/poc?uri=deeplink:detalle_licitacion&idEvl=" + encodeURIComponent(c.cid);
    return c;
  });
}
const cflagTags = (flags) => (flags || []).map((f) => `<span class="tag" data-f="${f}" title="${esc(t("cflagd_" + f))}">${esc(t("cflag_" + f))}</span>`).join("");

function viewContratos() {
  const d = CT.data;
  if (!d) return `<h1>${t("contracts_title")}</h1><p class="notice">${t("contracts_none")}</p>`;
  const T = d.totales, I = d.indicadores;
  const procs = d.por_procedimiento.map((p) => p.nombre).filter((p) => p && p !== "?");
  const ambitos = [...new Set(d.contratos.map((c) => c.ambito).filter(Boolean))].sort();
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`;
  const pct = (n) => (T.adjudicados ? Math.round((100 * n) / T.adjudicados) : 0);
  return `<div class="hero"><h1>${t("contracts_title")}</h1><p class="lead">${esc(t("contracts_lead"))}</p></div>
  <div class="kpis">
    <div class="kpi"><b>${eurShort(T.importe)}</b><span>${t("c_awarded_total")}</span></div>
    <div class="kpi"><b>${num(T.adjudicados)}</b><span>${t("c_awarded_n")}</span></div>
    <div class="kpi"><b>${pct(I.licitador_unico || 0)}%</b><span>${t("cflag_licitador_unico")}</span></div>
    <div class="kpi"><b>${num(I.negociado_sin_publicidad || 0)}</b><span>${t("cflag_negociado_sin_publicidad")}</span></div>
  </div>
  <div class="filters">
    <input type="search" id="cq" placeholder="${esc(t("search_contracts"))}" value="${esc(cstate.q)}">
    <select id="cambito">${opt("", t("all_admins"), cstate.ambito)}${ambitos.map((a) => opt(a, a, cstate.ambito)).join("")}</select>
    <select id="cproc">${opt("", t("all_types"), cstate.proc)}${procs.map((p) => opt(p, p, cstate.proc)).join("")}</select>
  </div>
  ${chipBar("cchips", CFLAGS, "cflag", I, cstate.flag)}
  <div id="cresults"></div>`;
}

function renderContratos() {
  syncHash("#/contratos", { q: cstate.q, proc: cstate.proc, ambito: cstate.ambito, flag: cstate.flag });
  const q = norm(cstate.q);
  const rows = CT.data.contratos.filter((c) => (!q || c._s.includes(q)) && (!cstate.proc || c.proc === cstate.proc) &&
    (!cstate.ambito || c.ambito === cstate.ambito) &&
    flagMatch(c.flags, cstate.flag));
  const k = cstate.sort, d = cstate.dir;
  rows.sort((a, b) => ((a[k] ?? 0) > (b[k] ?? 0) ? d : (a[k] ?? 0) < (b[k] ?? 0) ? -d : 0));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  cstate.page = Math.min(cstate.page, pages - 1);
  const th = (key, l, cls = "") => `<th class="${cls}" data-sort="${key}">${esc(l)}${cstate.sort === key ? (cstate.dir < 0 ? " ↓" : " ↑") : ""}</th>`;
  $("#cresults").innerHTML = `<p class="count">${num(rows.length)} ${t("results")} · ${eur(rows.reduce((s, r) => s + r.importe, 0))}</p>
  <div class="table-wrap"><table><thead><tr>${th("objeto", t("c_object"))}${th("fecha", t("c_date"), "hide-sm")}${th("ofertas", t("c_offers"), "num hide-sm")}${th("importe", t("c_awarded"), "num")}</tr></thead>
  <tbody>${rows.slice(cstate.page * PAGE, (cstate.page + 1) * PAGE).map((c) => `<tr data-ci="${encodeURIComponent(c.cid)}">
    <td class="t-title">${esc(c.objeto)}<div class="t-sub">${esc(c.adj[0] ? c.adj[0].nombre : "—")} · ${esc(c.organo)}</div>${cflagTags(c.flags)}</td>
    <td class="hide-sm">${esc(c.fecha)}</td><td class="num hide-sm">${c.ofertas ?? "—"}</td><td class="num">${eur(c.importe)}</td></tr>`).join("")}</tbody></table></div>
  ${pager(pages, cstate.page)}`;
}

function bindContratos() {
  if (!CT.data) return;
  const upd = () => { cstate.page = 0; renderContratos(); };
  $("#cq").addEventListener("input", (e) => { cstate.q = e.target.value; upd(); });
  const setFlag = (v) => { cstate.flag = v; $("#cchips").outerHTML = chipBar("cchips", CFLAGS, "cflag", CT.data.indicadores, v); bindChips(); upd(); };
  const bindChips = () => $("#cchips").addEventListener("click", (e) => { const b = e.target.closest("button[data-f]"); if (b) setFlag(b.dataset.f ? toggleFlag(cstate.flag, b.dataset.f) : ""); });
  bindChips();
  [["cproc", "proc"], ["cambito", "ambito"]].forEach(([id, k]) => $("#" + id).addEventListener("input", (e) => { cstate[k] = e.target.value; upd(); }));
  $("#cresults").addEventListener("click", (e) => {
    const tg = e.target.closest(".tag[data-f]");
    if (tg) { if (!selFlags(cstate.flag).includes(tg.dataset.f)) setFlag(toggleFlag(cstate.flag, tg.dataset.f)); return; }
    const s = e.target.closest("th[data-sort]");
    if (s) { const key = s.dataset.sort; cstate.dir = cstate.sort === key ? -cstate.dir : -1; cstate.sort = key; renderContratos(); return; }
    const p = e.target.closest("button[data-p]");
    if (p) { cstate.page += Number(p.dataset.p); renderContratos(); window.scrollTo(0, 0); return; }
    const tr = e.target.closest("tr[data-ci]");
    if (tr) location.hash = `#/contrato/${tr.dataset.ci}`;
  });
  renderContratos();
}

async function showContrato(id) {
  const c = CT.data && (CT.byId.get(decodeURIComponent(id || "")) || CT.data.contratos[Number(id)]);
  if (!c) return;
  if (!c._det) { openModal(`<p class="muted">${t("loading")}</p>`); await loadDetalle(c); }
  const row = (k, v) => (v ? `<dt>${t(k)}</dt><dd>${v}</dd>` : "");
  openModal(`<h3>${esc(c.objeto)}</h3>
    <p class="muted">${esc(c.organo)}${c.ruta ? " · " + esc(c.ruta) : ""} · ${t("c_exp")} ${esc(c.exp)}</p>
    ${c.flags.length ? `<div class="notice">${c.flags.map((f) => `<b>${esc(t("cflag_" + f))}</b>: ${esc(t("cflagd_" + f))}`).join("<br>")}</div>` : ""}
    <div class="kpis"><div class="kpi"><b>${eur(c.importe)}</b><span>${t("c_awarded")} (${t("no_vat")})</span></div>
      <div class="kpi"><b>${eur(c.presupuesto)}</b><span>${t("c_budget")}</span></div>
      <div class="kpi"><b>${c.ofertas ?? "—"}</b><span>${t("c_offers")}</span></div></div>
    ${c.importe_publicado ? `<p class="sub adj-note">${t("c_adjusted").replace("{x}", eur(c.importe_publicado))}</p>` : ""}
    <dl class="meta">${row("m_type", esc(c.proc))}${row("c_ctype", esc(c.tipo))}${row("m_regions", esc(c.lugar))}
      ${row("c_pub", c.pub ? esc(c.pub) + (c.doue ? " · " + t("c_doue") : "") : "")}
      ${row("c_deadline", c.plazo != null ? `${num(c.plazo)} ${t("c_days")}` : "")}
      ${row("c_date", esc(c.fecha))}
      ${row("c_recurrent", c.recurrente ? `${num(c.recurrente)} ${t("c_recurrent_n")}` : "")}
      ${row("m_official_c", `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc((c.url.match(/^https?:\/\/(?:www\.)?([^/]+)/) || [])[1] || "contrataciondelestado.es")} ↗</a>`)}</dl>
    <h2>${t("c_winners")}</h2>
    ${c.adj.length ? `<div class="table-wrap"><table><tbody>${c.adj.map((a) => `<tr><td>${esc(a.nombre)}<div class="t-sub">${esc(a.nif || "")}</div></td><td class="num">${eur(a.importe)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">${t("none")}</p>`}
    ${explainBlock("c", "c:" + c.cid, c, c.organo, /ESTADO|OTRAS ENTIDADES/.test(c.ambito || ""))}
    ${shareBlock(t("share_c").replace("{o}", prettyOrg(c.organo)).replace("{i}", eurShort(c.importe)).replace("{a}", c.adj[0] ? c.adj[0].nombre : "—") + (c.flags.length ? ` (${shareFlags(c.flags, "cflag_")})` : "") + ". " + t("share_tail"), "#/contrato/" + encodeURIComponent(c.cid))}`);
}


// ---------- Ranking de organismos ----------
const rstate = { tab: "contratos", q: "", amb: "", min: 20, sort: "pctNo", dir: -1, mp: false };
const NOCOMP_C = ["licitador_unico", "negociado_sin_publicidad", "emergencia"];
const NOCOMP_S = ["concesion_directa", "nominativa"];
const RK = {};

function rankContratos() {
  if (RK.c) return RK.c;
  const g = new Map();
  let imp = 0, impNo = 0;
  for (const c of CT.data.contratos) {
    if (!(c.importe > 0) || c.proc === "Encargo a medio propio") continue;
    const k = c.organo || "?";
    let a = g.get(k);
    if (!a) g.set(k, (a = { nombre: k, sub: c.ruta || c.ambito, amb: c.ambito, mp: MEDIO_PROPIO.test(k), n: 0, imp: 0, impNo: 0, uni: 0, neg: 0, plazo: 0, rec: 0 }));
    const no = c.flags.some((f) => NOCOMP_C.includes(f));
    a.n++; a.imp += c.importe; if (no) a.impNo += c.importe;
    if (c.flags.includes("licitador_unico")) a.uni++;
    if (c.flags.includes("negociado_sin_publicidad")) a.neg++;
    if (c.flags.includes("plazo_corto")) a.plazo++;
    if (c.flags.includes("ganador_recurrente")) a.rec++;
    imp += c.importe; if (no) impNo += c.importe;
  }
  const rows = [...g.values()];
  rows.forEach((a) => { a.pctNo = a.imp ? a.impNo / a.imp : 0; a.pctUni = a.uni / a.n; });
  return (RK.c = { rows, avg: imp ? impNo / imp : 0 });
}

function rankSubvenciones() {
  if (RK.s) return RK.s;
  const g = new Map();
  let imp = 0, impNo = 0;
  for (const c of DB.convs) {
    const k = c.nivel3 || c.nivel2 || "?";
    const key = c.nivel2 + "|" + k;
    let a = g.get(key);
    if (!a) g.set(key, (a = { nombre: k, sub: c.nivel2 !== k ? c.nivel2 : c.nivel1, amb: c.nivel1, n: 0, imp: 0, impNo: 0, sinc: 0, sincPres: 0 }));
    const no = c.flags.some((f) => NOCOMP_S.includes(f));
    a.n++; a.imp += c.importe; if (no) a.impNo += c.importe;
    if (c.flags.includes("sin_concesiones")) { a.sinc++; a.sincPres += c.presupuesto; }
    imp += c.importe; if (no) impNo += c.importe;
  }
  const rows = [...g.values()];
  rows.forEach((a) => { a.pctNo = a.imp ? a.impNo / a.imp : 0; });
  return (RK.s = { rows, avg: imp ? impNo / imp : 0 });
}

const pctf = (x) => `${(100 * x).toLocaleString(locale(), { maximumFractionDigits: 0 })}%`;

function viewRanking() {
  const isC = rstate.tab === "contratos";
  if (isC && !CT.data) return `<h1>${t("rank_title")}</h1><p class="notice">${t("contracts_none")}</p>`;
  const R = isC ? rankContratos() : rankSubvenciones();
  const ambs = [...new Set(R.rows.map((r) => r.amb).filter(Boolean))].sort();
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${String(v) === String(cur) ? "selected" : ""}>${esc(l)}</option>`;
  return `<div class="hero"><h1>${t("rank_title")}</h1><p class="lead">${esc(t(isC ? "rank_lead_c" : "rank_lead_s"))}</p></div>
  <div class="tabs" role="tablist">
    <a role="tab" href="#/ranking/contratos" aria-selected="${isC}">${t("nav_contracts")}</a>
    <a role="tab" href="#/ranking/subvenciones" aria-selected="${!isC}">${t("rank_grants")}</a>
  </div>
  <div class="kpis">
    <div class="kpi"><b>${pctf(R.avg)}</b><span>${t(isC ? "rank_avg_c" : "rank_avg_s")}</span></div>
    <div class="kpi"><b>${num(R.rows.length)}</b><span>${t("rank_bodies")}</span></div>
  </div>
  <div class="filters">
    <input type="search" id="rq" placeholder="${esc(t("rank_search"))}" value="${esc(rstate.q)}">
    <select id="ramb">${opt("", t("all_admins"), rstate.amb)}${ambs.map((a) => opt(a, a, rstate.amb)).join("")}</select>
    <select id="rmin" aria-label="${esc(t("rank_min"))}">${[1, 5, 10, 20, 50, 100].map((n) => opt(n, `${t("rank_min")}: ${n}`, rstate.min)).join("")}</select>
    ${isC ? `<label class="chk"><input type="checkbox" id="rmp" ${rstate.mp ? "checked" : ""}> ${t("rank_mp")}</label>` : ""}
  </div>
  <div id="rresults"></div>
  <p class="disclaimer">${esc(t(isC ? "rank_note_c" : "rank_note_s"))}</p>`;
}

function renderRanking() {
  const isC = rstate.tab === "contratos";
  syncHash("#/ranking/" + rstate.tab, { q: rstate.q, amb: rstate.amb, min: rstate.min === 20 ? "" : rstate.min, mp: rstate.mp });
  const R = isC ? rankContratos() : rankSubvenciones();
  const q = norm(rstate.q);
  const rows = R.rows.filter((r) => r.n >= rstate.min && (!rstate.amb || r.amb === rstate.amb) && (rstate.mp || !r.mp) && (!q || norm(r.nombre + " " + r.sub).includes(q)));
  const k = rstate.sort, d = rstate.dir;
  rows.sort((a, b) => (a[k] > b[k] ? d : a[k] < b[k] ? -d : b.imp - a.imp));
  const th = (key, l, cls = "num") => `<th class="${cls}" data-sort="${key}">${esc(l)}${rstate.sort === key ? (rstate.dir < 0 ? " ↓" : " ↑") : ""}</th>`;
  const bar = (r) => `<div class="pbar"><span style="width:${Math.round(100 * r.pctNo)}%"></span></div>
    <span class="sub">${R.avg ? (r.pctNo / R.avg).toLocaleString(locale(), { maximumFractionDigits: 1 }) + "× " + t("rank_vs_avg") : ""}</span>`;
  const cols = isC
    ? `${th("n", t("nav_contracts"), "num hide-sm")}${th("imp", t("c_awarded"))}${th("pctNo", t("rank_pct_c"))}${th("uni", t("cflag_licitador_unico"), "num hide-sm")}${th("neg", t("rank_neg"), "num hide-sm")}${th("rec", t("rank_rec"), "num hide-sm")}`
    : `${th("n", t("k_convs"), "num hide-sm")}${th("imp", t("c_amount"))}${th("pctNo", t("rank_pct_s"))}${th("sinc", t("rank_sinc"), "num hide-sm")}`;
  const cells = (r) => isC
    ? `<td class="num hide-sm">${num(r.n)}</td><td class="num">${eurShort(r.imp)}</td><td class="num"><b>${pctf(r.pctNo)}</b>${bar(r)}</td><td class="num hide-sm">${num(r.uni)}</td><td class="num hide-sm">${num(r.neg)}</td><td class="num hide-sm">${num(r.rec)}</td>`
    : `<td class="num hide-sm">${num(r.n)}</td><td class="num">${eurShort(r.imp)}</td><td class="num"><b>${pctf(r.pctNo)}</b>${bar(r)}</td><td class="num hide-sm">${num(r.sinc)}${r.sinc ? `<span class="sub">${eurShort(r.sincPres)}</span>` : ""}</td>`;
  $("#rresults").innerHTML = `<p class="count">${num(rows.length)} ${t("rank_bodies")}</p>
  <div class="table-wrap"><table><thead><tr><th class="hide-sm">#</th>${th("nombre", t("rank_body"), "")}${cols}</tr></thead>
  <tbody>${rows.slice(0, 200).map((r, i) => `<tr data-org="${esc(r.nombre)}"><td class="hide-sm muted">${i + 1}</td>
    <td class="t-title">${esc(r.nombre)}<div class="t-sub">${esc(r.sub || "")}${r.mp ? ` · <span class="mp">${t("rank_mp_tag")}</span>` : ""}</div></td>${cells(r)}</tr>`).join("")}</tbody></table></div>`;
}

function bindRanking() {
  if (rstate.tab === "contratos" && !CT.data) return;
  $("#rq").addEventListener("input", (e) => { rstate.q = e.target.value; renderRanking(); });
  $("#ramb").addEventListener("input", (e) => { rstate.amb = e.target.value; renderRanking(); });
  $("#rmin").addEventListener("input", (e) => { rstate.min = Number(e.target.value); renderRanking(); });
  if ($("#rmp")) $("#rmp").addEventListener("change", (e) => { rstate.mp = e.target.checked; renderRanking(); });
  $("#rresults").addEventListener("click", (e) => {
    const s = e.target.closest("th[data-sort]");
    if (s) { const key = s.dataset.sort; rstate.dir = rstate.sort === key ? -rstate.dir : -1; rstate.sort = key; renderRanking(); return; }
    const tr = e.target.closest("tr[data-org]");
    if (!tr) return;
    if (rstate.tab === "contratos") location.hash = cHref(tr.dataset.org);
    else location.hash = `#/proyectos?q=${encodeURIComponent(tr.dataset.org)}`;
  });
  renderRanking();
}

// ---------- Pide explicaciones (Ley 19/2013) ----------
const SOL = { data: {} };
fetch("data/solicitudes.json").then((r) => (r.ok ? r.json() : {})).then((d) => { SOL.data = d.solicitudes || {}; }).catch(() => {});

// Nombre reconocible del organismo: "Junta de Gobierno Local del Ayuntamiento de X" -> "Ayuntamiento de X"
function prettyOrg(o) {
  o = String(o || "").replace(/\s+/g, " ").trim();
  let m = o.match(/\(([A-ZÁÉÍÓÚÑ0-9-]{3,})\)\s*$/);
  if (m) return o;
  m = o.match(/\b(Ayuntamiento|Ajuntament|Concello|Udala|Diputaci[oó]n?|Cabildo|Consell|Mancomunidad|Comarca)\b.*/i);
  if (m) return m[0];
  return o.replace(/^(Presidencia|Alcald[ií]a|Junta de Gobierno( Local)?|Pleno|Consejo de Administraci[oó]n|Consejo Rector|Direcci[oó]n Gerencia|Gerencia|Secretar[ií]a General|Rectorado)\s+(de la|del|de los|de las|de)\s+/i, "");
}
const oneLine = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).replace(/[ ,.;-]+$/, "") + "…" : s; };

function requestText(kind, c) {
  const L = [];
  const ley = "Ley 19/2013, de 9 de diciembre, de transparencia, acceso a la información pública y buen gobierno (o la normativa autonómica de transparencia que resulte aplicable)";
  if (kind === "c") {
    const adj = c.adj[0] ? c.adj[0].nombre + (c.adj[0].nif ? ` (${c.adj[0].nif})` : "") : "—";
    L.push(`Al amparo de la ${ley}, solicito acceso a la siguiente información relativa al contrato «${oneLine(c.objeto, 250)}» (expediente ${c.exp}), tramitado por ${c.organo}, adjudicado a ${adj} por ${eur(c.importe)} (sin IVA) y financiado con cargo al Plan de Recuperación, Transformación y Resiliencia:`);
    const it = ["Informe de necesidad e idoneidad del contrato y memoria justificativa del expediente.",
      "Pliegos de cláusulas administrativas particulares y de prescripciones técnicas.",
      "Actas de la mesa de contratación e informes de valoración de las ofertas."];
    if (c.flags.includes("licitador_unico") || c.flags.includes("sin_baja")) it.push("Explicación de por qué solo se presentó una oferta y, en su caso, análisis realizado por el órgano de contratación sobre la falta de concurrencia.");
    if (c.flags.includes("negociado_sin_publicidad")) it.push("Justificación jurídica del uso del procedimiento negociado sin publicidad y relación de empresas invitadas a negociar.");
    if (c.flags.includes("plazo_corto")) it.push("Justificación del plazo concedido para la presentación de ofertas.");
    if (c.flags.includes("emergencia")) it.push("Acuerdo de declaración de emergencia y su justificación.");
    it.push("Estado de ejecución: entregables recibidos, actas de recepción, pagos realizados y, en su caso, modificaciones o prórrogas del contrato.",
      "Componente, inversión e hito del Plan de Recuperación al que se imputa el gasto.");
    it.forEach((x, i) => L.push(`${i + 1}. ${x}`));
  } else {
    L.push(`Al amparo de la ${ley}, solicito acceso a la siguiente información relativa a la convocatoria «${oneLine(c.titulo, 250)}» (código BDNS ${c.id}), gestionada por ${c.nivel3 || c.nivel2} (${c.nivel2}) y financiada con cargo al Plan de Recuperación, Transformación y Resiliencia (Mecanismo de Recuperación y Resiliencia):`);
    const it = ["Resoluciones de concesión y relación de beneficiarios con los importes concedidos."];
    if (c.flags.includes("concesion_directa") || c.flags.includes("nominativa")) it.push("Memoria o informe que justifique la concesión directa o nominativa y las razones por las que no se acudió a un procedimiento de concurrencia competitiva.");
    if (c.flags.includes("sin_concesiones")) it.push("Motivo por el que no consta ninguna concesión publicada en la Base de Datos Nacional de Subvenciones.");
    it.push("Justificación del gasto presentada por los beneficiarios e informes de comprobación o control realizados.",
      "Resultados obtenidos, indicadores de seguimiento y componente, inversión e hito del Plan de Recuperación al que se imputa el gasto.");
    it.forEach((x, i) => L.push(`${i + 1}. ${x}`));
  }
  L.push("Solicito que la información se facilite por medios electrónicos.");
  return L.join("\n\n");
}

function explainBlock(kind, ref, c, organo, isAGE) {
  organo = prettyOrg(organo);
  const s = SOL.data[ref];
  const status = s ? `<p class="sol-status">${t("sol_count").replace("{n}", num(s.total))}${s.respondidas ? ` · ${num(s.respondidas)} ${t("sol_answered")}` : ""}${s.vencidas ? ` · <b>${num(s.vencidas)} ${t("sol_overdue")}</b>` : ""}${s.pendientes ? ` · ${num(s.pendientes)} ${t("sol_pending")}` : ""}${s.denegadas ? ` · ${num(s.denegadas)} ${t("sol_denied")}` : ""}</p>
    <ul class="sol-list">${s.items.slice(0, 5).map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(t("sol_state_" + x.estado))}</a>${x.dias != null ? ` · ${num(x.dias)} ${t("c_days")}` : ""}</li>`).join("")}</ul>` : "";
  const where = isAGE
    ? `<a href="https://transparencia.gob.es" target="_blank" rel="noopener">${t("sol_where_age")} ↗</a>`
    : `<a href="https://duckduckgo.com/?q=${encodeURIComponent("portal transparencia solicitud acceso información " + organo)}" target="_blank" rel="noopener">${t("sol_where_other").replace("{o}", esc(organo))} ↗</a>`;
  const issue = `https://github.com/${REPO}/issues/new?template=transparencia.yml&labels=transparencia&title=${encodeURIComponent(`[Transparencia] ${organo.slice(0, 80)}`)}&ref=${encodeURIComponent(ref)}&organismo=${encodeURIComponent(organo)}`;
  return `<section class="explain"><h2>${t("sol_title")}</h2>${status}
    <details><summary class="btn">${t("sol_btn")}</summary>
      <ol class="steps">
        <li>${t("sol_step1")}<textarea class="req" readonly rows="10">${esc(requestText(kind, c))}</textarea>
          <button type="button" class="btn-sm copy">${t("sol_copy")}</button></li>
        <li>${t("sol_step2")} ${where}<span class="sub">${t("sol_deadline")}</span></li>
        <li>${t("sol_step3")} <a href="${issue}" target="_blank" rel="noopener">${t("sol_register")} ↗</a><span class="sub">${t("sol_privacy")}</span></li>
      </ol>
    </details></section>`;
}


// ---------- Enlaces que conservan los filtros ----------
const qsOf = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== "" && v != null && v !== false) p.set(k, v === true ? "1" : v); const x = p.toString(); return x ? "?" + x : ""; };
const cHref = (q) => "#/contratos" + qsOf({ q });
function syncHash(base, o) { history.replaceState(null, "", base + qsOf(o)); }

// ---------- Índice completo de beneficiarios (todas las entidades, en trozos) ----------
const BIDX = { man: null, shards: new Map() };
const BSTOP = new Set("sl sa slu sau sll slne scoop coop sccl cb sc de del la las los el y e i en para por sociedad limitada anonima unipersonal cooperativa laboral profesional and the of".split(" "));
function bidxShard(man, nq) {
  const compact = nq.replace(/[^a-z0-9]/g, "");
  if (/^[a-z]?\d{6,}[a-z0-9]?$/.test(compact) || /^[a-z]\d{3,}/.test(compact)) {
    const k = compact.slice(1, 3);
    return man.n.includes(k) ? "n_" + k : null;
  }
  const words = nq.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !BSTOP.has(w));
  if (!words.length) return null;
  const w = words.sort((a, b) => b.length - a.length)[0];
  const keys = BIDX.keys || (BIDX.keys = new Set(man.w));
  for (let n = Math.min(5, w.length); n >= 2; n--) if (keys.has(w.slice(0, n))) return "w_" + w.slice(0, n);
  return null;
}
async function benefSearch(q) {
  const nq = norm(q).trim();
  if (nq.length < 3) return [];
  if (!BIDX.man) BIDX.man = fetch("data/benef_idx/indice.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const man = await BIDX.man;
  const k = man && bidxShard(man, nq);
  if (!k) return [];
  if (!BIDX.shards.has(k)) BIDX.shards.set(k, fetch(`data/benef_idx/${k}.json`).then((r) => (r.ok ? r.json() : [])).catch(() => []));
  const rows = await BIDX.shards.get(k);
  const nqc = nq.replace(/\s+/g, "");
  return rows.filter((r) => norm(r[1]).includes(nq) || (r[0] && r[0].toLowerCase().includes(nqc)));
}
// Fila del índice -> objeto como los de la lista de empresas (fusionando sus contratos si los tiene)
function bidxToEmp(r) {
  const key = r[0] || r[1];
  const e = EMP.byKey && EMP.byKey.get(String(key).toUpperCase());
  const base = e ? { ...e } : { key, nombre: r[1], nif: r[0], con: 0, ncon: 0, nno: 0, impno: 0, orgs: [], pctNo: -1 };
  Object.assign(base, { sub: r[2], nsub: r[3], convs: r[4] });
  base.total = base.sub + (base.con || 0);
  return base;
}
function mergeEmp(list, extra) {
  const seen = new Set(list.map((e) => String(e.key).toUpperCase()));
  return list.concat(extra.map(bidxToEmp).filter((e) => !seen.has(String(e.key).toUpperCase())));
}

// ---------- Empresas: subvenciones + contratos ----------
const MEDIO_PROPIO = /\bM\.\s?P\.|medio propio|\bTRAGSA|TRAGSATEC/i;
const EMP = { loading: null, rows: null };
function loadEmpresas() {
  if (!EMP.loading) {
    EMP.loading = fetch("data/contratos/empresas.json").then((r) => (r.ok ? r.json() : [])).catch(() => []).then((list) => {
      const m = new Map();
      for (const b of DB.benef) {
        const k = (b.nif || b.nombre).toUpperCase();
        m.set(k, { key: b.nif || b.nombre, nombre: b.nombre, nif: b.nif || "", sub: b.importe, nsub: b.n_convs, con: 0, ncon: 0, nno: 0, impno: 0, orgs: [] });
      }
      for (const [nif, nombre, n, imp, nno, impno, orgs] of list) {
        const k = (nif || nombre).toUpperCase();
        const e = m.get(k) || { key: nif || nombre, nombre, nif, sub: 0, nsub: 0 };
        Object.assign(e, { con: imp, ncon: n, nno, impno, orgs });
        m.set(k, e);
      }
      EMP.rows = [...m.values()];
      EMP.rows.forEach((e) => { e.total = e.sub + e.con; e.pctNo = e.con ? e.impno / e.con : -1; e._s = norm(e.nombre + " " + e.nif); });
      EMP.byKey = new Map(EMP.rows.map((e) => [String(e.key).toUpperCase(), e]));
      return EMP.rows;
    });
  }
  return EMP.loading;
}

let bState = { q: "", page: 0, sort: "total", dir: -1, tipo: "" };
function viewBenef() {
  return `<div class="hero"><h1>${t("benef_title")}</h1><p class="lead">${esc(t("benef_lead"))}</p></div>
  <div id="tipos-box"></div>
  <div class="filters"><input type="search" id="bq" placeholder="${esc(t("search_benef"))}" value="${esc(bState.q)}">
    <select id="btipo"><option value="">${t("tipos_all")}</option></select></div>
  <p class="muted" style="font-size:13px">${num(DB.resumen.totales.personas_fisicas_n)} ${t("k_concesiones")} (${eur(DB.resumen.totales.personas_fisicas_importe)}) → ${t("pf_note")}</p>
  <div id="bresults"><p class="muted">${t("loading")}</p></div>`;
}
function renderBenefRows() {
  syncHash("#/beneficiarios", { q: bState.q, tipo: bState.tipo });
  const q = norm(bState.q);
  const base = bState.tipo ? tipoRows(bState.tipo) : EMP.rows;
  const rows = mergeEmp(base.filter((b) => !q || b._s.includes(q)), q.length >= 3 ? bState.extra || [] : [])
    .filter((b) => !bState.tipo || tipoDe(b.nif) === bState.tipo);
  const k = bState.sort, d = bState.dir;
  rows.sort((a, b) => (a[k] > b[k] ? d : a[k] < b[k] ? -d : 0));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  bState.page = Math.min(bState.page, pages - 1);
  const th = (key, l, cls = "num") => `<th class="${cls}" data-sort="${key}">${esc(l)}${bState.sort === key ? (bState.dir < 0 ? " ↓" : " ↑") : ""}</th>`;
  $("#bresults").innerHTML = `<p class="count">${num(rows.length)} ${t("results")}</p>
  <div class="table-wrap"><table><thead><tr>${th("nombre", t("c_name"), "")}${th("sub", t("b_grants"), "num hide-sm")}${th("con", t("b_contracts"), "num hide-sm")}${th("pctNo", t("b_nocomp"), "num hide-sm")}${th("total", t("b_total"))}</tr></thead>
  <tbody>${rows.slice(bState.page * PAGE, (bState.page + 1) * PAGE).map((b) => `<tr data-k="${esc(b.key)}">
    <td class="t-title">${esc(b.nombre)}<div class="t-sub">${esc(b.nif || "")}</div></td>
    <td class="num hide-sm">${b.sub ? eurShort(b.sub) : "—"}</td>
    <td class="num hide-sm">${b.con ? eurShort(b.con) + `<span class="sub">${num(b.ncon)} ${t("b_n_contracts")}</span>` : "—"}</td>
    <td class="num hide-sm">${b.pctNo >= 0 ? pctf(b.pctNo) : "—"}</td>
    <td class="num"><b>${eurShort(b.total)}</b></td></tr>`).join("")}</tbody></table></div>
  ${pager(pages, bState.page)}`;
}
function bindBenef() {
  loadEmpresas().then(() => {
    if (!$("#bresults")) return;
    const refresh = () => {
      const q0 = bState.q;
      bState.extra = [];
      benefSearch(q0).then((rows) => { if (bState.q === q0 && $("#bresults")) { bState.extra = rows; renderBenefRows(); } });
    };
    $("#bq").addEventListener("input", (e) => { bState.q = e.target.value; bState.page = 0; renderBenefRows(); refresh(); });
    loadTipos().then((d) => {
      if (!d || !$("#btipo")) return;
      $("#btipo").innerHTML = `<option value="">${t("tipos_all")}</option>` + d.tipos.map((x) => `<option value="${x.id}" ${bState.tipo === x.id ? "selected" : ""}>${esc(lang === "es" ? x.nombre : x.en)}</option>`).join("");
      $("#tipos-box").innerHTML = tiposCard();
      const setT = (v) => { bState.tipo = v; bState.page = 0; $("#btipo").value = v; $("#tipos-box").innerHTML = tiposCard(); renderBenefRows(); };
      $("#btipo").addEventListener("input", (e) => setT(e.target.value));
      $("#tipos-box").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-tipo]"); if (tr) setT(bState.tipo === tr.dataset.tipo ? "" : tr.dataset.tipo); });
      renderBenefRows();
    });
    refresh();
    $("#bresults").addEventListener("click", (e) => {
      const s = e.target.closest("th[data-sort]");
      if (s) { const key = s.dataset.sort; bState.dir = bState.sort === key ? -bState.dir : -1; bState.sort = key; renderBenefRows(); return; }
      const p = e.target.closest("button[data-p]");
      if (p) { bState.page += Number(p.dataset.p); renderBenefRows(); window.scrollTo(0, 0); return; }
      const tr = e.target.closest("tr[data-k]");
      if (tr) location.hash = `#/beneficiario/${encodeURIComponent(tr.dataset.k)}`;
    });
    renderBenefRows();
  });
}

async function showBenef(key) {
  openModal(`<p class="muted">${t("loading")}</p>`);
  await loadEmpresas();
  const e = EMP.byKey.get(String(key).toUpperCase());
  let b = DB.benef.find((x) => (x.nif || x.nombre) === key);
  if (!b) {
    const r = (await benefSearch(key)).find((x) => String(x[0] || x[1]).toUpperCase() === String(key).toUpperCase());
    if (r) b = { nombre: r[1], nif: r[0], importe: r[2], n_convs: r[3], convs: r[4] };
  }
  if (!e && !b) return openModal(`<p class="muted">${t("none")}</p>`);
  const nombre = (e || b).nombre, nif = (e || b).nif || "";
  const grants = b ? b.convs.map(([id, imp]) => {
    const c = DB.convById.get(String(id));
    return `<tr data-id="${esc(id)}"><td>${esc(c ? c.titulo : id)}<div class="t-sub">${esc(c ? c.nivel2 : "")}</div>${c ? flagTags(c.flags) : ""}</td><td class="num">${eur(imp)}</td></tr>`;
  }).join("") : "";
  openModal(`<h3>${esc(nombre)}</h3><p class="muted">${esc(nif)}</p>
    <div class="kpis">
      <div class="kpi"><b>${eurShort(e ? e.total : b.importe)}</b><span>${t("b_total")}</span></div>
      <div class="kpi"><b>${eurShort(b ? b.importe : 0)}</b><span>${t("b_grants")} · ${num(b ? b.n_convs : 0)} ${t("k_convs")}</span></div>
      <div class="kpi"><b>${eurShort(e ? e.con : 0)}</b><span>${t("b_contracts")} · ${num(e ? e.ncon : 0)}</span></div>
      ${e && e.con ? `<div class="kpi"><b>${pctf(e.pctNo)}</b><span>${t("b_nocomp_long")}</span></div>` : ""}
    </div>
    ${grants ? `<h2>${t("m_convs")}</h2><div class="table-wrap"><table><tbody>${grants}</tbody></table></div>` : ""}
    <div id="b-contr">${e && e.con ? `<h2>${t("b_contracts_won")}</h2><p class="muted">${t("loading")}</p>` : ""}</div>
    ${shareBlock(t("share_b").replace("{n}", nombre).replace("{i}", eurShort(e ? e.total : b.importe)) + (e && e.con ? " " + t("share_b_nc").replace("{p}", pctf(e.pctNo)) : "") + " " + t("share_tail"), "#/beneficiario/" + encodeURIComponent(key))}`);
  if (e && e.con) {
    await loadContratos();
    const k = (nif || nombre).toUpperCase();
    const mine = CT.data.contratos.filter((c) => c.adj.some((a) => (a.nif || a.nombre).toUpperCase() === k)).sort((x, y) => y.importe - x.importe);
    const box = $("#b-contr");
    if (box) box.innerHTML = `<h2>${t("b_contracts_won")}</h2><div class="table-wrap"><table><tbody>${mine.slice(0, 40).map((c) => `<tr data-cid="${encodeURIComponent(c.cid)}">
      <td>${esc(c.objeto || c.exp)}<div class="t-sub">${[c.organo, c.fecha, c.adj.length > 1 ? t("b_shared") : ""].filter(Boolean).map(esc).join(" · ")}</div>${cflagTags(c.flags)}</td><td class="num">${eur(c.importe)}</td></tr>`).join("")}</tbody></table></div>
      ${mine.length > 40 ? `<p class="sub">${t("b_more").replace("{n}", num(mine.length - 40))}</p>` : ""}`;
  }
}

// ---------- Buscador global ----------
function viewSearch(q) {
  return `<div class="hero"><h1>${t("search_title")}: «${esc(q)}»</h1></div><div id="sres"><p class="muted">${t("loading")}</p></div>`;
}
async function runSearch(q) {
  const nq = norm(q);
  const box = () => $("#sres");
  const sec = (title, n, items, more) => `<section class="card sres"><div class="card-head"><h2>${esc(title)} <span class="muted">${num(n)}</span></h2>${n && more ? more : ""}</div>${n ? `<ul class="slist">${items}</ul>` : `<p class="muted">${t("search_none")}</p>`}</section>`;
  await loadEmpresas();
  const bRows = await benefSearch(q);
  const ids = new Set(bRows.flatMap((r) => r[4].map(([id]) => String(id))));
  const projs = DB.convs.filter((c) => c._s.includes(nq) || ids.has(String(c.id))).sort((a, b) => b.importe - a.importe);
  const emps = mergeEmp(EMP.rows.filter((e) => e._s.includes(nq)), bRows).sort((a, b) => b.total - a.total);
  const render = (contr, orgs) => {
    if (!box()) return;
    box().innerHTML = `<div class="cols">
      <div class="col">${sec(t("nav_benef"), emps.length, emps.slice(0, 8).map((e) => `<li><a href="#/beneficiario/${encodeURIComponent(e.key)}">${esc(e.nombre)}</a><span>${eurShort(e.total)}</span></li>`).join(""), `<a class="btn-sm" href="#/beneficiarios${qsOf({ q })}">${t("see_all")}</a>`)}
        ${sec(t("search_orgs"), orgs ? orgs.length : 0, (orgs || []).slice(0, 8).map((o) => `<li><a href="${cHref(o.nombre)}">${esc(o.nombre)}</a><span>${num(o.n)} ${t("b_n_contracts")}</span></li>`).join(""), "")}</div>
      <div class="col">${sec(t("nav_projects"), projs.length, projs.slice(0, 8).map((c) => `<li><a href="#/proyecto/${c.id}">${esc(oneLine(c.titulo, 110))}</a><span>${eurShort(c.importe)}</span></li>`).join(""), `<a class="btn-sm" href="#/proyectos?q=${encodeURIComponent(q)}">${t("see_all")}</a>`)}</div>
      <div class="col">${contr ? sec(t("nav_contracts"), contr.length, contr.slice(0, 8).map((c) => `<li><a href="#/contrato/${encodeURIComponent(c.cid)}">${esc(oneLine(c.objeto, 110))}</a><span>${eurShort(c.importe)}</span></li>`).join(""), `<a class="btn-sm" href="${cHref(q)}">${t("see_all")}</a>`) : `<section class="card sres"><h2>${t("nav_contracts")}</h2><p class="muted">${t("loading")}</p></section>`}</div>
    </div>`;
  };
  render(null, null);
  await loadTextos();
  const contr = CT.data.contratos.filter((c) => c._s.includes(nq)).sort((a, b) => b.importe - a.importe);
  const og = new Map();
  for (const c of CT.data.contratos) if (norm(c.organo).includes(nq)) { const o = og.get(c.organo) || { nombre: c.organo, n: 0 }; o.n++; og.set(c.organo, o); }
  render(contr, [...og.values()].sort((a, b) => b.n - a.n));
}


// ---------- Temas ----------
function viewTemas() {
  const T = DB.temas;
  if (!T) return `<h1>${t("nav_temas")}</h1><p class="notice">${t("contracts_none")}</p>`;
  const nm = (x) => (lang === "es" ? x.nombre : x.en || x.nombre);
  const max = Math.max(...T.oficiales.map((x) => x.importe), 1);
  return `<div class="hero"><h1>${t("temas_title")}</h1><p class="lead">${esc(t("temas_lead"))}</p></div>
  <h2 class="sect">${t("temas_trans")}</h2>
  <div class="tema-grid">${T.transversales.map((x) => `<section class="card tema">
    <div class="card-head"><h2>${esc(nm(x))}</h2><a class="btn-sm" href="#/proyectos?tema=${x.id}">${t("see_projects")}</a></div>
    <p class="big">${eurShort(x.importe)} <small>${pctf(x.pct)} ${t("temas_of_total")}</small></p>
    <p class="sub">${num(x.n)} ${t("k_convs")} · ${eurShort(x.importe_asoc_fund)} ${t("temas_to_assoc")}</p>
    <ol class="tema-top">${x.top.slice(0, 5).map((r) => `<li><a href="#/beneficiario/${encodeURIComponent(r[1] || r[0])}">${esc(r[0])}</a><span>${eurShort(r[2])}</span></li>`).join("")}</ol>
  </section>`).join("")}</div>
  <h2 class="sect">${t("temas_official")}</h2>
  <section class="card"><p class="sub">${esc(t("temas_official_note"))}</p><div class="hbars">${T.oficiales.map((x) => `<a href="#/proyectos?fin=${encodeURIComponent(x.nombre)}"><span class="hl"><span>${esc(x.nombre)}</span><span class="sub">${eurShort(x.importe)} · ${pctf(x.pct)}</span></span>
    <span class="track"><span style="width:${(100 * x.importe) / max}%;background:var(--c1)"></span></span></a>`).join("")}</div></section>
  <p class="disclaimer">${t("temas_method")} <a href="https://github.com/${REPO}/blob/main/etl/temas.json" target="_blank" rel="noopener">etl/temas.json ↗</a></p>`;
}

// ---------- Tipos de organización ----------
const TIPOS = { data: null, loading: null };
function loadTipos() {
  if (!TIPOS.loading) TIPOS.loading = fetch("data/tipos.json").then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => (TIPOS.data = d));
  return TIPOS.loading;
}
const tipoDe = (nif) => {
  const l = (nif || "").slice(0, 1).toUpperCase();
  const t = TIPOS.data && TIPOS.data.tipos.find((x) => l && x.letras.includes(l));
  return t ? t.id : "otras";
};
function tiposCard() {
  const d = TIPOS.data;
  if (!d) return "";
  const nm = (x) => (lang === "es" ? x.nombre : x.en);
  return `<section class="card tipos-card"><div class="card-head"><h2>${t("tipos_title")}</h2></div>
    <div class="table-wrap flat"><table><thead><tr><th>${t("tipos_type")}</th><th class="num">${t("b_grants")}</th><th class="num hide-sm">${t("tipos_n")}</th><th class="num">${t("b_contracts")}</th></tr></thead>
    <tbody>${d.tipos.filter((x) => x.sub_importe || x.con_importe).map((x) => `<tr data-tipo="${x.id}" class="${bState.tipo === x.id ? "sel" : ""}"><td>${esc(nm(x))}</td><td class="num">${eurShort(x.sub_importe)}</td><td class="num hide-sm">${num(x.sub_n)}</td><td class="num">${eurShort(x.con_importe)}</td></tr>`).join("")}
    <tr class="muted"><td>${t("tb_pf")}</td><td class="num">${eurShort(d.personas_fisicas.importe)}</td><td class="num hide-sm">${num(d.personas_fisicas.n)} ${t("k_concesiones")}</td><td class="num">—</td></tr></tbody></table></div></section>`;
}
function tipoRows(id) {
  const tt = TIPOS.data && TIPOS.data.tipos.find((x) => x.id === id);
  if (!tt) return [];
  const m = new Map();
  for (const e of EMP.rows) if (tipoDe(e.nif) === id) m.set(String(e.key).toUpperCase(), e);
  const add = (nombre, nif, imp, n, kind) => {
    const k = String(nif || nombre).toUpperCase();
    if (m.has(k)) return;
    const e = { key: nif || nombre, nombre, nif, sub: 0, nsub: 0, con: 0, ncon: 0, nno: 0, impno: 0, pctNo: -1 };
    if (kind === "s") Object.assign(e, { sub: imp, nsub: n }); else Object.assign(e, { con: imp, ncon: n });
    e.total = e.sub + e.con; e._s = norm(nombre + " " + nif);
    m.set(k, e);
  };
  tt.sub_top.forEach(([n, nif, imp, k]) => add(n, nif, imp, k, "s"));
  tt.con_top.forEach(([n, nif, imp, k]) => add(n, nif, imp, k, "c"));
  return [...m.values()];
}

// ---------- Cadena del dinero ----------
const CAD = { data: null, loading: null };
const cadState = { q: "", tipo: "locales", sort: "sin_rastro", dir: -1 };
const CAD_LOCALES = ["ayuntamiento", "comarca", "diputacion", "cabildo", "mancomunidad", "local"];
function loadCadena() {
  if (!CAD.loading) CAD.loading = fetch("data/cadena.json").then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => {
    if (d) { d.byNif = new Map(d.entidades.map((e) => [e.nif, e])); d.entidades.forEach((e) => { e._s = norm(e.nombre + " " + e.nif); e.pct = e.recibido ? e.sin_rastro / e.recibido : 0; }); }
    return (CAD.data = d);
  });
  return CAD.loading;
}
function viewCadena() {
  const opt = (v, l) => `<option value="${v}" ${cadState.tipo === v ? "selected" : ""}>${esc(l)}</option>`;
  return `<div class="hero"><h1>${t("cad_title")}</h1><p class="lead">${esc(t("cad_lead"))}</p></div>
  ${cadTabs("cadena")}
  <div class="notice">${t("cad_caveat")}</div>
  <div class="filters">
    <input type="search" id="kq" placeholder="${esc(t("cad_search"))}" value="${esc(cadState.q)}">
    <select id="ktipo">${opt("locales", t("cad_t_locales"))}${["ayuntamiento", "comarca", "diputacion", "cabildo", "mancomunidad", "ccaa", "organismo"].map((k) => opt(k, t("cad_t_" + k))).join("")}${opt("", t("cad_t_all"))}</select>
  </div>
  <div id="kresults"><p class="muted">${t("loading")}</p></div>`;
}
function renderCadena() {
  syncHash("#/cadena", { q: cadState.q, tipo: cadState.tipo === "locales" ? "" : cadState.tipo || "todas" });
  const q = norm(cadState.q);
  const rows = CAD.data.entidades.filter((e) => (!q || e._s.includes(q)) &&
    (cadState.tipo === "locales" ? CAD_LOCALES.includes(e.tipo) : !cadState.tipo || e.tipo === cadState.tipo));
  const k = cadState.sort, d = cadState.dir;
  rows.sort((a, b) => (a[k] > b[k] ? d : a[k] < b[k] ? -d : 0));
  const th = (key, l, cls = "num") => `<th class="${cls}" data-sort="${key}">${esc(l)}${cadState.sort === key ? (cadState.dir < 0 ? " ↓" : " ↑") : ""}</th>`;
  const tot = rows.reduce((s, e) => s + e.sin_rastro, 0);
  $("#kresults").innerHTML = `<p class="count">${num(rows.length)} ${t("cad_entities")} · ${eurShort(tot)} ${t("cad_no_trace_total")}</p>
  <div class="table-wrap"><table><thead><tr>${th("nombre", t("cad_entity"), "")}${th("recibido", t("cad_received"))}${th("repartido", t("cad_granted"), "num hide-sm")}${th("contratado", t("cad_contracted"), "num hide-sm")}${th("sin_rastro", t("cad_no_trace"))}</tr></thead>
  <tbody>${rows.slice(0, 300).map((e) => `<tr data-nif="${esc(e.nif)}"><td class="t-title">${esc(e.nombre)}<div class="t-sub">${esc(e.nif)} · ${t("cad_t_" + e.tipo)}</div></td>
    <td class="num">${eurShort(e.recibido)}</td><td class="num hide-sm">${e.repartido ? eurShort(e.repartido) : "—"}</td><td class="num hide-sm">${e.contratado ? eurShort(e.contratado) : "—"}</td>
    <td class="num"><b>${eurShort(e.sin_rastro)}</b><span class="sub">${pctf(e.pct)} ${t("cad_of_received")}</span></td></tr>`).join("")}</tbody></table></div>
  ${rows.length > 300 ? `<p class="sub">${t("cad_more")}</p>` : ""}`;
}
function bindCadena() {
  loadCadena().then((d) => {
    if (!$("#kresults")) return;
    if (!d) { $("#kresults").innerHTML = `<p class="notice">${t("contracts_none")}</p>`; return; }
    $("#kq").addEventListener("input", (e) => { cadState.q = e.target.value; renderCadena(); });
    $("#ktipo").addEventListener("input", (e) => { cadState.tipo = e.target.value; renderCadena(); });
    $("#kresults").addEventListener("click", (e) => {
      const s = e.target.closest("th[data-sort]");
      if (s) { const key = s.dataset.sort; cadState.dir = cadState.sort === key ? -cadState.dir : -1; cadState.sort = key; renderCadena(); return; }
      const tr = e.target.closest("tr[data-nif]");
      if (tr) location.hash = `#/entidad/${encodeURIComponent(tr.dataset.nif)}`;
    });
    renderCadena();
  });
}
async function showEntidad(nif) {
  openModal(`<p class="muted">${t("loading")}</p>`);
  const d = await loadCadena();
  const e = d && d.byNif.get(decodeURIComponent(nif));
  if (!e) return openModal(`<p class="muted">${t("none")}</p>`);
  const conv = (id) => DB.convById.get(String(id));
  const lst = (rows, fn) => rows.length ? `<div class="table-wrap"><table><tbody>${rows.map(fn).join("")}</tbody></table></div>` : `<p class="muted">${t("cad_none_pub")}</p>`;
  const txt = `Al amparo de la Ley 19/2013, de 9 de diciembre, de transparencia, acceso a la información pública y buen gobierno (o la normativa autonómica aplicable), solicito a ${prettyOrg(e.nombre)} (NIF ${e.nif}) información sobre el destino de los fondos del Plan de Recuperación, Transformación y Resiliencia (Mecanismo de Recuperación y Resiliencia) recibidos en las siguientes convocatorias, por un importe total publicado en la Base de Datos Nacional de Subvenciones de ${eur(e.recibido)}:\n\n${e.recibidas.map(([id, imp]) => `- BDNS ${id}: ${oneLine((conv(id) || {}).titulo || "", 160)} (${eur(imp)})`).join("\n")}\n\nEn concreto, solicito:\n\n1. Relación de gastos, contratos, convenios, encargos y subvenciones concedidas con cargo a dichos fondos, con sus perceptores finales e importes.\n2. Gastos de personal propio imputados a estos fondos.\n3. Importe ejecutado, pagado y pendiente de ejecución a fecha de hoy, y en su caso reintegros.\n4. Motivo por el que dichos gastos no constan publicados en la BDNS o en la Plataforma de Contratación del Sector Público con la marca del Plan de Recuperación.\n\nSolicito que la información se facilite por medios electrónicos.`;
  openModal(`<h3>${esc(e.nombre)}</h3><p class="muted">${esc(e.nif)} · ${t("cad_t_" + e.tipo)}</p>
    <div class="kpis">
      <div class="kpi"><b>${eurShort(e.recibido)}</b><span>${t("cad_received")}</span></div>
      <div class="kpi"><b>${eurShort(e.repartido)}</b><span>${t("cad_granted")}</span></div>
      <div class="kpi"><b>${eurShort(e.contratado)}</b><span>${t("cad_contracted")}</span></div>
      <div class="kpi warn"><b>${eurShort(e.sin_rastro)}</b><span>${t("cad_no_trace")}</span></div>
    </div>
    <p class="sub">${esc(d.nota)}</p>
    <h2>1. ${t("cad_h_received")}</h2>${lst(e.recibidas, ([id, imp]) => `<tr data-id="${esc(id)}"><td>${esc((conv(id) || {}).titulo || id)}<div class="t-sub">${esc((conv(id) || {}).nivel3 || "")}</div></td><td class="num">${eur(imp)}</td></tr>`)}
    <h2>2. ${t("cad_h_granted")}</h2>${lst(e.propias, ([id, imp]) => `<tr data-id="${esc(id)}"><td>${esc((conv(id) || {}).titulo || id)}</td><td class="num">${eur(imp)}</td></tr>`)}
    <h2>3. ${t("cad_h_contracted")}</h2>${lst(e.contratos, ([cid, imp, adj]) => `<tr data-cid="${encodeURIComponent(cid)}"><td>${esc(adj || "—")}</td><td class="num">${eur(imp)}</td></tr>`)}
    <section class="explain"><h2>${t("sol_title")}</h2><details><summary class="btn">${t("sol_btn")}</summary>
      <ol class="steps"><li>${t("sol_step1")}<textarea class="req" readonly rows="12">${esc(txt)}</textarea><button type="button" class="btn-sm copy">${t("sol_copy")}</button></li>
      <li>${t("sol_step2")} <a href="https://duckduckgo.com/?q=${encodeURIComponent("portal transparencia solicitud acceso información " + prettyOrg(e.nombre))}" target="_blank" rel="noopener">${t("sol_where_other").replace("{o}", esc(prettyOrg(e.nombre)))} ↗</a><span class="sub">${t("sol_deadline")}</span></li></ol></details></section>
    ${shareBlock(t("share_cad").replace("{o}", prettyOrg(e.nombre)).replace("{r}", eurShort(e.recibido)).replace("{s}", eurShort(e.sin_rastro)) + " " + t("share_tail"), "#/entidad/" + encodeURIComponent(e.nif))}`);
  // las filas de convocatorias abren su ficha
}


// ---------- Lo que España declara a Bruselas ----------
const PAISES_ES = { Austria: "Austria", Belgium: "Bélgica", Bulgaria: "Bulgaria", Croatia: "Croacia", Cyprus: "Chipre", Czechia: "Chequia",
  Denmark: "Dinamarca", Estonia: "Estonia", Finland: "Finlandia", France: "Francia", Germany: "Alemania", Greece: "Grecia", Hungary: "Hungría",
  Ireland: "Irlanda", Italy: "Italia", Latvia: "Letonia", Lithuania: "Lituania", Luxembourg: "Luxemburgo", Malta: "Malta", Netherlands: "Países Bajos",
  Poland: "Polonia", Portugal: "Portugal", Romania: "Rumanía", Slovakia: "Eslovaquia", Slovenia: "Eslovenia", Spain: "España", Sweden: "Suecia" };
const paisNom = (p) => (lang === "es" ? PAISES_ES[p] || p : p);
const pagoNom = (s) => (lang === "es" ? String(s).replace(/(\d+)(st|nd|rd|th) Payment/, "$1.º pago").replace("Pre-Financing", "Prefinanciación").replace(/\(Part (\d+)\)/, "($1.ª parte)") : s);
const BRU = { data: null, loading: null };
const bruState = { sort: "declarado", dir: -1, solo: false, q: "" };
function loadBruselas() {
  if (!BRU.loading) BRU.loading = fetch("data/bruselas.json").then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => {
    if (d) { d.byNif = new Map(d.perceptores.map((e) => [e.nif, e])); d.perceptores.forEach((e) => { e.publicado = Math.max(e.recibido, e.contratado); e.pct = e.declarado ? e.sin_rastro / e.declarado : 0; e._s = norm(e.nombre + " " + e.nif); }); }
    return (BRU.data = d);
  });
  return BRU.loading;
}
const cadTabs = (cur) => `<div class="tabs" role="tablist"><a role="tab" href="#/cadena" aria-selected="${cur === "cadena"}">${t("cad_tab_local")}</a><a role="tab" href="#/bruselas" aria-selected="${cur === "bruselas"}">${t("bru_tab")}</a></div>`;
function viewBruselas() {
  const d = BRU.data;
  if (!d) return `${cadTabs("bruselas")}<p class="notice">${t("contracts_none")}</p>`;
  const asign = d.asignado_subvenciones;
  const fecha = (s) => new Date(s).toLocaleDateString(locale(), { year: "numeric", month: "short" });
  const maxP = Math.max(...d.pagos.map((p) => p[3]), 1);
  const top = d.paises.slice(0, 10), maxC = Math.max(...top.map((p) => p.subvenciones), 1);
  return `<div class="hero"><h1>${t("bru_title")}</h1><p class="lead">${esc(t("bru_lead"))}</p></div>
  ${cadTabs("bruselas")}
  <div class="kpis">
    <div class="kpi"><b>${eurShort(d.pagado_subvenciones)}</b><span>${t("bru_paid_grants")}${asign ? ` · ${pctf(d.pagado_subvenciones / asign)} ${t("of")} ${eurShort(asign)} ${t("bru_allocated")}` : ""}</span></div>
    <div class="kpi"><b>${eurShort(d.pagado_prestamos)}</b><span>${t("bru_paid_loans")}</span></div>
    <div class="kpi"><b>${eurShort(d.declarado_total)}</b><span>${t("bru_top100_decl")}</span></div>
    <div class="kpi warn"><b>${pctf(d.con_rastro_total / d.declarado_total)}</b><span>${t("bru_trace_pct").replace("{s}", eurShort(d.declarado_total - d.con_rastro_total))}</span></div>
  </div>
  <div class="cols">
    <div class="col">${card(t("bru_payments"), t("bru_payments_sub"), `<ul class="pay">${d.pagos.slice().reverse().map((p) => `<li class="${p[1] === "Loans" ? "loan" : ""}"><span class="pd">${fecha(p[0])}</span><span class="pl">${esc(pagoNom(p[2]))} · ${t(p[1] === "Loans" ? "bru_loan" : "bru_grant")}</span>
      <span class="pb"><span style="width:${(100 * p[3]) / maxP}%"></span></span><b>${eurShort(p[3])}</b></li>`).join("")}</ul>`)}</div>
    <div class="col">${card(t("bru_eu"), t("bru_eu_sub"), `<ul class="pay">${top.map((p) => `<li class="${p.pais === "Spain" ? "es" : ""}"><span class="pl">${esc(paisNom(p.pais))}</span>
      <span class="pb"><span style="width:${(100 * p.subvenciones) / maxC}%"></span></span><b>${eurShort(p.subvenciones)}</b></li>`).join("")}</ul>`)}</div>
  </div>
  <h2 class="sect">${t("bru_top100")}</h2>
  <div class="notice">${t("bru_caveat")}</div>
  <div class="filters"><input type="search" id="uq" placeholder="${esc(t("rank_search"))}" value="${esc(bruState.q)}">
    <label class="chk"><input type="checkbox" id="usolo" ${bruState.solo ? "checked" : ""}> ${t("bru_only_gap")}</label></div>
  <div id="uresults"></div>
  <p class="disclaimer">${t("bru_source")} <a href="${esc(d.fuente)}" target="_blank" rel="noopener">Recovery and Resilience Scoreboard ↗</a></p>`;
}
function renderBruselas() {
  const q = norm(bruState.q);
  const rows = BRU.data.perceptores.filter((e) => (!bruState.solo || e.sin_rastro > 0) && (!q || e._s.includes(q)));
  const k = bruState.sort, d = bruState.dir;
  rows.sort((a, b) => (a[k] > b[k] ? d : a[k] < b[k] ? -d : 0));
  const th = (key, l, cls = "num") => `<th class="${cls}" data-sort="${key}">${esc(l)}${bruState.sort === key ? (bruState.dir < 0 ? " ↓" : " ↑") : ""}</th>`;
  $("#uresults").innerHTML = `<div class="table-wrap"><table><thead><tr>${th("nombre", t("bru_recipient"), "")}${th("declarado", t("bru_declared"))}${th("publicado", t("bru_published"), "num hide-sm")}${th("sin_rastro", t("cad_no_trace"))}${th("confianza", t("bru_conf"), "hide-sm")}</tr></thead>
  <tbody>${rows.map((e) => `<tr data-bnif="${esc(e.nif)}"><td class="t-title">${esc(e.nombre)}<div class="t-sub">${esc(e.nif)}${e.n_contratos ? ` · ${num(e.n_contratos)} ${t("b_n_contracts")}` : ""}</div></td>
    <td class="num">${eurShort(e.declarado)}</td><td class="num hide-sm">${eurShort(e.publicado)}</td>
    <td class="num">${e.sin_rastro ? `<b>${eurShort(e.sin_rastro)}</b><span class="sub">${pctf(e.pct)}</span>` : "—"}</td>
    <td class="hide-sm"><span class="conf c-${esc(e.confianza)}">${esc(t("bru_conf_" + e.confianza) || e.confianza)}</span></td></tr>`).join("")}</tbody></table></div>`;
}
function bindBruselas() {
  if (!BRU.data) return;
  $("#uq").addEventListener("input", (e) => { bruState.q = e.target.value; renderBruselas(); });
  $("#usolo").addEventListener("change", (e) => { bruState.solo = e.target.checked; renderBruselas(); });
  $("#uresults").addEventListener("click", (e) => {
    const s = e.target.closest("th[data-sort]");
    if (s) { const key = s.dataset.sort; bruState.dir = bruState.sort === key ? -bruState.dir : -1; bruState.sort = key; renderBruselas(); return; }
    const tr = e.target.closest("tr[data-bnif]");
    if (tr) location.hash = `#/perceptor/${encodeURIComponent(tr.dataset.bnif)}`;
  });
  renderBruselas();
}
async function showPerceptor(nif) {
  openModal(`<p class="muted">${t("loading")}</p>`);
  const d = await loadBruselas();
  const e = d && d.byNif.get(decodeURIComponent(nif));
  if (!e) return openModal(`<p class="muted">${t("none")}</p>`);
  const txt = `Al amparo de la Ley 19/2013, de 9 de diciembre, de transparencia, acceso a la información pública y buen gobierno, solicito a ${prettyOrg(e.nombre)} (NIF ${e.nif}) información sobre el destino de los ${eur(e.declarado)} que el Gobierno de España ha declarado a la Comisión Europea como recibidos por esta entidad con cargo al Mecanismo de Recuperación y Resiliencia (lista de los 100 mayores perceptores finales, art. 25 bis del Reglamento (UE) 2021/241), en las medidas:\n\n${e.medidas.map((m) => "- " + m).join("\n")}\n\nEn concreto, solicito:\n\n1. Relación de contratos, encargos a medios propios, convenios, subvenciones y gastos de personal financiados con dichos fondos, con sus perceptores e importes.\n2. Importe ejecutado y pagado a fecha de hoy.\n3. Motivo por el que dichos gastos no constan, o constan solo en parte, en la Plataforma de Contratación del Sector Público o en la Base de Datos Nacional de Subvenciones con la marca del Plan de Recuperación.\n\nSolicito que la información se facilite por medios electrónicos.`;
  openModal(`<h3>${esc(e.nombre)}</h3><p class="muted">${esc(e.nif)}</p>
    <div class="kpis">
      <div class="kpi"><b>${eurShort(e.declarado)}</b><span>${t("bru_declared_long")}</span></div>
      <div class="kpi"><b>${eurShort(e.recibido)}</b><span>${t("bru_received_pub")}</span></div>
      <div class="kpi"><b>${eurShort(e.contratado)}</b><span>${t("bru_spent_pub")}</span></div>
      <div class="kpi warn"><b>${eurShort(e.sin_rastro)}</b><span>${t("cad_no_trace")}</span></div>
    </div>
    <p><span class="conf c-${esc(e.confianza)}">${t("bru_conf")}: ${esc(t("bru_conf_" + e.confianza))}</span></p>
    <h2>${t("bru_how")}</h2>
    <dl class="meta">
      ${e.rec_bdns ? `<dt>${t("bru_m_bdns")}</dt><dd>${eur(e.rec_bdns)}</dd>` : ""}
      ${e.rec_contratos ? `<dt>${t("bru_m_adj")}</dt><dd>${eur(e.rec_contratos)}</dd>` : ""}
      ${e.rec_encargos ? `<dt>${t("bru_m_enc")}</dt><dd>${eur(e.rec_encargos)}</dd>` : ""}
      ${Object.entries(e.por_metodo).map(([m, v]) => `<dt>${t("bru_m_" + m)}</dt><dd>${eur(v)}</dd>`).join("")}
      ${e.repartido ? `<dt>${t("bru_m_rep")}</dt><dd>${eur(e.repartido)} <span class="sub">${t("bru_m_rep_note")}</span></dd>` : ""}
    </dl>
    ${e.nota ? `<p class="sub">${esc(e.nota)}</p>` : ""}
    <h2>${t("bru_measures")}</h2><ul class="prose-list">${e.medidas.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>
    <h2>${t("bru_main_contracts")}</h2>${e.contratos.length ? `<div class="table-wrap"><table><tbody>${e.contratos.map(([cid, imp, adj, met, proc]) => `<tr data-cid="${encodeURIComponent(cid)}"><td>${esc(adj || "—")}<div class="t-sub">${esc(proc || "")}${met ? " · " + esc(t("bru_m_" + met)) : ""}</div></td><td class="num">${eur(imp)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">${t("cad_none_pub")}</p>`}
    <section class="explain"><h2>${t("sol_title")}</h2><details><summary class="btn">${t("sol_btn")}</summary>
      <ol class="steps"><li>${t("sol_step1")}<textarea class="req" readonly rows="12">${esc(txt)}</textarea><button type="button" class="btn-sm copy">${t("sol_copy")}</button></li>
      <li>${t("sol_step2")} ${/^[SQ]28/.test(e.nif) || /^MINISTERIO/.test(e.nombre.toUpperCase()) ? `<a href="https://transparencia.gob.es" target="_blank" rel="noopener">${t("sol_where_age")} ↗</a>` : `<a href="https://duckduckgo.com/?q=${encodeURIComponent("portal transparencia solicitud acceso información " + prettyOrg(e.nombre))}" target="_blank" rel="noopener">${t("sol_where_other").replace("{o}", esc(prettyOrg(e.nombre)))} ↗</a>`}<span class="sub">${t("sol_deadline")}</span></li></ol></details></section>
    ${shareBlock(t("share_bru").replace("{o}", prettyOrg(e.nombre)).replace("{d}", eurShort(e.declarado)).replace("{s}", eurShort(e.sin_rastro)) + " " + t("share_tail"), "#/perceptor/" + encodeURIComponent(e.nif))}`);
}


// ---------- Correcciones ----------
const corrUrl = (ref, titulo) => `https://github.com/${REPO}/issues/new?template=correccion.yml&labels=correccion&title=${encodeURIComponent("[Corrección] " + (titulo || "").slice(0, 100))}&ref=${encodeURIComponent(ref)}`;
async function viewCorrecciones() {
  const d = await fetch("data/correcciones.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const lista = (d && d.correcciones) || [];
  const est = (e) => `<span class="conf c-${e === "corregido" ? "alta" : e === "no_procede" ? "—" : "media"}">${t("corr_" + e)}</span>`;
  return `<div class="prose"><h1>${t("corr_title")}</h1>
    <p>${t("corr_intro")}</p>
    <p><a class="btn" href="${corrUrl(location.origin + location.pathname, "")}" target="_blank" rel="noopener">${t("corr_report")} ↗</a></p>
    <p class="sub">${t("corr_how")}</p>
    <h2>${t("corr_log")}</h2>
    ${lista.length ? `<div class="table-wrap flat"><table><tbody>${lista.map((c) => `<tr><td><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.titulo)}</a><div class="t-sub">${esc(c.abierto)}${c.cerrado ? " → " + esc(c.cerrado) : ""}</div></td><td>${est(c.estado)}</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="muted">${t("corr_none")}</p>`}
    <h2>${t("corr_fixed_by_us")}</h2><p>${t("corr_fixed_by_us_txt")} <a href="https://github.com/${REPO}/blob/main/docs/METODOLOGIA.md" target="_blank" rel="noopener">${t("nav_method")} ↗</a></p></div>`;
}

// ---------- Aviso legal ----------
function viewAvisoLegal() {
  const repo = `https://github.com/${REPO}`;
  if (lang !== "es") return `<div class="prose"><h1>Legal notice</h1>
    <p><b>Who runs this site.</b> Next Gen España is a non-profit citizen project for the transparency of NextGenerationEU spending in Spain. It has no commercial activity, no advertising and no relationship with any political party or public administration. Contact: through the <a href="#/correcciones">corrections channel</a> or the <a href="${repo}/issues" target="_blank" rel="noopener">project repository</a>.</p>
    <p><b>Data sources.</b> All figures come from official open data, reused under its conditions (citing the source and update date, without distorting its meaning): Spain's National Grants Database (BDNS/SNPSAP), the Public Sector Procurement Platform (including aggregated regional platforms and in-house commissions) and the European Commission's Recovery and Resilience Scoreboard. Each record links to its original source. The date of the last update is shown at the bottom of every page.</p>
    <p><b>Nature of the information.</b> Indicators, rankings, "no published destination" and "no trace" are automatic calculations on public data, with a public methodology. They are not accusations and do not prove any wrongdoing. Data may contain errors from the sources or from our processing: please report them and we will publish the correction.</p>
    <p><b>Personal data.</b> No personal data of private individuals is published: grants and contracts awarded to natural persons are shown only as "natural person (protected data)", without name or ID. This site uses no cookies, analytics or tracking, collects no visitor data and loads no third-party resources. It is hosted on GitHub Pages (GitHub, Inc.), which processes technical connection data to serve the site. To exercise any right regarding data shown here, use the corrections channel.</p>
    <p><b>Licence.</b> The code is open source (MIT licence). Data belong to their official sources and keep their reuse conditions.</p></div>`;
  return `<div class="prose"><h1>Aviso legal</h1>
    <p><b>Quién está detrás.</b> Next Gen España es un proyecto ciudadano sin ánimo de lucro para la transparencia del gasto de los fondos Next Generation EU en España. No tiene actividad comercial ni publicidad, ni relación con ningún partido político ni administración pública. Contacto: a través del <a href="#/correcciones">canal de correcciones</a> o del <a href="${repo}/issues" target="_blank" rel="noopener">repositorio del proyecto</a>.</p>
    <p><b>Fuentes de los datos.</b> Todas las cifras proceden de datos abiertos oficiales, reutilizados conforme a sus condiciones (citar la fuente y la fecha de actualización, sin desnaturalizar su sentido): el Sistema Nacional de Publicidad de Subvenciones y Ayudas Públicas (BDNS), la Plataforma de Contratación del Sector Público (incluidas las plataformas autonómicas agregadas y los encargos a medios propios) y el Recovery and Resilience Scoreboard de la Comisión Europea. Cada ficha enlaza a su fuente original. La fecha de la última actualización figura al pie de cada página.</p>
    <p><b>Naturaleza de la información.</b> Los indicadores, el ranking, el «sin destino publicado» y el «sin rastro» son cálculos automáticos sobre datos públicos, con metodología pública. No son acusaciones ni prueban irregularidad alguna. Los datos pueden contener errores de las fuentes o de nuestro tratamiento: si encuentras alguno, avísanos y publicaremos la corrección.</p>
    <p><b>Datos personales.</b> No se publican datos personales de particulares: las ayudas y contratos a personas físicas aparecen solo como «persona física (datos protegidos)», sin nombre ni DNI. Esta web no usa cookies, analítica ni seguimiento, no recoge datos de quien la visita y no carga recursos de terceros. Está alojada en GitHub Pages (GitHub, Inc.), que trata datos técnicos de conexión para servir la página. Para ejercer cualquier derecho sobre los datos que aparecen aquí, usa el canal de correcciones.</p>
    <p><b>Licencia.</b> El código es abierto (licencia MIT). Los datos pertenecen a sus fuentes oficiales y conservan sus condiciones de reutilización.</p></div>`;
}

// ---------- Router ----------
function route() {
  const [path, qs] = location.hash.replace(/^#/, "").split("?");
  const parts = (path || "/").split("/").filter(Boolean);
  const app = $("#app");
  const view = parts[0] || "";
  const navView = view === "bruselas" ? "cadena" : view;
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#/" + navView || (a.getAttribute("href") === "#/" && !navView)));

  if (view === "contrato") {
    if (!app.dataset.view) { app.innerHTML = viewHome(); app.dataset.view = "home"; }
    return loadContratos().then(() => showContrato(parts[1]));
  }
  if (view === "perceptor") {
    if (!app.dataset.view) { app.innerHTML = viewHome(); app.dataset.view = "home"; }
    return showPerceptor(parts[1]);
  }
  if (view === "entidad") {
    if (!app.dataset.view) { app.innerHTML = viewHome(); app.dataset.view = "home"; }
    return showEntidad(parts[1]);
  }
  if (view === "proyecto" || view === "beneficiario") {
    if (!app.dataset.view) { app.innerHTML = viewHome(); app.dataset.view = "home"; }
    return view === "proyecto" ? showProject(parts[1]) : showBenef(decodeURIComponent(parts[1] || ""));
  }
  $("#modal").open && $("#modal").close();
  app.dataset.view = view || "home";
  if (view === "proyectos") {
    const p = new URLSearchParams(qs || "");
    for (const k of ["q", "admin", "flag", "tipo", "min", "tema", "fin"]) state[k] = p.get(k) || "";
    state.page = 0;
    app.innerHTML = viewProjects(); bindProjects();
  } else if (view === "beneficiarios") {
    const bp = new URLSearchParams(qs || ""); bState.q = bp.get("q") || ""; bState.tipo = bp.get("tipo") || ""; bState.page = 0;
    app.innerHTML = viewBenef(); bindBenef();
  }
  else if (view === "contratos") {
    const p = new URLSearchParams(qs || "");
    Object.assign(cstate, { q: p.get("q") || "", proc: p.get("proc") || "", ambito: p.get("ambito") || "", flag: p.get("flag") || "", page: 0 });
    app.innerHTML = `<p class="muted">${t("loading")}</p>`;
    loadTextos().then(() => { if (app.dataset.view === "contratos") { app.innerHTML = viewContratos(); bindContratos(); } });
  }
  else if (view === "ranking") {
    rstate.tab = parts[1] === "subvenciones" ? "subvenciones" : "contratos";
    const p = new URLSearchParams(qs || "");
    Object.assign(rstate, { q: p.get("q") || "", amb: p.get("amb") || "", min: Number(p.get("min") || 20), mp: p.get("mp") === "1" });
    const go = () => { if (app.dataset.view === "ranking") { app.innerHTML = viewRanking(); bindRanking(); } };
    if (rstate.tab === "contratos") { app.innerHTML = `<p class="muted">${t("loading")}</p>`; loadContratos().then(go); } else go();
  }
  else if (view === "buscar") {
    const q = new URLSearchParams(qs || "").get("q") || "";
    app.innerHTML = viewSearch(q);
    runSearch(q);
  }
  else if (view === "temas") app.innerHTML = viewTemas();
  else if (view === "bruselas") {
    app.innerHTML = `<p class="muted">${t("loading")}</p>`;
    loadBruselas().then(() => { if (app.dataset.view === "bruselas") { app.innerHTML = viewBruselas(); bindBruselas(); } });
  }
  else if (view === "cadena") {
    const p = new URLSearchParams(qs || "");
    cadState.q = p.get("q") || ""; cadState.tipo = p.get("tipo") === "todas" ? "" : p.get("tipo") || "locales";
    app.innerHTML = viewCadena(); bindCadena();
  }
  else if (view === "metodologia") app.innerHTML = viewMethod();
  else if (view === "aviso-legal") app.innerHTML = viewAvisoLegal();
  else if (view === "correcciones") {
    app.innerHTML = `<p class="muted">${t("loading")}</p>`;
    viewCorrecciones().then((h) => { if (app.dataset.view === "correcciones") app.innerHTML = h; });
  }
  else if (view === "denunciar") app.innerHTML = viewReport();
  else app.innerHTML = viewHome();
  window.scrollTo(0, 0);
}

$("#modal .close").addEventListener("click", () => $("#modal").close());
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") $("#modal").close(); });
let inApp = false;
$("#modal").addEventListener("close", () => {
  const m = location.hash.match(/^#\/(proyecto|beneficiario|contrato|entidad|perceptor)\//);
  if (!m) return;
  if (inApp) history.back();
  else location.hash = m[1] === "contrato" ? "#/contratos" : m[1] === "beneficiario" ? "#/beneficiarios" : m[1] === "entidad" ? "#/cadena" : m[1] === "perceptor" ? "#/bruselas" : "#/proyectos";
});
$("#modal-body").addEventListener("click", (e) => {
  const cl = e.target.closest("button.copylink");
  if (cl) {
    const u = cl.closest(".share").dataset.url;
    (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).catch(() => prompt("", u));
    cl.textContent = t("sol_copied");
    return;
  }
  const bp = e.target.closest("button[data-bp]");
  if (bp) { convBenefPage(Number(bp.dataset.bp)); return; }
  const tk = e.target.closest("#modal-body tr[data-k]");
  if (tk && location.hash.startsWith("#/proyecto/")) { location.hash = `#/beneficiario/${encodeURIComponent(tk.dataset.k)}`; return; }
  const tc = e.target.closest("tr[data-cid]");
  if (tc) { location.hash = `#/contrato/${tc.dataset.cid}`; return; }
  const tp = e.target.closest("#modal-body tr[data-id]");
  if (tp && (location.hash.startsWith("#/beneficiario/") || location.hash.startsWith("#/entidad/"))) { location.hash = `#/proyecto/${tp.dataset.id}`; return; }
  const b = e.target.closest("button.copy");
  if (!b) return;
  const ta = b.parentElement.querySelector("textarea");
  ta.select();
  (navigator.clipboard ? navigator.clipboard.writeText(ta.value) : Promise.reject()).catch(() => document.execCommand("copy"));
  b.textContent = t("sol_copied");
});
$("#lang").addEventListener("click", () => {
  lang = lang === "es" ? "en" : "es";
  try { localStorage.setItem("lang", lang); } catch {}
  applyI18n(); delete $("#app").dataset.view; route();
});
window.addEventListener("hashchange", () => { inApp = true; route(); });
// Accesibilidad: las filas clicables se pueden recorrer con Tab y abrir con Enter
const ROWSEL = "tr[data-id], tr[data-k], tr[data-ci], tr[data-cid], tr[data-org]";
new MutationObserver(() => document.querySelectorAll(ROWSEL).forEach((tr) => { if (!tr.hasAttribute("tabindex")) { tr.tabIndex = 0; tr.setAttribute("role", "link"); } }))
  .observe(document.body, { childList: true, subtree: true });
document.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches(ROWSEL)) { e.preventDefault(); e.target.click(); }
});
$("#hsearch").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("#hq").value.trim();
  if (q) location.hash = `#/buscar?q=${encodeURIComponent(q)}`;
});

load().then(() => { applyI18n(); route(); }).catch((e) => {
  $("#app").innerHTML = `<p class="notice">Error: ${esc(e.message)}</p>`;
});
