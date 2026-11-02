# 1. Build and verify the Anchor program
anchor build

# 2. Synchronize program keys
solana address -k target/deploy/breakpoint_pass-keypair.json
# Ensure declare_id matches the output in programs/breakpoint-pass/src/lib.rs

# 3. Deploy to Solana Devnet
solana program deploy \
  --program-id target/deploy/breakpoint_pass-keypair.json \
  --url devnet \
  target/deploy/breakpoint_pass.so

# 4. Run automated integration test suite on local validator
anchor test