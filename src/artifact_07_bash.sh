# Fetch dependencies and compile Rust smart contract
anchor build

# Retrieve generated Program ID
solana address -k target/deploy/breakpoint_london_pack-keypair.json