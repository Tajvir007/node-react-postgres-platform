import express from "express";
import cors from "cors";
import { initSchema, read, write, pingWrite } from "./db.js";
import redis from "./redisClient.js";
import { enqueueItemCreated } from "./queue.js";
import { searchHealth } from "./search.js";
import client from "prom-client";

const app = express();
// Create a registry to store Prometheus metrics.
const register = new client.Registry();

// Collect default Node.js process metrics, such as memory and CPU.
client.collectDefaultMetrics({ register });

// Count HTTP requests by method, route, and status code.
const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"],
  registers: [register],
});

// Measure HTTP request duration in seconds.
const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [register],
});

// Track requests after Express has parsed the request.
app.use((req, res, next) => {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    // Use the matched route template to avoid high-cardinality URL labels.
    const route = req.route?.path
      ? `${req.baseUrl || ""}${req.route.path}`
      : "unmatched";

    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode),
    };

    httpRequestsTotal.inc(labels);

    const durationSeconds =
      Number(process.hrtime.bigint() - start) / 1e9;

    httpRequestDuration.observe(labels, durationSeconds);
  });

  next();
});

// Expose application metrics for Prometheus scraping.
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Liveness: is the process itself up (no dependency checks).
app.get("/api/health/live", (req, res) => res.json({ status: "alive" }));

// Readiness: are our dependencies reachable. Used by k8s to gate traffic.
app.get("/api/health/ready", async (req, res) => {
  try {
    await pingWrite();
    res.json({ status: "ready" });
  } catch (err) {
    res.status(503).json({ status: "not-ready", error: err.message });
  }
});

app.get("/api/health/redis", async (req, res) => {
  try {
    await redis.ping();
    res.json({ status: "ok" });
  } catch (err) {
    res.status(503).json({ status: "error", error: err.message });
  }
});

app.get("/api/health/search", async (req, res) => {
  try {
    const health = await searchHealth();
    res.json({ status: "ok", cluster: health.status });
  } catch (err) {
    res.status(503).json({ status: "error", error: err.message });
  }
});

// Reads are served from the "read" pool (replica in a real cluster).
app.get("/api/items", async (req, res) => {
  try {
    const { rows } = await read(
      "SELECT id, name, created_at FROM items ORDER BY id DESC LIMIT 50"
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Writes always go through the "write" pool (primary in a real cluster),
// then fan out a job to the queue for async work (e.g. search indexing).
app.post("/api/items", async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: "name is required" });
  try {
    const { rows } = await write(
      "INSERT INTO items (name) VALUES ($1) RETURNING id, name, created_at",
      [name]
    );
    const item = rows[0];
    enqueueItemCreated(item).catch((err) =>
      console.error("failed to enqueue item-created event:", err.message)
    );
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

initSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`backend listening on :${PORT}`));
  })
  .catch((err) => {
    console.error("failed to initialize schema:", err);
    process.exit(1);
  });
