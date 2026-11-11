#!/usr/bin/env bash
# Publica datos en la rama «datos», que siempre tiene UN solo commit (se reemplaza en
# cada actualización), para que el historial del repositorio no crezca con los datos.
# Solo sustituye las rutas indicadas (relativas a site/data); el resto se conserva.
#
# Uso: etl/publicar_datos.sh "mensaje" ruta1 [ruta2 ...]
# Requiere GITHUB_TOKEN y GITHUB_REPOSITORY (los pone GitHub Actions).
set -euo pipefail
msg=$1; shift
src="$(pwd)/site/data"
remote="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
for intento in 1 2 3 4 5; do
  w=$(mktemp -d)
  git clone -q --depth 1 --branch datos "$remote" "$w"
  base=$(git -C "$w" rev-parse HEAD)
  for p in "$@"; do
    rm -rf "${w:?}/$p"
    if [ -e "$src/$p" ]; then mkdir -p "$(dirname "$w/$p")"; cp -r "$src/$p" "$w/$p"; fi
  done
  cd "$w"
  git add -A
  if git diff --cached --quiet; then echo "Sin cambios en los datos"; exit 0; fi
  git checkout -q --orphan nuevo
  git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "$msg"
  if git push -q --force-with-lease="datos:$base" origin nuevo:datos; then echo "Datos publicados: $msg"; exit 0; fi
  echo "Otro proceso publicó a la vez; reintento ($intento)…"; cd - >/dev/null; sleep $((intento * 10))
done
echo "No se pudieron publicar los datos" >&2; exit 1
