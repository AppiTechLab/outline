# Running Outline with Docker Compose

Builds Outline from this source tree. Runs on `http://localhost:3000` by
default; a `proxy` profile adds Caddy for serving a public domain over HTTPS.

| Service | What it does |
| --- | --- |
| `postgres` | Postgres 16, data in the `postgres-data` volume |
| `redis` | Redis 7, used for queues, caching and websocket pub/sub |
| `outline` | The app itself, built from `deploy/Dockerfile`. Published on `127.0.0.1:3000` |
| `caddy` | Reverse proxy on :80/:443 with automatic Let's Encrypt certs. Only starts under `--profile proxy` |

Uploads live in the `outline-data` volume (`FILE_STORAGE=local`).

## Prerequisites

- Docker Engine with the Compose plugin (or Docker Desktop)
- ~8 GB of memory available to Docker for the build, and ~15 GB of disk

For a public domain you additionally need an A/AAAA record pointing here and
ports 80 and 443 reachable from the internet, so Caddy can issue a certificate.

## 1. Configure

```bash
cd deploy
cp .env.example .env
```

Generate the three secrets:

```bash
openssl rand -hex 24   # POSTGRES_PASSWORD
openssl rand -hex 32   # SECRET_KEY
openssl rand -hex 32   # UTILS_SECRET
```

On Windows without `openssl`, use PowerShell. Note `Get-Random` is *not*
cryptographically secure and shouldn't be used for `SECRET_KEY`:

```powershell
$b = [byte[]]::new(32)
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
-join ($b | ForEach-Object { '{0:x2}' -f $_ })
```

Use a different value for each of the three. Two constraints to get right:

- **`SECRET_KEY` must be exactly 64 hexadecimal characters** — 32 random bytes,
  not 32 characters. `env.ts` enforces it and the server won't boot otherwise.
  Verify with:
  `(Select-String -Path .env -Pattern '^SECRET_KEY=(.*)$').Matches.Groups[1].Value.Length`
- **`POSTGRES_PASSWORD` must be alphanumeric.** It goes into `DATABASE_URL`
  unescaped, so `@ : / # ?` would corrupt the connection string. Hex output
  sidesteps this.

Leave `OUTLINE_URL` at `http://localhost:3000` for a local install.

> Keep `SECRET_KEY` safe and unchanged. Rotating it invalidates every session
> and makes previously encrypted values unrecoverable.
>
> `POSTGRES_PASSWORD` is only read when Postgres initialises an empty data
> directory. Changing it after the first `up` updates Outline's connection
> string but *not* the database, and the app will fail to authenticate. To
> change it later, alter the role inside the running container:
> `docker compose exec postgres psql -U outline -c "ALTER USER outline PASSWORD 'new';"`

## 2. Set up sign-in

Outline needs an SSO provider to create the very first account — email sign-in
only works for users that already exist, so it can't bootstrap an install.
This install uses **Discord** (Option A). The others are documented in case you
add them later; Outline supports several providers at once.

### Option A — Discord

Works with an ordinary personal Discord account. No organization, no custom
domain, no admin approval.

1. Create a Discord server if you don't have one to use — it will become the
   Outline workspace, and its members are who can sign in.
2. Enable **User Settings → Advanced → Developer Mode**, then right-click the
   server icon → **Copy Server ID** → `DISCORD_SERVER_ID`
3. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
   → **New Application**, name it `Outline`
4. **OAuth2** → copy *Client ID* → `DISCORD_CLIENT_ID`. Under *Client Secret*
   click **Reset Secret** to reveal it → `DISCORD_CLIENT_SECRET`
5. Still under **OAuth2** → **Redirects** → **Add Redirect**:

   ```
   http://localhost:3000/auth/discord.callback
   ```

   Discord accepts plain-http localhost redirects, so no tunnel or self-signed
   certificate is needed. Add the `https://YOUR_DOMAIN/...` variant alongside it
   if you later publish the instance — Discord allows several redirects, and
   Outline picks the one matching `OUTLINE_URL`.

   Save changes. Outline requests the `identify`, `email`, `guilds` and
   `guilds.members.read` scopes at sign-in time — you don't preselect them here.

Setting `DISCORD_SERVER_ID` matters for more than naming: `discord.ts` checks
the user's guild list on every sign-in and rejects anyone who isn't a member.
Leave it unset and any Discord account on the internet can create an account on
your wiki. To narrow it further, `DISCORD_SERVER_ROLES` restricts sign-in to
holders of specific roles.

### Option B — Microsoft Entra ID (work or school account)

1. Go to the [Azure portal](https://portal.azure.com) → **Microsoft Entra ID** →
   **App registrations** → **New registration**
2. Name it `Outline`. Supported account types: **Accounts in this organizational
   directory only (single tenant)**
3. Redirect URI: platform **Web**, value:

   ```
   https://YOUR_DOMAIN/auth/azure.callback
   ```

4. From the **Overview** page copy *Application (client) ID* → `AZURE_CLIENT_ID`
   and *Directory (tenant) ID* → `AZURE_TENANT_ID`
5. **Certificates & secrets** → **New client secret**. Copy the **Value**
   column (not the Secret ID) → `AZURE_CLIENT_SECRET`. It's only shown once.
6. **API permissions** → confirm **Microsoft Graph → Delegated → `User.Read`**
   is listed; it's added by default. Nothing more is needed — `User.Read` is
   enough to read the tenant's `displayName`, which Outline uses as the
   workspace name.

If your institution has locked down app registrations you'll need IT to create
it, or to grant admin consent. Note that with a single-tenant app, anyone in
your school's tenant can sign in and get an account provisioned. Restrict this
afterwards under **Settings → Security** in Outline.

> Requires a work or school account. Personal Microsoft accounts
> (`@outlook.com`, `@hotmail.com`, `@live.com`) have no Entra tenant, and the
> Graph `/organization` endpoint Outline calls doesn't support them.

### Option C — Google

1. Go to the [Google Cloud Console credentials page](https://console.cloud.google.com/apis/credentials)
2. Configure the OAuth consent screen (Internal if you're on Workspace, otherwise External)
3. **Create credentials → OAuth client ID → Web application**
4. Add the authorized redirect URI:

   ```
   https://YOUR_DOMAIN/auth/google.callback
   ```

5. Copy the client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`

The first person to sign in becomes the workspace admin.

> **A personal `@gmail.com` address cannot create the workspace.**
> `plugins/google/server/auth/google.ts` rejects sign-ins that carry no Google
> Workspace `hd` (hosted domain) claim when no team exists yet, with
> *"Cannot create account using personal gmail address"*. The first sign-in must
> come from a Google Workspace account on a custom domain. Once the workspace
> exists, personal Gmail addresses can be invited and sign in normally.
>
> If you don't have Workspace, bootstrap with a different provider — Google is
> the only one with this restriction — then add Google afterwards.

## 3. Build and start

```bash
docker compose up -d --build
```

The first build takes 15–25 minutes — it runs a full `yarn install` and Vite
production build. Subsequent builds reuse Docker layer cache and are much
faster unless `package.json` or `yarn.lock` changed.

Watch it come up:

```bash
docker compose logs -f outline
```

Then open **http://localhost:3000**.

## 4. Later: serving a public domain

Nothing needs rebuilding — it's config plus one extra container.

1. Point an A/AAAA record at this host and open ports 80 and 443
2. In `.env` set `OUTLINE_DOMAIN`, `LETSENCRYPT_EMAIL`, and change
   `OUTLINE_URL` to `https://your.domain`
3. Add `https://your.domain/auth/discord.callback` to the Discord app's
   redirect list
4. Start with the proxy profile:

   ```bash
   docker compose --profile proxy up -d
   ```

Caddy obtains the certificate on first request. `docker compose logs -f caddy`
if it doesn't.

Changing `OUTLINE_URL` on an existing workspace signs everyone out — sessions
are bound to the origin — but the data is untouched.

## Everyday commands

```bash
docker compose ps                      # status
docker compose logs -f outline         # tail app logs
docker compose restart outline         # restart just the app
docker compose down                    # stop everything (volumes kept)
docker compose down -v                 # stop and DELETE all data
```

## Upgrading

After pulling new commits:

```bash
git pull
cd deploy
docker compose up -d --build
```

Migrations apply themselves. `server/scripts/checkMigrations.ts` runs on every
startup and calls `migrations.up()` for anything pending, holding a Redis mutex
so concurrent web processes can't race. There is no manual migration step.

## Backups

Everything that matters lives in two volumes: `outline_postgres-data` and
`outline_outline-data`.

```bash
# Database
docker compose exec -T postgres pg_dump -U outline outline | gzip > outline-$(date +%F).sql.gz

# Uploaded files
docker run --rm -v outline_outline-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/outline-files-$(date +%F).tar.gz -C /data .
```

## Troubleshooting

**Build is killed partway through.** The Vite build ran out of memory. Raise
Docker's memory limit (Docker Desktop → Settings → Resources) and increase
`NODE_BUILD_MEMORY` in `.env`.

**Caddy can't get a certificate.** Check DNS actually resolves to this server
and that nothing else is bound to :80/:443 — `docker compose logs caddy` will
say which. Let's Encrypt rate-limits failures, so fix DNS before retrying a lot.

**Migrations fail on startup.** `docker compose logs outline` shows the error.
The app applies migrations itself; there is no separate job to rerun.

**No sign-in options on the login page.** The provider credentials aren't
reaching the container. Confirm with
`docker compose exec outline printenv | grep -E 'DISCORD|AZURE|GOOGLE'`. Both
the ID and the secret must be set — each is ignored without the other.

**Discord: "Invalid OAuth2 redirect_uri".** The redirect in the Discord
developer portal must match `URL` exactly, including scheme and no trailing
slash: `https://YOUR_DOMAIN/auth/discord.callback`.

**Discord: rejected after authorizing.** You're not a member of the server in
`DISCORD_SERVER_ID` (or lack a role in `DISCORD_SERVER_ROLES`). Check the ID was
copied from the server icon, not from a channel.

**"Unable to load organization info from Microsoft Graph API."** The signing-in
account has no Entra tenant — it's a personal Microsoft account, not a work or
school one.

**Redirect loop after sign-in.** `URL` must exactly match the address you're
browsing to (scheme and host, no trailing slash), and `FORCE_HTTPS` should stay
`false` because Caddy already handles the redirect.

## Local modifications

This tree is not vanilla Outline. Rebuilding after `git pull` picks these up
automatically, but they're worth knowing about when resolving merge conflicts:

- `plugins/tasks/` — new plugin, Obsidian-style task queries. Self-contained;
  see `plugins/tasks/README.md`.
- `shared/editor/extensions/TasksQuery.ts` — new file, renders task query
  results under a ```` ```tasks ```` block.
- `shared/editor/nodes/index.ts`, `shared/editor/lib/code.ts` — a few lines each
  to register the above. The plugin API can't register editor extensions, so
  these two are unavoidable.
- `.dockerignore` — added `**/.env` so `deploy/.env` stays out of the build
  context.

Check the core diff after pulling upstream:

```bash
git diff upstream/main -- shared/editor .dockerignore
```

## Note on the root `docker-compose.yml`

The file at the repo root is upstream's *development* stack — Postgres and
Redis only, for running `yarn dev` on the host. It's untouched. This directory
is self-contained; always run compose commands from inside `deploy/`.
