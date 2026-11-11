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
const eur = (n) => new Intl.NumberFormat(locale(), { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);
const eurShort = (n) => new Intl.NumberFormat(locale(), { style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 1 }).format(n || 0);
const num = (n) => new Intl.NumberFormat(locale()).format(n || 0);
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
function viewHome() {
  const r = DB.resumen, T = r.totales;
  const flagged = DB.convs.filter((c) => c.flags.length).length;
  const ind = FLAGS.map((f) => ({ nombre: t("flag_" + f), f, n: r.indicadores[f] || 0 })).filter((x) => x.n);
  return `
  <h1>${esc(t("home_title"))}</h1>
  <p class="lead">${esc(t("home_lead"))}</p>
  <div class="kpis">
    <div class="kpi"><b>${eurShort(T.importe)}</b><span>${t("k_importe")}</span></div>
    <div class="kpi"><b>${eurShort(T.presupuesto)}</b><span>${t("k_presupuesto")}</span></div>
    <div class="kpi"><b>${num(T.convocatorias)}</b><span>${t("k_convs")}</span></div>
    <div class="kpi"><b>${num(T.concesiones)}</b><span>${t("k_concesiones")}</span></div>
    <div class="kpi"><b>${num(flagged)}</b><span>${t("k_flagged")}</span></div>
  </div>
  <div class="grid2">
    <section class="card"><h2>${t("top_projects")}</h2>
      ${bars(DB.convs, { label: "titulo", href: (i) => `#/proyecto/${i.id}` })}
      <a href="#/proyectos">${t("see_all")}</a></section>
    <section class="card"><h2>${t("top_benef")}</h2>
      ${bars(DB.benef, { href: (i) => `#/beneficiario/${encodeURIComponent(i.nif || i.nombre)}` })}
      <a href="#/beneficiarios">${t("see_all")}</a></section>
    <section class="card"><h2>${t("by_org")}</h2>${bars(r.por_organo, { href: (i) => `#/proyectos?q=${encodeURIComponent(i.nombre)}` })}</section>
    <section class="card"><h2>${t("by_admin")}</h2>${bars(r.por_administracion, { href: (i) => `#/proyectos?admin=${encodeURIComponent(i.nombre)}` })}
      <h2>${t("by_year")}</h2>${bars(r.por_anio, { limit: 20 })}</section>
    <section class="card"><h2>${t("flags_title")}</h2>
      ${bars(ind, { value: "n", fmt: num, href: (i) => `#/proyectos?flag=${i.f}` })}
      <p class="muted" style="font-size:13px">${esc(t("foot_disclaimer"))} <a href="#/metodologia">${t("nav_method")}</a></p></section>
  </div>`;
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

// ---------- Router ----------
function route() {
  const [path, qs] = location.hash.replace(/^#/, "").split("?");
  const parts = (path || "/").split("/").filter(Boolean);
  const app = $("#app");
  const view = parts[0] || "";
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#/" + view || (a.getAttribute("href") === "#/" && !view)));

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
  else if (view === "metodologia") app.innerHTML = viewMethod();
  else if (view === "denunciar") app.innerHTML = viewReport();
  else app.innerHTML = viewHome();
  window.scrollTo(0, 0);
}

$("#modal .close").addEventListener("click", () => $("#modal").close());
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") $("#modal").close(); });
$("#modal").addEventListener("close", () => {
  if (/^#\/(proyecto|beneficiario)\//.test(location.hash)) history.back();
});
$("#lang").addEventListener("click", () => {
  lang = lang === "es" ? "en" : "es";
  try { localStorage.setItem("lang", lang); } catch {}
  applyI18n(); delete $("#app").dataset.view; route();
});
window.addEventListener("hashchange", route);

load().then(() => { applyI18n(); route(); }).catch((e) => {
  $("#app").innerHTML = `<p class="notice">Error: ${esc(e.message)}</p>`;
});
