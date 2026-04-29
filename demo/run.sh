#!/usr/bin/env bash
# AI Context Hub — Demo Script
# Run from repo root: bash demo/run.sh
set -euo pipefail

HUB=$(mktemp -d)
export AI_CONTEXT_ROOT="$HUB"
trap 'rm -rf "$HUB"' EXIT

# Resolve CLI path relative to this script
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI="node $REPO_ROOT/src/cli.js"

divider() { echo; printf '=%.0s' $(seq 1 60); echo; }

divider
echo "1. INIT"
$CLI init

divider
echo "2. REMEMBER"
$CLI remember "Payment module uses Stripe API v2, no v1 callbacks" --entity payment --confidence 1.0
$CLI remember "Backend on AWS us-east-1, RDS instance db.t3.xlarge" --entity infra --entity-type module
$CLI remember "Alice is frontend lead, owns the component library and design system" --entity alice --entity-type person

divider
echo "3. SYNC"
$CLI sync

divider
echo "4. SEARCH — keyword"
$CLI search "Stripe"

divider
echo "5. SEARCH — semantic"
$CLI search "database config" --semantic

divider
echo "6. RELATE"
$CLI relate --from alice --to payment --kind works_on --apply

divider
echo "7. RELATIONS"
$CLI relations alice

divider
echo "8. LIST"
$CLI list

divider
echo "9. DOCTOR"
$CLI doctor

divider
echo "OK"
