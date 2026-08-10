# Deploying to VLBELAPPIDC

The AppiTech VM at `153.109.8.87`, following the conventions in the server
documentation: apps under `/opt/apps`, persistent data under `/srv/data`, and a
shared Traefik on the `traefik-public` network.

The base `docker-compose.yml` ships a Caddy service for standalone use. On this
VM Traefik does that job, so `docker-compose.traefik.yml` overrides the routing
and leaves Caddy out.

---

## Before you start

Ask for a DNS name — `wiki.appitech.hevs.ch` follows the existing pattern
(`gate.`, `careconvers.`, `xrxp.`).

**Check outbound access.** The documented egress rules list only ssh,
`gitlab.com` and `gitlab.hevs.ch`. Outline needs more than that:

| Destination | For | If blocked |
| --- | --- | --- |
| `gitlab.com` | OIDC sign-in, task sync | Already allowed |
| Let's Encrypt | Traefik certificates | Already working for other apps |
| Docker Hub | Base images at build time | Build fails |
| SMTP relay | Invites, notifications | Use the HES-SO internal relay |

The first two are proven by the other containers. The last one is the reason to
use HES-SO's SMTP rather than Brevo or Resend — an external mail provider is
very likely blocked, and the internal relay is a better answer anyway.

If there's an outbound proxy, Outline honours it: `server/utils/fetch.ts` uses
`proxy-from-env`, so `HTTPS_PROXY` and `NO_PROXY` in `.env` route the GitLab and
OIDC calls correctly.

---

## Deploy

Following section 2.1 of the server documentation.

```bash
sudo mkdir -p /opt/apps/outline
sudo chown $USER:$USER /opt/apps/outline
git clone <your fork> /opt/apps/outline
cd /opt/apps/outline/deploy

sudo mkdir -p /srv/data/outline/{postgres,redis,uploads,backups}
sudo chown -R $USER:$USER /srv/data/outline

cp .env.example .env
```

Edit `.env`:

```bash
OUTLINE_URL=https://wiki.appitech.hevs.ch
OUTLINE_DOMAIN=wiki.appitech.hevs.ch

POSTGRES_PASSWORD=<openssl rand -hex 24>
SECRET_KEY=<openssl rand -hex 32>     # exactly 64 hex characters
UTILS_SECRET=<openssl rand -hex 32>

OIDC_CLIENT_ID=<gitlab app>
OIDC_CLIENT_SECRET=<gitlab app>
OIDC_ISSUER_URL=https://gitlab.com

GITLAB_TASKS_URL=https://gitlab.com
GITLAB_TASKS_TOKEN=<group access token, api scope>
GITLAB_TASKS_FALLBACK_PROJECT=appitech/wiki-mirror
```

`OUTLINE_DOMAIN` is what the Traefik router rule matches, so it must be set
here even though Caddy isn't running.

Then:

```bash
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d --build
```

The first build takes 15–25 minutes. With 8 cores and 32 GB there's plenty of
headroom; `NODE_BUILD_MEMORY=8192` is fine as it stands.

```bash
docker compose logs -f outline
```

---

## Check the Traefik wiring

The override assumes two names owned by `/opt/traefik/docker-compose.yml`:

- entrypoint `websecure`
- certificate resolver `letsencrypt`

If the other apps use different names, edit the labels to match. Confirm with:

```bash
grep -E "entryPoints|certificatesresolvers" /opt/traefik/docker-compose.yml
```

Then check the router appears at
`http://vlbelappidc.hevs.ch:8000/dashboard/`.

The base file also publishes `127.0.0.1:3000`. That's loopback only and not
reachable from the DMZ, so it's harmless — and useful for `curl` from the host
when debugging.

---

## After first boot

1. **Sign in** with GitLab. Verify you land as Admin.
2. **Settings → Security → require an invite.** Without it, *any* gitlab.com
   account that finds the URL gets provisioned. This matters the moment the
   host is public.
3. Create the **Tag vocabulary** page.
4. Add SMTP once you have the HES-SO relay details, then invite people.

---

## Updates

Per section 2.2, plus the review step this fork needs:

```bash
cd /opt/apps/outline
git pull
cd deploy
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d --build
```

**Read `../UPGRADING.md` before pulling from upstream Outline.** This tree
carries eleven core patches that fail silently rather than loudly — a clean
build is not evidence they still work.

---

## Backups

The Sinf Bronze service gives daily VM snapshots with 30-day retention. That
covers catastrophe, but a snapshot of a running Postgres is *crash-consistent*,
not clean — it's a recoverable state, not a guaranteed-good dump.

Add a logical dump alongside it:

```bash
0 3 * * * cd /opt/apps/outline/deploy && docker compose exec -T postgres \
  pg_dump -U outline outline | gzip > /srv/data/outline/backups/outline-$(date +\%F).sql.gz
```

Prune older than 30 days to match the snapshot policy. Uploads live in
`/srv/data/outline/uploads` and are covered by the snapshot.

This matters more than usual here: **upgrades run migrations automatically on
boot**, so rolling back needs a database restore rather than a `git checkout`.

---

## Notes for the service inventory

To match the format of the other entries:

| | |
| --- | --- |
| **Répertoire** | `/opt/apps/outline` |
| **Services** | Outline (Node.js), PostgreSQL, Redis |
| **URL** | `https://wiki.appitech.hevs.ch/` |
| **Images** | `node:26-slim` (built), `postgres:16-alpine`, `redis:7-alpine` |
| **Exposition** | Traefik (DMZ) |
| **Sécurité** | TLS, GitLab OIDC, invitation requise |
| **Volumes** | `/srv/data/outline/{postgres,redis,uploads}` |
| **Dépendances externes** | gitlab.com (OIDC + issue sync), SMTP relay |

Environment is documented as *test* with *moderate* data criticality. Worth
keeping that in mind about what goes in the wiki — it will accumulate meeting
notes and project context quickly, and those become the sort of thing people
assume is safe.
