# 1. Configure production environment
cp .env.example .env
nano .env

# 2. Launch headless containerized relay stack
docker-compose up -d --build

# 3. Stream real-time logs
docker-compose logs -f breakpoint-relayer