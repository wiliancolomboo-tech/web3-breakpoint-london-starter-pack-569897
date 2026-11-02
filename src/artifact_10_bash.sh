# Set cluster configuration
solana config set --url https://api.devnet.solana.com

# Airdrop testnet SOL
solana airdrop 2

# Deploy program
anchor deploy --provider.cluster devnet