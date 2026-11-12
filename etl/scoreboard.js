// Descarga del Recovery and Resilience Scoreboard (Comisión Europea) dos tablas que solo
// se pueden exportar desde la web (motor Qlik): los 100 mayores perceptores finales por
// país y los pagos de la UE a cada país. Guarda los Excel en etl/.cache/rrf/.
// Uso: node etl/scoreboard.js   (requiere el paquete «playwright» con Chromium)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, ".cache", "rrf");
const PAGE = "https://ec.europa.eu/economy_finance/recovery-and-resilience-scoreboard/disbursements.html";
const TABLAS = [
  { file: "perceptores.xlsx", qs: "table=finalRecipientByCountry&lang=en", selector: "#top100finalRecipientsExportButton" },
  { file: "pagos.xlsx", qs: "lang=en", selector: ".ecfin-rrf-export-data-button" },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const t of TABLAS) {
      const ctx = await browser.newContext();
      let url = null;
      ctx.on("request", (r) => { if (/tempcontent\/.*\.xlsx/i.test(r.url())) url = r.url(); });
      const p = await ctx.newPage();
      await p.goto(`${PAGE}?${t.qs}`, { timeout: 120000 });
      await p.waitForSelector(t.selector, { timeout: 120000 });
      await p.waitForTimeout(15000); // el motor de datos tarda en cargar
      await p.locator(t.selector).first().click();
      for (let i = 0; i < 60 && !url; i++) await p.waitForTimeout(1000);
      if (!url) throw new Error(`No se generó la exportación de ${t.file}`);
      const r = await ctx.request.get(url);
      if (!r.ok()) throw new Error(`Descarga de ${t.file}: HTTP ${r.status()}`);
      fs.writeFileSync(path.join(OUT, t.file), await r.body());
      console.log(`${t.file}: ${(await r.body()).length} bytes`);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
