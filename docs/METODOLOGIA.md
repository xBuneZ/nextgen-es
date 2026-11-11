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
