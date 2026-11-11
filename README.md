# Next Gen España · ¿En qué se gastan los fondos europeos?

Web ciudadana y de código abierto para consultar **en qué gasta España los fondos Next Generation EU** (Mecanismo de Recuperación y Resiliencia, MRR): qué convocatorias se financian, qué administración las concede y **quién recibe el dinero**.

*🇬🇧 An open-source, citizen-run website to explore how Spain spends its NextGenerationEU (Recovery and Resilience Facility) money: which calls are funded, which body awards them and who receives the money. The site is bilingual (ES/EN).*

## Qué hace

- **Resumen**: totales, reparto por administración, órgano y año, mayores convocatorias y beneficiarios.
- **Proyectos**: buscador y filtros (administración, procedimiento, importe, indicadores) sobre todas las convocatorias MRR publicadas.
- **Beneficiarios**: cuánto ha recibido cada empresa o entidad y de qué convocatorias.
- **Indicadores automáticos**: señales objetivas (concesión directa, subvención nominativa, concentración en un beneficiario, importe superior al presupuesto, falta de publicación…) para priorizar qué revisar. **No son acusaciones.**
- **Proponer para revisión**: cada ficha tiene un botón que abre un *issue* en este repositorio con los datos ya rellenados.
- **Contratos**: contratos públicos del Plan de Recuperación (Plataforma de Contratación) con indicadores de falta de competencia.
- **Ranking de organismos**: qué órganos adjudican más dinero sin competencia, comparados con la media.
- **Pide explicaciones**: cada ficha genera una solicitud de acceso a la información (Ley de Transparencia) lista para presentar, y permite registrarla para seguir públicamente si responden.
- **Bot de redes sociales**: publica cada semana en Bluesky y Mastodon los contratos nuevos con indicadores.
- **Denunciar**: enlaces a los canales oficiales (EPPO, OLAF, SNCA).

## Datos

Fuente: [Sistema Nacional de Publicidad de Subvenciones y Ayudas Públicas (BDNS)](https://www.infosubvenciones.es), API pública. Se descargan todas las convocatorias con `mrr=true` y todas sus concesiones. Ver [docs/METODOLOGIA.md](docs/METODOLOGIA.md).

- Las concesiones a **personas físicas** solo se publican de forma agregada (RGPD y aviso legal de la BDNS).
- Un GitHub Action (`.github/workflows/update-data.yml`) actualiza los datos cada lunes y otro publica la web en GitHub Pages.

## Estructura

```
etl/fetch_bdns.py      Descarga y procesado (Python, solo biblioteca estándar)
site/                  Web estática (HTML + JS, sin dependencias ni compilación)
site/data/*.json       Datos generados
docs/                  Metodología y hoja de ruta
```

## Uso local

```bash
python3 etl/fetch_bdns.py --limit 200     # prueba rápida; sin --limit descarga todo (~20-30 min)
python3 -m http.server -d site 8000       # abre http://localhost:8000
```

## Publicar en GitHub Pages

1. *Settings → Pages → Source: GitHub Actions*.
2. Cambia la constante `REPO` en `site/app.js` por `tu-usuario/nextgen-es` (para el botón «Proponer para revisión»).
3. Crea la etiqueta `revision` en *Issues → Labels*.

## Activar el bot de redes sociales

Sin credenciales el bot funciona en modo prueba: escribe en el resumen del workflow lo que publicaría. Para que publique:

1. **Bluesky:** crea la cuenta y una *contraseña de aplicación* (Ajustes → Privacidad y seguridad → Contraseñas de aplicación).
2. **Mastodon:** crea la cuenta en una instancia que acepte bots (por ejemplo `botsin.space` o `mastodon.social`). En Preferencias → Desarrollo, crea una aplicación con el permiso `write:statuses` y copia su token.
3. En GitHub, ve a *Settings → Secrets and variables → Actions → New repository secret* y añade `BSKY_HANDLE`, `BSKY_APP_PASSWORD`, `MASTODON_INSTANCE` (URL completa) y `MASTODON_TOKEN`. Basta con una de las dos redes.
4. Prueba desde *Actions → Bot de redes sociales → Run workflow* con «Modo prueba» marcado, y después sin marcar.

## Principios

Esta web publica **datos oficiales y verificables** y deja que cada cual saque conclusiones. Para que sea creíble (y legalmente sólida):

- Cada cifra enlaza a su ficha oficial.
- Los indicadores son reglas públicas y reproducibles; un indicador no implica irregularidad.
- No se afirma que ningún proyecto o persona concreta sea corrupta sin una resolución judicial o administrativa que lo respalde.

## Contribuir

Ver [CONTRIBUTING.md](CONTRIBUTING.md) y la [hoja de ruta](docs/ROADMAP.md). Licencia del código: MIT. Los datos pertenecen a sus fuentes oficiales.
