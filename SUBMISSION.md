# Orbis Containerization — Submission

## Reproduction Instructions

Clone this repository, then from the root directory run:

```bash
docker compose down -v   # ensures a fully clean start, including a fresh database volume
docker compose up --build
```

This builds and starts all four services — `database`, `backend`, `frontend`, and `proxy` — on first run. The backend automatically applies all Prisma migrations on startup, so no manual database setup is required.

Once all containers report as running (`docker compose ps`), open `http://localhost` in a browser. The site should load and the events list should be browsable.

**Known limitation:** login/register do not function, because the backend is configured with placeholder Auth0 credentials (`https://dev-dummy.auth0.com/`) rather than a real Auth0 tenant. This is an external dependency outside the scope of this containerization task — the placeholder values exist only so the backend can start without crashing.

---

## Phase 1: End-to-End Build and Verification

Six issues were found and fixed while getting the stack running end-to-end.

### Bug 1 — Backend could not reach the database (network segmentation)

**Symptom:** The `backend` container repeatedly crashed and restarted, logging connection failures and eventually exiting after exhausting its retry attempts.

```
orbis-backend  | prisma:warn Prisma failed to detect the libssl/openssl version to use, and may not work as expected. Defaulting to "openssl-1.1.x".
orbis-backend  | Please manually install OpenSSL and try installing Prisma again.
orbis-backend  | Database connection attempt 1 failed: PrismaClientInitializationError: Unable to require(`/app/node_modules/.prisma/client/libquery_engine-linux-musl-arm64-openssl-1.1.x.so.node`).
orbis-backend  | The Prisma engines do not seem to be compatible with your system. Please refer to the documentation about Prisma's system requirements: https://pris.ly/d/system-requirements
orbis-backend  |
orbis-backend  | Details: Error loading shared library libssl.so.1.1: No such file or directory (needed by /app/node_modules/.prisma/client/libquery_engine-linux-musl-arm64-openssl-1.1.x.so.node)
orbis-backend  |     at Object.loadLibrary (/app/node_modules/@prisma/client/runtime/library.js:111:9152)
orbis-backend  |     at async kr.loadEngine (/app/node_modules/@prisma/client/runtime/library.js:112:448)
orbis-backend  |     at async kr.instantiateLibrary (/app/node_modules/@prisma/client/runtime/library.js:111:11508)
orbis-backend  |     at async kr.start (/app/node_modules/@prisma/client/runtime/library.js:112:1976)
```

**Diagnosis:**
- `database` was only on `backend-network`; `backend` was only on `frontend-network` — no shared network, so no path existed between them.
- Not a timing or credentials issue — the backend had zero connectivity to the database.

**Fix:** Added `backend-network` to `backend`'s `networks:` list, so it now bridges both networks.

### Bug 2 — Prisma engine incompatible with Apple Silicon + Alpine

**Symptom:**
```
prisma:warn Prisma failed to detect the libssl/openssl version to use, and may not work as expected. Defaulting to "openssl-1.1.x".
Database connection attempt 1 failed: PrismaClientInitializationError: Unable to require(`/app/node_modules/.prisma/client/libquery_engine-linux-musl-arm64-openssl-1.1.x.so.node`).
Details: Error loading shared library libssl.so.1.1: No such file or directory
```

**Diagnosis:**
- Prisma's query engine is a precompiled binary tied to exact CPU architecture, C library, and OpenSSL version.
- `node:20-alpine` on Apple Silicon (ARM64) uses Alpine/`musl`, which has no OpenSSL by default.
- Without OpenSSL present at build time, Prisma guessed the wrong engine binary, which didn't exist at runtime.
- Architecture-specific: unlikely to occur on an Intel Mac, standard x86 Linux CI, or Windows/WSL2.

**Fix:** Added `RUN apk add --no-cache openssl` to `backend/Dockerfile`, before dependency installation.

### Bug 3 — Nginx proxying to a nonexistent hostname

**Symptom:** `curl http://localhost/api/events` returned `502 Bad Gateway`.

```
$ curl -v http://localhost/api/events
< HTTP/1.1 502 Bad Gateway
< Server: nginx/1.31.6
<html>
<head><title>502 Bad Gateway</title></head>
<body>
<center><h1>502 Bad Gateway</h1></center>
<hr><center>nginx/1.31.6</center>
</body>
</html>

$ docker compose ps
NAME             ...   CREATED        STATUS        PORTS
orbis-proxy      ...   35 hours ago   Up 35 hours   0.0.0.0:80->80/tcp
```
`docker compose ps` revealed the `proxy` container had been running continuously for 35 hours — well before the `default.conf` fix was made — confirming the container had never actually reloaded the updated configuration, even though the file on disk (confirmed via `docker exec orbis-proxy cat /etc/nginx/conf.d/default.conf`) already showed the corrected `http://backend:4000`. This is because Nginx only reads its config once at process start, and Docker Compose does not detect a bind-mounted file's content changing as a reason to recreate a container with no `build:` step.

```
$ docker compose up -d --force-recreate proxy
 ✔ Container orbis-proxy    Started

$ curl -v http://localhost/api/events
< HTTP/1.1 500 Internal Server Error
```
After forcing recreation, the 502 was resolved (replaced by a 500, which is Bug 4, documented below) — confirming the hostname fix itself was correct all along, and the remaining issue was purely the stale running container.

**Diagnosis:**
- `nginx/default.conf` pointed `$backend_service` at `http://backend-api:4000` — no such hostname exists; the real Compose service name is `backend`.
- Docker's internal DNS only resolves real service/container names, so every `/api/` request failed before reaching the backend.
- Secondary issue found while fixing: editing the bind-mounted config file doesn't make a running container reload it — Nginx reads config once at process start, and Compose doesn't detect bind-mount content changes as a reason to recreate a container with no `build:` step. Confirmed via `docker compose ps` showing the proxy container had been up for 35 hours, predating the fix.

**Fix:** Changed `backend-api` to `backend` in `nginx/default.conf`; applied with `docker compose up -d --force-recreate proxy`.

### Bug 4 — Database had no tables (missing migrations)

**Symptom:** After fixing Bug 3, API requests returned `500 Internal Server Error`.

```
orbis-backend  | prisma:error
orbis-backend  | Invalid `prisma.event.findMany()` invocation:
orbis-backend  |
orbis-backend  | The table `public.Event` does not exist in the current database.
orbis-backend  | Error fetching events: PrismaClientKnownRequestError:
orbis-backend  | Invalid `prisma.event.findMany()` invocation:
orbis-backend  |
orbis-backend  | The table `public.Event` does not exist in the current database.
orbis-backend  |     at Mn.handleRequestError (/app/node_modules/@prisma/client/runtime/library.js:121:7338)
orbis-backend  |     at async getEvents (file:///app/src/controllers/events.js:149:20) {
orbis-backend  |   code: 'P2021',
orbis-backend  |   clientVersion: '6.0.1',
orbis-backend  |   meta: { modelName: 'Event', table: 'public.Event' }
orbis-backend  | }
```

Manually applying migrations confirmed the diagnosis:
```
$ docker compose exec backend npx prisma migrate deploy
20 migrations found in prisma/migrations
Applying migration `20241215194913_init`
...
Applying migration `20250313080701_add_join_hash_to_team`
All migrations have been successfully applied.

$ curl -v http://localhost/api/events
< HTTP/1.1 200 OK
[]
```

**Diagnosis:**
- PostgreSQL starts with an empty `orbis` database — nothing automatically applies the schema.
- `backend/prisma/migrations/` is the authoritative, current migration history.
- A separate `backend/database/schema.sql` was found to be a stale snapshot (enum values don't match the current Prisma schema) and was not used.

**Fix:** Modified the backend `Dockerfile`'s final `CMD` from `CMD ["npm", "start"]` to:
```dockerfile
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
```
This ensures any fresh `docker compose up` automatically applies all pending migrations before the server starts, with no manual step required.

### Bug 5 — Frontend calling the wrong backend URL (Vite build-time env var)

**Symptom:** Browser network requests went directly to `http://localhost:4000/...` instead of through the reverse proxy, and failed since port 4000 is not published to the host.

**Diagnosis:**
- Vite `VITE_` env vars are baked into the JS bundle at *build time*, not read at runtime.
- `VITE_API_URL` was never set during the build, so `api.js` fell back to its hardcoded default, `http://localhost:4000` — unreachable since only port 80 is published.
- Subtler issue found while fixing: the fallback used `import.meta.env.VITE_API_URL || 'http://localhost:4000'`. An empty string is falsy in JS, so even an intentional empty-string build arg still fell through to the hardcoded default.

**Fix:**
- Added `ARG VITE_API_URL=""` and `ENV VITE_API_URL=$VITE_API_URL` to `frontend/Dockerfile`.
- Added a matching `args: VITE_API_URL: ""` entry under the `frontend` service's `build:` section in `docker-compose.yml`.
- Changed the fallback check in `frontend/src/api/api.js` from `||` to an explicit `undefined` check:
```js
baseURL: import.meta.env.VITE_API_URL !== undefined ? import.meta.env.VITE_API_URL : 'http://localhost:4000',
```

### Bug 6 — Missing Supabase environment variables crashing the frontend entirely

**Symptom:** The site loaded a completely blank page. Browser console showed:
```
Uncaught Error: supabaseUrl is required.
```

**Diagnosis:**
- `frontend/src/helpers/supabase.js` calls `createClient()` at module load time (not inside a function) — a top-level side effect.
- With `VITE_SUPABASE_URL` unset, this throws immediately, crashing the whole React bundle before anything renders.
- Same problem class already existed for Auth0 elsewhere in the project; original developers solved it with dummy placeholder values in `docker-compose.yml`.

**Fix:** Applied the same pattern — added placeholder `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`/`VITE_SUPABASE_SERVICE_ROLE_KEY` build args. Real Supabase-dependent features (likely image uploads) remain non-functional — outside this task's scope.

---

## Phase 2: Frontend Image Optimization

**Requirement:** final frontend image strictly under 110MB.

**Before:**
```
$ docker build -t frontend-before-test .   # original single-stage Dockerfile
$ docker images | grep frontend-before-test
frontend-before-test:latest   988cae7f411b   1.89GB
```

**After:**
```
$ docker images | grep frontend
containerization-task-frontend:latest   af68bcc53c3c   93MB
```

**Result:** 1.89GB → 93MB — approximately a **20x reduction**, comfortably under the 110MB requirement.

**What was changed:**
- Original: single-stage `node:20` (full Debian base, ~1.1GB) — final image shipped the entire Node.js toolchain and full `node_modules` alongside the actual static output.
- Rewrote as multi-stage: **Stage 1** (`node:20-alpine`) installs dependencies and runs `npm run build`, producing `dist/`; discarded after build. **Stage 2** (`nginx:alpine`) copies only `dist/` via `COPY --from=build`. No build toolchain survives into the final image.
- Added `.dockerignore` (`node_modules`, `dist`, `.env`, `.git`) to keep host artifacts out of the build context.
- Reordered `COPY package*.json ./` + `RUN npm install` before `COPY . .`, so dependency installs are cached across source-only rebuilds (sets up Phase 6's caching analysis).
- Replaced `npx serve` with `CMD ["nginx", "-g", "daemon off;"]` — the standard way to serve static files in production, consistent with Nginx already being the project's reverse proxy.

---

## Phase 3: Database Configuration and Volume Persistence

**Requirements already satisfied by the existing setup (verified, no code changes needed):**
- Database configured exclusively via environment variables (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` in `docker-compose.yml`'s `environment:` block) — no custom Dockerfile for this service, and `backend/src/config/database.js` reads `process.env.DATABASE_URL` with no hardcoded fallback.
- No `ports:` mapping defined for the `database` service — port 5432 is never published to the host.
- Named volume `postgres_data` already mounted at `/var/lib/postgresql/data`.

**Verification 1 — port unreachable from host, reachable internally:**
```
$ docker compose ps
NAME       ...   PORTS
orbis-db   ...   5432/tcp        <- no host port mapping (contrast with orbis-proxy: 0.0.0.0:80->80/tcp)

$ nc -zv localhost 5432
nc: connectx to localhost port 5432 (tcp) failed: Connection refused

$ docker compose exec database psql -U postgres -d orbis -c "SELECT 1;"
 ?column?
----------
        1
(1 row)
```
Confirms: unreachable from the host machine, reachable from within the Docker network.

**Verification 2 — data persists across `docker compose down` / `up`:**
```
$ docker compose exec database psql -U postgres -d orbis -c "CREATE TABLE persistence_test (id serial primary key, note text); INSERT INTO persistence_test (note) VALUES ('Phase 3 persistence check'); SELECT * FROM persistence_test;"
CREATE TABLE
INSERT 0 1
 id |           note
----+---------------------------
  1 | Phase 3 persistence check
(1 row)

$ docker compose down
 ✔ Container orbis-proxy     Removed
 ✔ Container orbis-frontend  Removed
 ✔ Container orbis-backend   Removed
 ✔ Container orbis-db        Removed
 ✔ Network ...frontend-network  Removed
 ✔ Network ...backend-network   Removed

$ docker compose up -d
 ✔ Container orbis-frontend  Started
 ✔ Container orbis-db        Started
 ✔ Container orbis-backend   Started
 ✔ Container orbis-proxy     Started

$ docker compose exec database psql -U postgres -d orbis -c "SELECT * FROM persistence_test;"
 id |           note
----+---------------------------
  1 | Phase 3 persistence check
(1 row)
```
Note: `docker compose down` was used **without** `-v`, deliberately preserving the named volume (as opposed to Phase 1's use of `down -v`, which intentionally wiped the volume to test migrations against a clean database). The test record survived full container destruction and recreation, confirming the named volume — not the container filesystem — is what Postgres's data actually lives in.

## Phase 4: Network Segmentation and Isolation

**Target architecture:** frontend and reverse proxy on one network; backend and database on a separate, isolated network reachable only by the backend; only the reverse proxy exposed to the host.

**Gap found and fixed:** the `proxy` service was originally on *both* `frontend-network` and `backend-network`, giving it a direct path to the database that bypassed the backend entirely. Removed `backend-network` from `proxy`'s `networks:` list in `docker-compose.yml` — it now only needs `frontend-network`, since both `frontend` and `backend` (which bridges both networks) are reachable from there.

**`docker network inspect` — `frontend-network`:** contains `orbis-proxy`, `orbis-backend`, `orbis-frontend`.
```json
"Containers": {
    "...": { "Name": "orbis-proxy", "IPv4Address": "172.19.0.4/16" },
    "...": { "Name": "orbis-backend", "IPv4Address": "172.19.0.3/16" },
    "...": { "Name": "orbis-frontend", "IPv4Address": "172.19.0.2/16" }
}
```

**`docker network inspect` — `backend-network`:** contains only `orbis-backend` and `orbis-db` — `proxy` is confirmed absent.
```json
"Containers": {
    "...": { "Name": "orbis-backend", "IPv4Address": "172.20.0.3/16" },
    "...": { "Name": "orbis-db", "IPv4Address": "172.20.0.2/16" }
}
```

**Verification — backend port unreachable from host:**
```
$ nc -zv localhost 4000
nc: connectx to localhost port 4000 (tcp) failed: Connection refused
```

**Verification — proxy can no longer reach the database (the actual change this phase made):**
```
$ docker compose exec proxy nc -zv database 5432
nc: bad address 'database'
```
`proxy` can't even resolve the hostname `database` anymore, since it no longer shares a network with it.

**Verification — backend can still reach the database (intended exception):**
```
$ docker compose exec backend nc -zv database 5432
database (172.20.0.2:5432) open
```

**Verification — application still functions correctly after tightening the network:**
```
$ curl -v http://localhost/api/events
< HTTP/1.1 200 OK
[]
```

**Why this matters:** Phase 3 protected the database from the outside world (host/internet); Phase 4 protects it from the rest of the system itself. If `proxy` or `frontend` were ever compromised, network segmentation means that compromise alone still doesn't grant a path to the database — an attacker would additionally have to compromise `backend` specifically. This mirrors a standard three-tier architecture: public tier, application tier (enforces logic/access control), data tier (never directly exposed to anything but the application tier).

## Phase 5: Nginx SSL Termination and HTTPS Redirection

**Approach:** Self-signed certificate rather than Let's Encrypt, since Let's Encrypt requires a real, publicly verifiable domain — `localhost` has nothing for it to verify.

**Certificate generation:**
```bash
mkdir -p nginx/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/ssl/privkey.pem \
  -out nginx/ssl/fullchain.pem \
  -subj "/C=IN/ST=Karnataka/L=Mangalore/O=Orbis/CN=localhost"
```

**Configuration changes:**
- `nginx/default.conf` split into two server blocks: one on port 80 that only issues `return 301 https://$host$request_uri;`, and one on `443 ssl` that holds `ssl_certificate`/`ssl_certificate_key`, restricts `ssl_protocols` to `TLSv1.2 TLSv1.3`, and contains the existing `/api/` and `/` proxy_pass locations unchanged — SSL is terminated entirely at Nginx; `frontend` and `backend` continue receiving plain HTTP exactly as before.
- `docker-compose.yml`'s `proxy` service now publishes `443:443` in addition to `80:80`, and mounts `./nginx/ssl:/etc/nginx/ssl:ro`.

**Verification — HTTP redirects to HTTPS:**
```
$ curl -v http://localhost/api/events
< HTTP/1.1 301 Moved Permanently
< Location: https://localhost/api/events
```

**Verification — HTTPS connection succeeds with a real TLS 1.3 handshake:**
```
$ curl -vk https://localhost/api/events
* TLSv1.3 (OUT), TLS handshake, Client hello (1):
* TLSv1.3 (IN), TLS handshake, Server hello (2):
* SSL connection using TLSv1.3 / TLS_AES_256_GCM_SHA384 / X25519 / RSASSA-PSS
* Server certificate:
*  subject: C=IN; ST=Karnataka; L=Mangalore; O=Orbis; CN=localhost
*  start date: Oct  3 15:18:50 2026 GMT
*  expire date: Oct  3 15:18:50 2027 GMT
*  issuer: C=IN; ST=Karnataka; L=Mangalore; O=Orbis; CN=localhost
*  SSL certificate verify result: self-signed certificate (18), continuing anyway.
< HTTP/1.1 200 OK
[]
```
`-k` was required only to bypass curl's *trust* check (no public CA vouches for a self-signed cert) — the encryption itself, as shown above, is a genuine negotiated TLS 1.3 session with the `TLS_AES_256_GCM_SHA384` cipher suite.

## Phase 6: Consolidated Orchestration and Build Cache Analysis

### Part A: Extracting Configuration into Environment Files

All previously hardcoded values in `docker-compose.yml` (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DATABASE_URL`, `AUTH0_ISSUER_BASE_URL`, `AUTH0_AUDIENCE`, and all four `VITE_*` frontend build args) were extracted into `${VARIABLE}` references, resolved via a `.env` file.

Following standard practice, `.env` itself is excluded via `.gitignore` and was never committed — only `.env.example` (containing the same dummy/placeholder values, since none of them are real secrets in this project) is committed, documenting exactly what the project expects. Reproduction requires one additional step: `cp .env.example .env` before `docker compose up --build`.

### Part B: Build Cache Analysis

**Source change:** modified the startup log line in `backend/server.js` (a trivial, purely cosmetic change, to isolate the caching behavior from any functional risk).

**First rebuild (before fixing Dockerfile ordering) — `npm ci` reruns unnecessarily:**
```
#9 [4/6] COPY . .
#9 DONE 0.1s

#10 [5/6] RUN npm ci
#10 21.93  added 191 packages, and audited 192 packages in 22s
#10 DONE 22.1s

#11 [6/6] RUN npx prisma generate
#11 DONE 2.0s
```
At this point, `backend/Dockerfile` still copied all source code (`COPY . .`) before running `npm ci` — the original ordering, never updated to match the Phase 2 pattern already applied to the frontend. Because `server.js` changed, `COPY . .`'s cache was invalidated, and since Docker invalidates every subsequent layer once one layer's cache breaks, `npm ci` was forced to rerun from scratch — a real, measured 22.1 seconds, despite `package.json` never actually changing.

**Fix applied:** reordered `backend/Dockerfile` to copy `package*.json` and run `npm ci` *before* copying the rest of the source — exactly the pattern already used in the frontend Dockerfile since Phase 2:
```dockerfile
FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
```

**Second rebuild (after fix, with another source change) — `npm ci` now stays cached:**
```
#9 [4/7] COPY package*.json ./
#9 CACHED

#10 [5/7] RUN npm ci
#10 CACHED

#11 [6/7] COPY . .
#11 DONE 0.0s

#12 [7/7] RUN npx prisma generate
#12 DONE 2.3s
```

**Analysis:** `RUN npm ci` dropped from a real **22.1 seconds, rerun** to **CACHED (effectively 0s)** — the exact same source code change, the exact same dependencies, the only difference being instruction order in the Dockerfile. This directly demonstrates Docker's layer caching rule: build steps are cached in strict sequence, and once any single layer's inputs change, every layer after it is invalidated too — regardless of whether that later step actually depends on what changed. By copying dependency manifests (`package*.json`) and installing dependencies *before* copying the rest of the source code, a pure source-code edit only invalidates `COPY . .` and whatever comes after it, while the genuinely expensive dependency-install step remains cached and is skipped entirely. This is the same optimization already applied to the frontend Dockerfile in Phase 2, now confirmed with real before/after timing on the backend as well.