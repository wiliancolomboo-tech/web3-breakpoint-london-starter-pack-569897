// File: src/health_server.ts
import http from "http";

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "healthy",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        service: "BreakpointKit Relayer Engine",
      })
    );
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`[Health Server] Listening on port ${PORT}`);
});