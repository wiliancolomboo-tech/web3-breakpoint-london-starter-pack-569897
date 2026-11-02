# 1. Install Rust, Solana CLI (v1.18+), Anchor (v0.30.1)
sh -c "$(curl -sSfL https://release.solana.com/v1.18.26/install)"
cargo install --git https://github.com/coral-xyz/anchor --tag v0.30.1 anchor-cli --locked

# 2. Build on-chain program
anchor build

# 3. Synchronize program ID into Anchor.toml and lib.rs
anchor keys sync

# 4. Run local validator and complete automated test suite
anchor test