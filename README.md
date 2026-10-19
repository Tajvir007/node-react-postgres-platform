# Node + React + Postgres — Production-Style Local Platform

A simple full-stack app (React + Node.js/Express + PostgreSQL) taken through
six stages: containerization, Kubernetes, Ingress/API gateway, CI/CD,
platform services (Redis/queue/search + simulated read/write DB), and
observability/scaling.

## Repo structure

```
.
├── backend/                  # Express API + BullMQ worker
├── frontend/                 # React (Vite) app
├── 
├── 
├── 
├── 
├── k8s/                      # Namespaces, Deployments, Services, Ingress
├── observability/            # Prometheus, Grafana, Fluent Bit, Loki, HPA
└── .github/workflows/ci-cd.yml
```

---

# Cloudly DevOps Assessment — Task 1

## Docker Compose Local Development Environment

### Overview

Task 1 configures a React/Vite frontend, Node.js backend, and PostgreSQL database using Docker Compose.

The objective is to run the application locally with containerized services, persistent database storage, environment-based configuration, service health checks, and frontend-to-backend communication.

### Architecture

```text
Browser
   |
   | http://localhost:8080
   v
Frontend Container (NGINX)
   |
   | /api/ requests
   v
Backend Container (Node.js)
   |
   | PostgreSQL connection
   v
PostgreSQL Container
   |
   v
Named Volume: postgres_data
```

### Technology Stack

- Docker and Docker Compose
- React / Vite
- Node.js
- NGINX
- PostgreSQL 16 Alpine
- Environment variables and Docker named volumes
- Container health checks

### Project Structure

```text
.
├── backend/
├── frontend/
├── docs/
│   └── screenshots/
├── Dockerfile.backend
├── Dockerfile.frontend
├── docker-compose.yaml
├── nginx.conf
├── .dockerignore
├── .env
└── README.md
```

### Configuration

The `.env` file provides local configuration for the database, backend, frontend port, and other service settings.

Example values:

```dotenv
POSTGRES_DB=appdb
POSTGRES_USER=appuser
POSTGRES_PASSWORD=replace_with_local_password

DB_HOST=postgres
DB_PORT=5432
DB_NAME=appdb
DB_USER=appuser
DB_PASSWORD=replace_with_local_password

FRONTEND_PORT=8080
```

**Security:** The actual `.env` file must not be committed to Git. Use `.env.example` with placeholder values for sharing configuration. Do not include real passwords in screenshots.

### Docker Compose Services

| Service         | Purpose                                                         |
| --------------- | --------------------------------------------------------------- |
| `frontend`      | Serves the built frontend through NGINX and publishes port 8080 |
| `backend`       | Runs the Node.js API on container port 3000                     |
| `postgres`      | Stores application data in PostgreSQL                           |
| `postgres_data` | Persists PostgreSQL data across container recreation            |
| `app-network`   | Allows containers to communicate by service name                |

### Implementation Details

#### 1. Containerized frontend and backend

Separate Dockerfiles are used for the frontend and backend. The frontend Dockerfile builds the Vite application and serves the resulting static files through NGINX.

#### 2. Internal service communication

The backend connects to PostgreSQL using the Compose service hostname `postgres`, not `localhost`. Within a container, `localhost` refers to that same container.

#### 3. Persistent database storage

The named volume `postgres_data` is mounted at `/var/lib/postgresql/data`. This preserves database files when the PostgreSQL container is stopped or recreated.

#### 4. Health checks and startup order

PostgreSQL uses `pg_isready` to check database readiness. The backend health check requests `/api/health`.

Compose uses `depends_on` with `condition: service_healthy` so dependent services wait for the configured health checks.

#### 5. Frontend API routing

NGINX proxies API requests to the backend service. The frontend accesses the API through the same public origin, avoiding the need to expose the backend port directly to the host.

### Setup and Execution

#### Step 1 — Validate Compose configuration

```bash
docker compose config
```

This checks whether the Compose file and interpolated configuration are valid.

#### Step 2 — Build and start services

```bash
docker compose up -d --build
```

This builds the application images and starts the services in detached mode.

#### Step 3 — Check service status

```bash
docker compose ps
```

Check that the frontend and backend are running and the database is healthy.

#### Step 4 — View service logs

```bash
docker compose logs --tail=100
```

To inspect one service:

```bash
docker compose logs backend
docker compose logs postgres
docker compose logs frontend
```

#### Step 5 — Verify the application

Open the frontend:

```text
http://localhost:8080
```

Check the API health endpoint:

```bash
curl -i http://localhost:8080/api/health
```

The health endpoint should return a successful HTTP response.

#### Step 6 — Verify PostgreSQL

```bash
docker compose exec postgres \
  psql -U appuser -d appdb \
  -c '\dt'
```

This lists tables in the configured database. Replace the username or database name if your `.env` uses different values.

#### Step 7 — Stop the services

```bash
docker compose down
```

This stops and removes the Compose containers and network but preserves the named database volume.

**Warning:** `docker compose down -v` also removes the named volume and can delete local database data. Do not use it unless you intentionally want to remove that data.

### Screenshots and Evidence

#### 1. Docker Compose Service Status

![Docker Compose Service Status](docs/screenshots/task1-docker-compose.png)

Shows the status of the frontend, backend, and PostgreSQL services.

#### 2. Frontend Application

![Frontend Application](docs/screenshots/task1-frontend.png)

Shows the application running in the browser.

#### 3. API Health Check

![API Health Check](docs/screenshots/task1-api-health.png)

Shows the HTTP response from the backend health endpoint through NGINX.

#### 4. PostgreSQL Verification

![PostgreSQL Verification](docs/screenshots/task1-postgres.png)

Shows the database table listing or another successful database verification command.

> Replace these image paths with your actual screenshot filenames. Remove any screenshot section for which you do not have evidence.

### Task 1 Completion Checklist

- [x] Frontend Docker image builds successfully.
- [x] Backend Docker image builds successfully.
- [x] PostgreSQL starts with the configured database and credentials.
- [x] Database data uses a named volume.
- [x] Health checks are configured and verified.
- [x] Frontend is accessible through the published host port.
- [x] API health endpoint responds successfully.
- [x] PostgreSQL connectivity and schema are verified.
- [x] Screenshots are saved under `docs/screenshots/`.
- [x] `.env` and secrets are excluded from Git.

### Notes

This document records the local Docker Compose implementation for Task 1. Kubernetes, CI/CD, caching, search, monitoring, and logging belong to later assessment tasks.


## Task 2 — Kubernetes

Requires a local cluster (`kind` or `minikube`) with images built and loaded
(or pushed to a registry the cluster can pull from):

```bash
kubectl apply -f k8s/namespace-dev.yaml
kubectl apply -n dev -f k8s/
```

- `dev` namespace holds everything.
- `backend-service` / `postgres-service` are `ClusterIP` — internal only.
- `frontend-service` is `NodePort` (30080) for direct access; Task 3 adds
  Ingress on top for a friendlier path.
- Postgres uses a `PersistentVolumeClaim` bound to a `hostPath` PV so data
  survives pod restarts.
- `backend` has `readinessProbe`/`livenessProbe` hitting `/api/health/ready`
  and `/api/health/live` respectively — readiness checks the DB is
  reachable, liveness only checks the process is up (so a slow DB doesn't
  cause pointless container restarts).

## Task 3 — Ingress / API Gateway

```bash
# example for kind: install nginx-ingress, then
echo "127.0.0.1 node-react.local" | sudo tee -a /etc/hosts
kubectl apply -n dev -f k8s/ingress-dev.yaml
```

**Request path:** `Browser → Ingress → Service → Pod → PostgreSQL`
1. Browser resolves `node-react.local` to the ingress controller's IP (via
   `/etc/hosts` locally, or real DNS in prod).
2. The Ingress controller matches the path: `/api` or `/api/*` →
   `backend-service`; everything else → `frontend-service`.
3. The Service load-balances across matching pods via `kube-proxy` (or an
   eBPF equivalent).
4. The backend Pod talks to Postgres via `postgres-service`.

**Kubernetes DNS:** every Service gets a stable DNS name of the form
`<service>.<namespace>.svc.cluster.local` — e.g. `backend-service.dev.svc.
cluster.local`. Pods use this name instead of an IP because pod IPs change
on every restart/reschedule; the Service is the stable, load-balanced front
door.

**Debugging:**
- *Ingress reachable but backend is not:* check `kubectl get endpoints
  backend-service -n dev` — empty means the Service's label selector isn't
  matching any Ready pod. Then check backend pod logs and its readiness
  probe status.
- *Frontend can't reach backend:* confirm `VITE_API_BASE_URL` was baked in
  correctly at build time, that the browser's requests are going to `/api/*`
  (not `http://backend-service:4000` — that hostname only resolves inside
  the cluster, not from the browser), and check the Ingress controller logs
  for a 404/502 on that path.

**Evolving to microservices:** the Ingress already acts as a lightweight API
gateway routing by path prefix. Splitting the backend into multiple services
(e.g. `users-service`, `orders-service`) just means adding more path rules
(`/api/users`, `/api/orders`, …) pointing at more ClusterIP Services — the
Ingress, DNS, and probe patterns established here don't change.

## Task 4 — CI/CD & Multi-Environment Deployment

`.github/workflows/ci-cd.yml` triggers on push to:

| Branch pattern      | Target namespace |
|----------------------|-------------------|
| `master`             | `dev`             |
| `pre-release/v*`     | `preprod`         |
| `release/v*`         | `release`         |

Pipeline: install deps → build/validate both services → build Docker images
→ tag as `<branch>-<short-sha>` → push to GHCR → `sed`-patch the k8s
manifests with the new image tag and target namespace → `kubectl apply`.

**Secrets:** the registry push uses the ephemeral, repo-scoped
`GITHUB_TOKEN` — no long-lived registry credentials are stored. Cluster
access uses a base64-encoded kubeconfig stored as an encrypted Actions
secret (`KUBECONFIG_B64`), scoped to a service account limited to the
target namespace(s).

**Rollback:** two options, both included —
1. **Fast:** `kubectl rollout undo deployment/<name> -n <namespace>` (wired
   up as a manual `workflow_dispatch` job in the pipeline) — reverts to the
   previous ReplicaSet immediately.
2. **Precise:** re-run the pipeline against the previous commit/tag, which
   rebuilds and redeploys that exact known-good image — slower, but
   guarantees you're not relying on a ReplicaSet Kubernetes hasn't garbage
   collected yet.

## Task 5 — Platform Services: Redis, Queue, Search, Read/Write DB

Added to both `docker-compose.yml` and `k8s/`:
- **Redis** (`redis-deployment.yaml` / `redis-service.yaml`) — the backend
  connects via `REDIS_URL` (`backend/src/redisClient.js`) and exposes
  `/api/health/redis`.
- **Queue** (`bullmq-worker-deployment.yaml`) — BullMQ over Redis. Every
  `POST /api/items` enqueues an `item-created` job (`backend/src/queue.js`);
  a separate worker process (`backend/src/worker.js`, same image, different
  `command:`) consumes it. Decoupling the worker into its own Deployment
  means it scales and fails independently of the API.
- **Search** (`search-deployment.yaml` / `search-service.yaml`) — OpenSearch
  in single-node dev mode. The backend only does a health call today
  (`backend/src/search.js`, `/api/health/search`) — real indexing would hook
  into the same queue consumer.

**Simulated read/write DB cluster:** `backend/src/db.js` holds two separate
`pg.Pool` instances — `writePool` from `DB_WRITE_URL`, `readPool` from
`DB_READ_URL`. `write()` (INSERT/UPDATE/DELETE) always uses `writePool`;
`read()` (SELECT) uses `readPool`. Locally both env vars point at the same
Postgres instance, but the code already treats them as separate targets, so
pointing `DB_READ_URL` at a real replica later is a one-line config change —
no application code changes.

**Where routing logic lives:** in this repo it's explicit in application
code (`write()` vs `read()` helpers). The alternative is a DB proxy
(PgBouncer, ProxySQL, or a cloud-managed read/write splitter) that makes
routing transparent to the app — simpler application code, but another
component to operate and one more hop of latency.

**Replication lag:** a replica can be milliseconds to seconds behind the
primary. Anything that reads its own recent write — "did my update save?",
a redirect-after-POST that re-fetches the record, uniqueness checks before
an insert — must hit the writer/primary, not a replica, or it risks reading
stale data and behaving as if the write never happened.

## Task 6 — Observability, Scaling & Rate Limiting

`observability/`:
- **Prometheus** (`prometheus.yaml`) scrapes any pod annotated
  `prometheus.io/scrape: "true"` (the backend Deployment is annotated
  accordingly) in the `dev` namespace.
- **Grafana** (`grafana.yaml`) for dashboards on: backend CPU usage, backend
  memory usage, request rate & error rate, and replica count over time.
- **Fluent Bit** (`fluentbit-daemonset.yaml`) runs as a `DaemonSet` (one per
  node, so it picks up every pod's logs on that node regardless of which
  pods get scheduled where) and ships backend logs to **Loki**
  (`loki.yaml`).
- **HPA** (`hpa-backend.yaml`) scales the backend Deployment 2→6 replicas on
  CPU (70%) or memory (80%) utilization.

**What to alert on, and why:**
- **High error rate** (5xx / total requests) — the most direct signal
  something is actually broken for users, independent of load level.
- **High CPU / at max HPA replicas** — means the autoscaler is out of
  headroom; the next symptom is queueing and latency, not just slow scaling.
- **High p95/p99 latency** — catches degradation (slow queries, GC pauses,
  a struggling dependency) that error-rate and CPU alone can miss.
- **Sustained high request rate** without a matching replica increase —
  usually indicates the HPA is misconfigured or capped, not that traffic is
  fine.

**Verifying logs:** `kubectl logs -n dev daemonset/fluent-bit` to confirm
Fluent Bit is running and tailing files, then query Loki (via Grafana's
Explore view, `{job="backend"}`) to confirm entries are actually arriving
and are searchable/filterable by label.
# node-react-postgres-platform
# node-react-postgres-platform
# node-react-postgres-platform
# node-react-postgres-platform
