#!/usr/bin/env bash
set -euo pipefail

unset http-proxy https-proxy

exec npm "$@"
