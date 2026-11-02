# Configure Solana CLI for London Breakpoint cluster
solana config set --url https://api.devnet.solana.com

# Deploy contract binary
solana program deploy ./target/deploy/breakpoint_starter_pack.so \
  --program-id ./target/deploy/breakpoint_starter_pack-keypair.json \
  --priority-fee 10000