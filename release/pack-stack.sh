#!/usr/bin/env bash
set -euo pipefail

sources=$(realpath "$1")
output=$(realpath -m "$2")
assets="$output/assets"
config="$output/config"
backend_sha=$(git -C "$sources/backend" rev-parse HEAD)
revision="${backend_sha:0:12}"
mkdir -p "$assets" "$config/monitoring/grafana"

cp "$sources/mock/docker-compose.yml" "$config/"
cp -R "$sources/mock/monitoring/grafana/provisioning" "$config/monitoring/grafana/"
cp -R "$sources/mock/monitoring/prometheus" "$sources/mock/monitoring/promtail" "$config/monitoring/"
cp "$(dirname "$0")/compose.release.yml" "$config/"

printf 'STACK_REVISION=%s\n' "$revision" > "$config/.env"
docker compose --env-file "$config/.env" \
  -f "$config/docker-compose.yml" -f "$config/compose.release.yml" config --quiet

pack_image() {
  local service=$1
  local context=$2
  local commit=$3
  local image="ai-assistant-stack-$service:$revision"
  docker build --platform linux/amd64 \
    --label "org.opencontainers.image.revision=$commit" --tag "$image" "$context"
  docker image save "$image" | gzip -1 > "$assets/$service-linux-amd64.tar.gz"
}

frontend_sha=$(git -C "$sources/frontend" rev-parse HEAD)
mock_sha=$(git -C "$sources/mock" rev-parse HEAD)
ml_sha=$(git -C "$sources/ml" rev-parse HEAD)

pack_image backend "$sources/backend" "$backend_sha"
pack_image frontend "$sources/frontend" "$frontend_sha"
pack_image marketplace-mock "$sources/mock" "$mock_sha"
pack_image ml "$sources/ml" "$ml_sha"
pack_image webhook-receiver "$sources/mock/monitoring/webhook-receiver" "$mock_sha"

cat > "$config/REVISIONS.txt" <<EOF
backend=$backend_sha
frontend=$frontend_sha
marketplace-mock=$mock_sha
ml=$ml_sha
EOF

tar -czf "$assets/compose-config.tar.gz" -C "$config" .
(cd "$assets" && sha256sum -- *.tar.gz > SHA256SUMS)

cat > "$output/RELEASE.md" <<EOF
Готовые образы учебного стенда для Linux amd64. Нужен Docker с Compose 2.24.4 или новее.

Скачайте compose-config.tar.gz и пять архивов *-linux-amd64.tar.gz в одну папку.
Загрузите образы через docker image load -i для каждого из пяти файлов.
Распакуйте настройки и запустите стенд из этой папки:

    tar -xf compose-config.tar.gz
    docker compose -f docker-compose.yml -f compose.release.yml up -d --no-build --wait

Перед запросами к ассистенту запустите Ollama с gemma4:e4b.
По умолчанию ML обращается к host.docker.internal:11434.
Если Ollama находится в другом месте, задайте доступный из контейнера OLLAMA_BASE_URL в .env.
Образы Prometheus, Grafana, Loki и Promtail Compose скачает из публичного реестра при необходимости.
Интерфейсы стенда доступны локально. Вход в мок: http://localhost:8081.

Коммиты компонентов перечислены в REVISIONS.txt. Контрольные суммы архивов находятся в SHA256SUMS.
EOF
