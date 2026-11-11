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

const flagTags = (flags) => (flags || []).map((f) => `<span class="tag" title="${esc(t("flagd_" + f))}">${esc(t("flag_" + f))}</span>`).join("");

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
    (!state.flag || (state.flag === "*" ? c.flags.length : c.flags.includes(state.flag))) &&
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
    <select id="flag">${opt("", t("all_flags"), state.flag)}${opt("*", t("any_flag"), state.flag)}${FLAGS.map((f) => opt(f, t("flag_" + f), state.flag)).join("")}</select>
    <input type="number" id="min" min="0" step="10000" placeholder="${esc(t("min_amount"))}" value="${esc(state.min)}" style="width:170px">
  </div>
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
  ["admin", "tipo", "flag", "min"].forEach((id) => $("#" + id).addEventListener("input", (e) => { state[id] = e.target.value; upd(); }));
  $("#results").addEventListener("click", (e) => {
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

function showProject(id) {
  const c = DB.convById.get(String(id));
  if (!c) return;
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
    <h2>${t("m_signal")}</h2>
    <a class="btn" href="${issueUrl(c)}" target="_blank" rel="noopener">${t("m_signal_btn")} ↗</a>`);
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
      <li>Solo se incluyen <b>subvenciones y ayudas</b>. Los <b>contratos públicos</b> financiados con el Plan de Recuperación (publicados en la Plataforma de Contratación del Sector Público) y las transferencias entre administraciones aún no están incluidos.</li>
      <li>Si una administración no marca correctamente la financiación MRR o no publica sus concesiones, no aparece aquí.</li>
      <li>Las concesiones a <b>personas físicas</b> se agregan y no se muestran de forma individual por protección de datos.</li>
      <li>El importe "concedido" es lo publicado en la BDNS, no lo efectivamente pagado.</li></ul>
    <h2>Indicadores</h2><p>Son reglas automáticas y transparentes, inspiradas en metodologías de riesgo en contratación pública (p. ej. las de la OCDE y la Comisión Europea). <b>Un indicador no implica irregularidad</b>: muchas concesiones directas o nominativas son perfectamente legales. Sirven para priorizar qué mirar.</p><ul>${flags}</ul>
    <p>El código es abierto: cualquiera puede verificar cómo se calcula cada cifra.</p></div>`
  : `<div class="prose"><h1>Methodology</h1>
    <p>Data comes from Spain's <a href="https://www.infosubvenciones.es" target="_blank" rel="noopener">National Grants Database (BDNS)</a>, the official registry where every Spanish administration must publish its grant calls and awards. We download every call flagged as funded by the <b>Recovery and Resilience Facility (RRF)</b> and all of its awards.</p>
    <h2>Limitations</h2><ul>
      <li>Only <b>grants and subsidies</b> are covered. <b>Public procurement contracts</b> funded by the Recovery Plan and transfers between administrations are not yet included.</li>
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

function loadContratos() {
  if (!CT.loading) {
    CT.loading = fetch("data/contratos.json").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d) d.contratos.forEach((c, i) => { c._i = i; c._s = norm([c.objeto, c.organo, c.exp, c.ruta, ...c.adj.map((a) => a.nombre + " " + a.nif)].join(" ")); });
      CT.data = d;
      return d;
    }).catch(() => null);
  }
  return CT.loading;
}
const cflagTags = (flags) => (flags || []).map((f) => `<span class="tag" title="${esc(t("cflagd_" + f))}">${esc(t("cflag_" + f))}</span>`).join("");

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
    <select id="cflag">${opt("", t("all_flags"), cstate.flag)}${opt("*", t("any_flag"), cstate.flag)}${CFLAGS.map((f) => opt(f, t("cflag_" + f), cstate.flag)).join("")}</select>
  </div>
  <div id="cresults"></div>`;
}

function renderContratos() {
  const q = norm(cstate.q);
  const rows = CT.data.contratos.filter((c) => (!q || c._s.includes(q)) && (!cstate.proc || c.proc === cstate.proc) &&
    (!cstate.ambito || c.ambito === cstate.ambito) &&
    (!cstate.flag || (cstate.flag === "*" ? c.flags.length : c.flags.includes(cstate.flag))));
  const k = cstate.sort, d = cstate.dir;
  rows.sort((a, b) => ((a[k] ?? 0) > (b[k] ?? 0) ? d : (a[k] ?? 0) < (b[k] ?? 0) ? -d : 0));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  cstate.page = Math.min(cstate.page, pages - 1);
  const th = (key, l, cls = "") => `<th class="${cls}" data-sort="${key}">${esc(l)}${cstate.sort === key ? (cstate.dir < 0 ? " ↓" : " ↑") : ""}</th>`;
  $("#cresults").innerHTML = `<p class="count">${num(rows.length)} ${t("results")} · ${eur(rows.reduce((s, r) => s + r.importe, 0))}</p>
  <div class="table-wrap"><table><thead><tr>${th("objeto", t("c_object"))}${th("fecha", t("c_date"), "hide-sm")}${th("ofertas", t("c_offers"), "num hide-sm")}${th("importe", t("c_awarded"), "num")}</tr></thead>
  <tbody>${rows.slice(cstate.page * PAGE, (cstate.page + 1) * PAGE).map((c) => `<tr data-ci="${c._i}">
    <td class="t-title">${esc(c.objeto)}<div class="t-sub">${esc(c.adj[0] ? c.adj[0].nombre : "—")} · ${esc(c.organo)}</div>${cflagTags(c.flags)}</td>
    <td class="hide-sm">${esc(c.fecha)}</td><td class="num hide-sm">${c.ofertas ?? "—"}</td><td class="num">${eur(c.importe)}</td></tr>`).join("")}</tbody></table></div>
  ${pager(pages, cstate.page)}`;
}

function bindContratos() {
  if (!CT.data) return;
  const upd = () => { cstate.page = 0; renderContratos(); };
  $("#cq").addEventListener("input", (e) => { cstate.q = e.target.value; upd(); });
  [["cproc", "proc"], ["cflag", "flag"], ["cambito", "ambito"]].forEach(([id, k]) => $("#" + id).addEventListener("input", (e) => { cstate[k] = e.target.value; upd(); }));
  $("#cresults").addEventListener("click", (e) => {
    const s = e.target.closest("th[data-sort]");
    if (s) { const key = s.dataset.sort; cstate.dir = cstate.sort === key ? -cstate.dir : -1; cstate.sort = key; renderContratos(); return; }
    const p = e.target.closest("button[data-p]");
    if (p) { cstate.page += Number(p.dataset.p); renderContratos(); window.scrollTo(0, 0); return; }
    const tr = e.target.closest("tr[data-ci]");
    if (tr) location.hash = `#/contrato/${tr.dataset.ci}`;
  });
  renderContratos();
}

function showContrato(i) {
  const c = CT.data && CT.data.contratos[Number(i)];
  if (!c) return;
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
    ${c.adj.length ? `<div class="table-wrap"><table><tbody>${c.adj.map((a) => `<tr><td>${esc(a.nombre)}<div class="t-sub">${esc(a.nif || "")}</div></td><td class="num">${eur(a.importe)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">${t("none")}</p>`}`);
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
    loadContratos().then(() => { if (app.dataset.view === "contratos") { app.innerHTML = viewContratos(); bindContratos(); } });
  }
  else if (view === "metodologia") app.innerHTML = viewMethod();
  else if (view === "denunciar") app.innerHTML = viewReport();
  else app.innerHTML = viewHome();
  window.scrollTo(0, 0);
}

$("#modal .close").addEventListener("click", () => $("#modal").close());
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") $("#modal").close(); });
$("#modal").addEventListener("close", () => {
  if (/^#\/(proyecto|beneficiario|contrato)\//.test(location.hash)) history.back();
});
$("#lang").addEventListener("click", () => {
  lang = lang === "es" ? "en" : "es";
  try { localStorage.setItem("lang", lang); } catch {}
  applyI18n(); delete $("#app").dataset.view; route();
});
window.addEventListener("hashchange", route);
$("#hsearch").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("#hq").value.trim();
  location.hash = `#/proyectos${q ? "?q=" + encodeURIComponent(q) : ""}`;
});

load().then(() => { applyI18n(); route(); }).catch((e) => {
  $("#app").innerHTML = `<p class="notice">Error: ${esc(e.message)}</p>`;
});
