# 1. Build Solana Anchor Program
anchor build

# 2. Deploy to Solana Devnet
solana config set --url https://api.devnet.solana.com
anchor deploy --provider.cluster devnet

# 3. Synchronize Program ID and recompile IDL
anchor keys sync
anchor run test

# 4. Launch Containerized Ingress Engine & Webhook Telemetry
export RESEND_API_KEY="re_123456789"
export DISCORD_WEBHOOK_URL="https://api.example.com/webhooks/alerts/placeholder"
docker-compose up -d --build

# 5. Query Real-Time Microservice Health
curl -s http://localhost:3000/health | jq .