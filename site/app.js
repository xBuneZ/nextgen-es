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
const state = { q: "", admin: "", flag: "", tipo: "", min: "", sort: "importe", dir: -1, page: 0 };

async function load() {
  const [r, c, b] = await Promise.all(["resumen", "convocatorias", "beneficiarios"].map((f) => fetch(`data/${f}.json`).then((x) => x.json())));
  DB.resumen = r; DB.convs = c; DB.benef = b;
  for (const x of c) {
    x.ficha_url = `https://www.infosubvenciones.es/bdnstrans/GE/es/convocatorias/${x.id}`;
    DB.convById.set(String(x.id), x);
    x._s = norm([x.titulo, x.nivel2, x.nivel3, x.id, ...x.top.map((b) => b.nombre + " " + (b.nif || ""))].join(" "));
  }
  for (const x of b) x._s = norm(x.nombre + " " + (x.nif || ""));
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

function viewHome() {
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
  <div class="cols">
    <div class="col">
      ${card(t("k_importe_t"), t("by_year"), `<p class="big">${eurShort(T.importe)}</p>
        <p class="delta">${grant ? Math.round((100 * grant.importe) / T.importe) : 0}% ${t("grant_share")}</p>${yearChart(r.por_anio)}`, btn("#/proyectos", t("see_projects")))}
      ${card(t("exec_t"), t("exec_sub"), `<p class="big">${eurShort(T.importe)} <small>${t("of")} ${eurShort(T.presupuesto)}</small></p>
        <div class="seg">${Array.from({ length: 10 }, (_, i) => `<span class="${i < Math.round((10 * T.importe) / T.presupuesto) ? "on" : ""}"></span>`).join("")}</div>`)}
      <h2 class="list-h">${t("top_benef")}</h2>
      <div class="rows">${benef}</div>
      <a class="more" href="#/beneficiarios">${t("see_all")}</a>
    </div>
    <div class="col">
      ${card(t("who_t"), t("who_sub"), bubbles(r.por_tipo_beneficiario || []))}
      ${card(t("what_t"), t("what_sub"), `<div class="hbars">${fines.map((f, k) => `<a href="#/proyectos?q=${encodeURIComponent(f.nombre)}"><span class="hl"><span>${esc(f.nombre)}</span><span class="sub">${eurShort(f.importe)}</span></span>
        <span class="track"><span style="width:${(100 * f.importe) / fmax}%;background:${COLORS[k % 3]}"></span></span></a>`).join("")}</div>`)}
    </div>
    <div class="col">
      ${card(t("nocomp_t"), t("nocomp_sub"), gauge(noComp, T.convocatorias), btn("#/proyectos?flag=concesion_directa", t("see")))}
      <div class="tiles">${tiles}</div>
      ${card(t("cases_t"), "", `<div class="cases">${cases}</div>`)}
    </div>
  </div>
  `;
}

function filteredConvs() {
  const q = norm(state.q), min = Number(state.min) || 0;
  let rows = DB.convs.filter((c) =>
    (!q || c._s.includes(q)) &&
    (!state.admin || c.nivel1 === state.admin) &&
    (!state.tipo || c.tipo === state.tipo) &&
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
  $("#q").addEventListener("input", (e) => { state.q = e.target.value; upd(); });
  ["admin", "tipo", "min"].forEach((id) => $("#" + id).addEventListener("input", (e) => { state[id] = e.target.value; upd(); }));
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
  for (const k of ["q", "admin", "flag", "tipo", "min"]) if (state[k]) p.set(k, state[k]);
  history.replaceState(null, "", `#/proyectos${p.toString() ? "?" + p : ""}`);
}

let bState = { q: "", page: 0 };
function viewBenef() {
  return `<h1>${t("benef_title")}</h1>
  <div class="filters"><input type="search" id="bq" placeholder="${esc(t("search_benef"))}" value="${esc(bState.q)}"></div>
  <p class="muted" style="font-size:13px">${num(DB.resumen.totales.personas_fisicas_n)} ${t("k_concesiones")} (${eur(DB.resumen.totales.personas_fisicas_importe)}) → ${t("pf_note")}</p>
  <div id="bresults"></div>`;
}
function renderBenefRows() {
  const q = norm(bState.q);
  const rows = DB.benef.filter((b) => !q || b._s.includes(q));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const slice = rows.slice(bState.page * PAGE, (bState.page + 1) * PAGE);
  $("#bresults").innerHTML = `<p class="count">${num(rows.length)} ${t("results")}</p>
  <div class="table-wrap"><table><thead><tr><th>${t("c_name")}</th><th class="hide-sm">${t("c_nif")}</th><th class="num hide-sm">${t("c_convs")}</th><th class="num">${t("c_amount")}</th></tr></thead>
  <tbody>${slice.map((b) => `<tr data-k="${esc(b.nif || b.nombre)}"><td>${esc(b.nombre)}</td><td class="hide-sm">${esc(b.nif || "")}</td><td class="num hide-sm">${num(b.n_convs)}</td><td class="num">${eur(b.importe)}</td></tr>`).join("")}</tbody></table></div>
  ${pager(pages, bState.page)}`;
}
function bindBenef() {
  $("#bq").addEventListener("input", (e) => { bState.q = e.target.value; bState.page = 0; renderBenefRows(); });
  $("#bresults").addEventListener("click", (e) => {
    const p = e.target.closest("button[data-p]");
    if (p) { bState.page += Number(p.dataset.p); renderBenefRows(); window.scrollTo(0, 0); return; }
    const tr = e.target.closest("tr[data-k]");
    if (tr) location.hash = `#/beneficiario/${encodeURIComponent(tr.dataset.k)}`;
  });
  renderBenefRows();
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
    <h2>${t("m_topb")}</h2>
    ${c.top.length ? `<div class="table-wrap"><table><tbody>${c.top.map((b) => `<tr data-k="${esc(b.nif || b.nombre)}"><td>${esc(b.nombre)}<div class="t-sub">${esc(b.nif || "")}</div></td><td class="num">${eur(b.importe)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">${t("none")}</p>`}
    ${explainBlock("s", "s:" + c.id, c, c.nivel3 || c.nivel2, c.nivel1 === "ESTADO")}
    <h2>${t("m_signal")}</h2>
    <a class="btn-sm" href="${issueUrl(c)}" target="_blank" rel="noopener">${t("m_signal_btn")} ↗</a>`);
  $("#modal-body").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-k]");
    if (tr) { location.hash = `#/beneficiario/${encodeURIComponent(tr.dataset.k)}`; }
  }, { once: true });
}

function showBenef(key) {
  const b = DB.benef.find((x) => (x.nif || x.nombre) === key);
  if (!b) return;
  openModal(`<h3>${esc(b.nombre)}</h3><p class="muted">${esc(b.nif || "")}</p>
    <div class="kpis"><div class="kpi"><b>${eur(b.importe)}</b><span>${t("c_amount")}</span></div>
      <div class="kpi"><b>${num(b.n)}</b><span>${t("c_n")}</span></div>
      <div class="kpi"><b>${num(b.n_convs)}</b><span>${t("c_convs")}</span></div></div>
    <h2>${t("m_convs")}</h2>
    <div class="table-wrap"><table><tbody>${b.convs.map(([id, imp]) => {
      const c = DB.convById.get(String(id));
      return `<tr data-id="${esc(id)}"><td>${esc(c ? c.titulo : id)}<div class="t-sub">${esc(c ? c.nivel2 : "")}</div>${c ? flagTags(c.flags) : ""}</td><td class="num">${eur(imp)}</td></tr>`;
    }).join("")}</tbody></table></div>`);
  $("#modal-body").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (tr) location.hash = `#/proyecto/${tr.dataset.id}`;
  }, { once: true });
}

function openModal(html) {
  $("#modal-body").innerHTML = html;
  const m = $("#modal");
  if (!m.open) m.showModal();
  m.scrollTop = 0;
}

function viewMethod() {
  const flags = FLAGS.map((f) => `<li><b>${esc(t("flag_" + f))}</b> — ${esc(t("flagd_" + f))}</li>`).join("");
  return lang === "es" ? `<div class="prose"><h1>Metodología</h1>
    <p>Los datos proceden de la <a href="https://www.infosubvenciones.es" target="_blank" rel="noopener">Base de Datos Nacional de Subvenciones (BDNS)</a>, el registro oficial donde todas las administraciones españolas están obligadas a publicar sus convocatorias de ayudas y las concesiones. Se descargan todas las convocatorias marcadas como financiadas por el <b>Mecanismo de Recuperación y Resiliencia (MRR)</b> y, para cada una, todas sus concesiones.</p>
    <h2>Limitaciones</h2><ul>
      <li>Se incluyen <b>subvenciones</b> (BDNS) y <b>contratos públicos</b> (Plataforma de Contratación del Sector Público; metodología detallada en el repositorio). Los contratos menores y las transferencias entre administraciones fuera de la BDNS aún no están incluidos.</li>
      <li>Si una administración no marca correctamente la financiación MRR o no publica sus concesiones, no aparece aquí.</li>
      <li>Las concesiones a <b>personas físicas</b> se agregan y no se muestran de forma individual por protección de datos.</li>
      <li>El importe "concedido" es lo publicado en la BDNS, no lo efectivamente pagado.</li></ul>
    <h2>Indicadores</h2><p>Son reglas automáticas y transparentes, inspiradas en metodologías de riesgo en contratación pública (p. ej. las de la OCDE y la Comisión Europea). <b>Un indicador no implica irregularidad</b>: muchas concesiones directas o nominativas son perfectamente legales. Sirven para priorizar qué mirar.</p><ul>${flags}</ul>
    <p>El código es abierto: cualquiera puede verificar cómo se calcula cada cifra.</p></div>`
  : `<div class="prose"><h1>Methodology</h1>
    <p>Data comes from Spain's <a href="https://www.infosubvenciones.es" target="_blank" rel="noopener">National Grants Database (BDNS)</a>, the official registry where every Spanish administration must publish its grant calls and awards. We download every call flagged as funded by the <b>Recovery and Resilience Facility (RRF)</b> and all of its awards.</p>
    <h2>Limitations</h2><ul>
      <li><b>Grants</b> (BDNS) and <b>public contracts</b> (Public Sector Procurement Platform; detailed methodology in the repository) are covered. Minor contracts and transfers between administrations outside the BDNS are not yet included.</li>
      <li>If an administration does not flag RRF funding correctly or does not publish its awards, it will not appear here.</li>
      <li>Awards to <b>private individuals</b> are aggregated and not shown individually, for data protection.</li>
      <li>"Awarded" is the amount published in the BDNS, not the amount actually paid.</li></ul>
    <h2>Indicators</h2><p>Automatic, transparent rules inspired by red-flag methodologies for public spending (e.g. OECD and European Commission). <b>An indicator does not imply wrongdoing</b>: many direct or named grants are entirely legal. They help prioritise what to look at.</p><ul>${flags}</ul>
    <p>The code is open source: anyone can check how each figure is computed.</p></div>`;
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
    <dl class="meta">${row("m_type", esc(c.proc))}${row("c_ctype", esc(c.tipo))}${row("m_regions", esc(c.lugar))}
      ${row("c_pub", c.pub ? esc(c.pub) + (c.doue ? " · " + t("c_doue") : "") : "")}
      ${row("c_deadline", c.plazo != null ? `${num(c.plazo)} ${t("c_days")}` : "")}
      ${row("c_date", esc(c.fecha))}
      ${row("c_recurrent", c.recurrente ? `${num(c.recurrente)} ${t("c_recurrent_n")}` : "")}
      ${row("m_official_c", `<a href="${esc(c.url)}" target="_blank" rel="noopener">contrataciondelestado.es ↗</a>`)}</dl>
    <h2>${t("c_winners")}</h2>
    ${c.adj.length ? `<div class="table-wrap"><table><tbody>${c.adj.map((a) => `<tr><td>${esc(a.nombre)}<div class="t-sub">${esc(a.nif || "")}</div></td><td class="num">${eur(a.importe)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">${t("none")}</p>`}
    ${explainBlock("c", "c:" + c.cid, c, c.organo, /ESTADO|OTRAS ENTIDADES/.test(c.ambito || ""))}`);
}


// ---------- Ranking de organismos ----------
const rstate = { tab: "contratos", q: "", amb: "", min: 20, sort: "pctNo", dir: -1 };
const NOCOMP_C = ["licitador_unico", "negociado_sin_publicidad", "emergencia"];
const NOCOMP_S = ["concesion_directa", "nominativa"];
const RK = {};

function rankContratos() {
  if (RK.c) return RK.c;
  const g = new Map();
  let imp = 0, impNo = 0;
  for (const c of CT.data.contratos) {
    if (!(c.importe > 0)) continue;
    const k = c.organo || "?";
    let a = g.get(k);
    if (!a) g.set(k, (a = { nombre: k, sub: c.ruta || c.ambito, amb: c.ambito, n: 0, imp: 0, impNo: 0, uni: 0, neg: 0, plazo: 0, rec: 0 }));
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
  </div>
  <div id="rresults"></div>
  <p class="disclaimer">${esc(t(isC ? "rank_note_c" : "rank_note_s"))}</p>`;
}

function renderRanking() {
  const isC = rstate.tab === "contratos";
  const R = isC ? rankContratos() : rankSubvenciones();
  const q = norm(rstate.q);
  const rows = R.rows.filter((r) => r.n >= rstate.min && (!rstate.amb || r.amb === rstate.amb) && (!q || norm(r.nombre + " " + r.sub).includes(q)));
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
    <td class="t-title">${esc(r.nombre)}<div class="t-sub">${esc(r.sub || "")}</div></td>${cells(r)}</tr>`).join("")}</tbody></table></div>`;
}

function bindRanking() {
  if (rstate.tab === "contratos" && !CT.data) return;
  $("#rq").addEventListener("input", (e) => { rstate.q = e.target.value; renderRanking(); });
  $("#ramb").addEventListener("input", (e) => { rstate.amb = e.target.value; renderRanking(); });
  $("#rmin").addEventListener("input", (e) => { rstate.min = Number(e.target.value); renderRanking(); });
  $("#rresults").addEventListener("click", (e) => {
    const s = e.target.closest("th[data-sort]");
    if (s) { const key = s.dataset.sort; rstate.dir = rstate.sort === key ? -rstate.dir : -1; rstate.sort = key; renderRanking(); return; }
    const tr = e.target.closest("tr[data-org]");
    if (!tr) return;
    if (rstate.tab === "contratos") { Object.assign(cstate, { q: tr.dataset.org, proc: "", ambito: "", flag: "", page: 0 }); location.hash = "#/contratos"; }
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

// ---------- Router ----------
function route() {
  const [path, qs] = location.hash.replace(/^#/, "").split("?");
  const parts = (path || "/").split("/").filter(Boolean);
  const app = $("#app");
  const view = parts[0] || "";
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#/" + view || (a.getAttribute("href") === "#/" && !view)));

  if (view === "contrato") {
    if (!app.dataset.view) { app.innerHTML = viewHome(); app.dataset.view = "home"; }
    return loadContratos().then(() => showContrato(parts[1]));
  }
  if (view === "proyecto" || view === "beneficiario") {
    if (!app.dataset.view) { app.innerHTML = viewHome(); app.dataset.view = "home"; }
    return view === "proyecto" ? showProject(parts[1]) : showBenef(decodeURIComponent(parts[1] || ""));
  }
  $("#modal").open && $("#modal").close();
  app.dataset.view = view || "home";
  if (view === "proyectos") {
    const p = new URLSearchParams(qs || "");
    for (const k of ["q", "admin", "flag", "tipo", "min"]) state[k] = p.get(k) || "";
    state.page = 0;
    app.innerHTML = viewProjects(); bindProjects();
  } else if (view === "beneficiarios") { app.innerHTML = viewBenef(); bindBenef(); }
  else if (view === "contratos") {
    app.innerHTML = `<p class="muted">${t("loading")}</p>`;
    loadTextos().then(() => { if (app.dataset.view === "contratos") { app.innerHTML = viewContratos(); bindContratos(); } });
  }
  else if (view === "ranking") {
    rstate.tab = parts[1] === "subvenciones" ? "subvenciones" : "contratos";
    const go = () => { if (app.dataset.view === "ranking") { app.innerHTML = viewRanking(); bindRanking(); } };
    if (rstate.tab === "contratos") { app.innerHTML = `<p class="muted">${t("loading")}</p>`; loadContratos().then(go); } else go();
  }
  else if (view === "metodologia") app.innerHTML = viewMethod();
  else if (view === "denunciar") app.innerHTML = viewReport();
  else app.innerHTML = viewHome();
  window.scrollTo(0, 0);
}

$("#modal .close").addEventListener("click", () => $("#modal").close());
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") $("#modal").close(); });
let inApp = false;
$("#modal").addEventListener("close", () => {
  const m = location.hash.match(/^#\/(proyecto|beneficiario|contrato)\//);
  if (!m) return;
  if (inApp) history.back();
  else location.hash = m[1] === "contrato" ? "#/contratos" : m[1] === "beneficiario" ? "#/beneficiarios" : "#/proyectos";
});
$("#modal-body").addEventListener("click", (e) => {
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
$("#hsearch").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("#hq").value.trim();
  location.hash = `#/proyectos${q ? "?q=" + encodeURIComponent(q) : ""}`;
});

load().then(() => { applyI18n(); route(); }).catch((e) => {
  $("#app").innerHTML = `<p class="notice">Error: ${esc(e.message)}</p>`;
});
