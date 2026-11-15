#!/usr/bin/env bash
# Deploy the backend like CI: detects staging/production, pulls that branch and runs its commit's image.
# Usage: bash deploy-server.sh            Rollback: bash deploy-server.sh <old-image-tag>
set -euo pipefail

REPO=harhsitsharma/cms-backend

main() {
  local target dir branch compose container prefix keep services has_stg=0 has_prod=0
  # Each server already runs its own container, which tells us which server this is.
  docker container inspect cms-backend-app-stg >/dev/null 2>&1 && has_stg=1
  docker container inspect cms-backend-app >/dev/null 2>&1 && has_prod=1
  if [ "$has_stg$has_prod" = 10 ]; then
    target=staging dir=/home/ubuntu/medisatu/MediSetu_backend branch=staging
    compose=docker/docker-compose.staging.yml container=cms-backend-app-stg
    prefix=staging- keep=3 services=""
  elif [ "$has_stg$has_prod" = 01 ]; then
    target=production dir=/home/ubuntu/medisetu/InfinityMedisetu_BE branch=main
    compose=docker/docker-compose.prod.yml container=cms-backend-app
    prefix=prod- keep=2 services=app
  else
    echo "Can't tell staging from production here (cms-backend-app-stg=$has_stg, cms-backend-app=$has_prod)." >&2
    exit 1
  fi
  echo "This is the $target server (branch $branch)."

  cd "$dir"
  local previous
  previous=$(docker inspect -f '{{.Config.Image}}' "$container")
  echo "Current image: $previous"

  git pull origin "$branch"
  local tag="${1:-$prefix$(git rev-parse --short=7 HEAD)}"
  # A rollback tag must belong to this server: staging tags never run on production.
  if [ "$target" = staging ] && [[ "$tag" != staging* ]]; then
    echo "'$tag' is not a staging tag." >&2; exit 1
  fi
  if [ "$target" = production ] && [[ "$tag" == staging* ]]; then
    echo "'$tag' is a staging tag; production runs prod-* images built from main." >&2; exit 1
  fi
  echo "Deploying $REPO:$tag"

  if ! docker pull "$REPO:$tag"; then
    echo "$REPO:$tag is not on Docker Hub. On your PC, on the $branch branch, run: .\\scripts\\push-image.ps1" >&2
    exit 1
  fi
  # $services is unquoted on purpose: empty for staging means every service, like CI.
  IMAGE_TAG="$tag" docker compose -f "$compose" up -d $services

  echo "Waiting for $container to become healthy..."
  local status=unknown attempt
  for attempt in $(seq 1 10); do
    status=$(docker inspect -f '{{.State.Health.Status}}' "$container" 2>/dev/null || echo unknown)
    echo "  attempt $attempt/10: $status"
    [ "$status" = healthy ] && break
    sleep 15
  done
  if [ "$status" != healthy ]; then
    if curl -fsS http://localhost:5000/ >/dev/null 2>&1; then
      echo "Docker health is '$status' but the app answers on :5000; continuing."
    else
      docker logs --tail=100 "$container" || true
      echo "Deploy FAILED. Roll back with: bash $0 ${previous##*:}" >&2
      exit 1
    fi
  fi

  # Keep the newest few images of this server's tag family, like CI; in-use ones are skipped.
  docker images "$REPO" --format '{{.Repository}}:{{.Tag}} {{.CreatedAt}}' \
    | grep ":$prefix" | sort -k2 -r | tail -n +"$((keep + 1))" | awk '{print $1}' \
    | xargs -r docker rmi || true

  echo "Deployed $REPO:$tag to $target (was $previous)."
}

# On one line so bash has read it before `git pull` can rewrite this file mid-run.
main "$@"; exit
