# Set Solana CLI target
solana config set --url https://api.devnet.solana.com

# Deploy Program
anchor deploy --provider.cluster devnet

# Verify deployment
solana program show <PROGRAM_ID>