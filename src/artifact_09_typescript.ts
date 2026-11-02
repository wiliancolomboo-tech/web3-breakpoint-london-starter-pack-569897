// Telemetry & Health Endpoint (src/cli/health.ts)
import express from "express";
import { Connection } from "@solana/web3.js";

export function createHealthServer(connection: Connection, port: number = 8080) {
  const app = express();

  app.get("/health", async (req, res) => {
    try {
      const slot = await connection.getSlot("confirmed");
      res.status(200).json({
        status: "HEALTHY",
        uptime: process.uptime(),
        currentSlot: slot,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(503).json({
        status: "UNHEALTHY",
        error: err.message,
      });
    }
  });

  app.listen(port, () => {
    console.log(`[Health Telemetry] Server online on port ${port}`);
  });
}