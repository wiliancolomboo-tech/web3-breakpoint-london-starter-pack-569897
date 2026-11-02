import http from "http";
import { Connection } from "@solana/web3.js";

const PORT = process.env.PORT || 8080;
const RPC_URL = process.env.SOLANA_RPC_URL || "http://127.0.0.1:8899";
const connection = new Connection(RPC_URL, "confirmed");

const server = http.createServer(async (req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    try {
      const version = await connection.getVersion();
      const slot = await connection.getSlot();

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "healthy",
          cluster: "solana",
          solanaCoreVersion: version["solana-core"],
          currentSlot: slot,
          timestamp: new Date().toISOString(),
        })
      );
    } catch (err: any) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "unhealthy", error: err.message }));
    }
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`[Daemon] BreakPass Operational Gateway running on port ${PORT}`);
});