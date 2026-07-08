#!/usr/bin/env bash
# Redeploy the roster app after new commits. RUN ON THE HOST, in the repo directory.
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
docker compose up -d --build
docker compose ps
