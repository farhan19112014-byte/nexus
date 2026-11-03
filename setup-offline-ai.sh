#!/usr/bin/env bash
# Free offline AI for NEXUS (Ollama). Usage: ./setup-offline-ai.sh [model]
cd "$(dirname "$0")" && exec node scripts/setup-ollama.mjs "$@"
