# Metodología

## Fuente
API pública de la BDNS (`https://www.infosubvenciones.es/bdnstrans/api`):

| Endpoint | Uso |
|---|---|
| `convocatorias/busqueda?mrr=true` | Lista de convocatorias financiadas por el MRR |
| `convocatorias?numConv=N` | Detalle: procedimiento, presupuesto, finalidad, instrumentos, bases |
| `concesiones/busqueda?numeroConvocatoria=N` | Todas las concesiones de cada convocatoria |

## Tratamiento
- Beneficiario: el NIF es el primer token. NIF de persona jurídica → se publica. DNI/NIE o beneficiario enmascarado (`***`) → persona física, solo se agrega.
- "Concedido" = suma de importes de concesión publicados (no pagos efectivos). Incluye **garantías y préstamos**, que se desglosan aparte.
- Las concesiones a administraciones públicas (NIF que empieza por P, Q o S) pueden volver a concederse en convocatorias propias: el total puede contener **doble cómputo**.

## Indicadores
| Código | Regla |
|---|---|
| `nominativa` | El procedimiento o el título indica subvención nominativa |
| `concesion_directa` | Procedimiento de concesión directa |
| `concentracion` | ≥3 beneficiarios y el mayor recibe ≥50% del total |
| `beneficiario_unico_1m` | Un único beneficiario recibe ≥1.000.000 € |
| `supera_presupuesto` | Concedido > 110% del presupuesto publicado |
| `sin_concesiones` | Presupuesto ≥100.000 €, >18 meses y ninguna concesión publicada |

Un indicador **no implica irregularidad**; sirve para priorizar la revisión.

# Contratos públicos

Fuente: datos abiertos de la [Plataforma de Contratación del Sector Público](https://contrataciondelsectorpublico.gob.es) (ficheros ATOM/CODICE `licitacionesPerfilesContratanteCompleto3`, anuales y mensuales). Script: `etl/fetch_contratos.py`.

Un contrato se incluye si su código de financiación (`FundingProgramCode`) es `PRTR`, o si su objeto o financiación mencionan el Plan de Recuperación, PRTR, MRR o Next Generation. Hay órganos que mencionan el Plan en el objeto pero marcan "sin fondos UE": se incluyen porque el propio contrato declara la vinculación. Para cada expediente se usa la versión más reciente publicada. Los contratos menores no están en este conjunto.

| Código | Regla |
|---|---|
| `licitador_unico` | Todas las adjudicaciones recibieron una sola oferta, en un procedimiento competitivo (no negociado, no derivado de acuerdo marco) |
| `sin_baja` | Un solo licitador y adjudicado por ≥99,5% del presupuesto de licitación |
| `negociado_sin_publicidad` | Procedimiento negociado sin publicidad |
| `emergencia` | Tramitación de emergencia |
| `supera_presupuesto` | Adjudicado > 110% del presupuesto de licitación |
| `plazo_corto` | Presupuesto ≥1 M€ y menos de 20 días naturales entre la primera publicación del anuncio de licitación y el fin del plazo de ofertas (excluye negociados y derivados de acuerdo marco). El mínimo legal general para contratos armonizados es de 35 días; con urgencia puede reducirse |
| `ganador_recurrente` | La misma empresa (NIF) gana ≥3 contratos del mismo órgano con un solo licitador o por negociado sin publicidad. No cuentan los contratos con más de dos adjudicatarios (acuerdos marco con muchos proveedores) |

Importes sin IVA.

# Ranking de organismos

Se calcula en el navegador con los mismos datos de la web.

- **Contratos:** por órgano de contratación, porcentaje del importe adjudicado en contratos con un solo licitador, negociados sin publicidad o de emergencia. Se compara con la media global ("× la media"). Por defecto se muestran órganos con 20 o más contratos adjudicados, para evitar extremos por azar.
- **Subvenciones:** por órgano concedente, porcentaje del importe concedido por concesión directa o nominativa, y número de convocatorias sin concesiones publicadas tras 18 meses (con su presupuesto).

Un porcentaje alto no implica irregularidad: hay mercados con pocos proveedores y concesiones directas previstas por ley.

# Solicitudes de transparencia

Cada ficha genera un texto de solicitud de acceso a la información (Ley 19/2013 o la ley autonómica aplicable) adaptado a sus indicadores. Quien la presenta puede registrarla como *issue* con la plantilla «Registrar una solicitud de transparencia». El workflow `solicitudes.yml` reúne esos issues en `site/data/solicitudes.json`:

- Estado según el desplegable del issue o las etiquetas `respondida`, `denegada` o `reclamada`.
- Una solicitud pendiente con más de 31 días desde su presentación pasa a «sin respuesta (fuera de plazo)». El plazo legal es de un mes, ampliable otro si se notifica.
- Los issues con etiqueta `invalida` o `spam` se ignoran.

# Bot de redes sociales

`etl/bot.py` publica, después de cada actualización semanal de contratos, hasta 4 contratos adjudicados en los últimos 14 días, de 300.000 € o más, con alguno de estos indicadores: precio máximo sin competencia, negociado sin publicidad, plazo corto, ganador recurrente, un solo licitador o emergencia. Cada mensaje se limita a hechos de los datos oficiales y enlaza a la ficha. Los ya publicados se guardan en `etl/bot_estado.json` para no repetirlos.
