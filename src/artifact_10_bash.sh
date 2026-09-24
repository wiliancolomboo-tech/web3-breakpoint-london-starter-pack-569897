# Configure Solana CLI for Devnet
solana config set --url devnet

# Fund deployer account
solana airdrop 2

# Deploy program binary to Devnet
anchor deploy --provider.cluster devnet