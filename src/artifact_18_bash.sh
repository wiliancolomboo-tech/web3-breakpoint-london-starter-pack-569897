#!/usr/bin/env bash
set -euo pipefail

echo "==> [1/4] Building Anchor Solana Program"
anchor build

echo "==> [2/4] Deploying to Solana Cluster"
CLUSTER=${1:-devnet}
anchor deploy --provider.cluster "$CLUSTER"

PROGRAM_ID=$(solana address -k target/deploy/london_starter_pack-keypair.json)
echo "Deployed Program ID: $PROGRAM_ID"

echo "==> [3/4] Exporting IDL to Relayer Service"
cp target/idl/london_starter_pack.json relayer/src/idl.json

echo "==> [4/4] Setup complete. Ready for production Docker startup."