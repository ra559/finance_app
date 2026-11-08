# Cove

**A private, self-hosted personal finance dashboard.** Connect your banks, import statements, categorize every transaction, budget by category, and ask questions about your money — all from a server you control.

Cove runs as a single Node.js service with a SQLite database. There is no Cove cloud account, no telemetry, and no third-party data store. Bank tokens and API keys are encrypted at rest with a key that never leaves your machine.

```
┌──────────────────────────────────────────────────────────────┐
│  Browser (React)                                             │
│    Overview · Transactions · Budgets · Accounts · Investments│
│    Recurring · Import · Assistant · Settings                 │
└───────────────┬──────────────────────────────────────────────┘
                │  session cookie (HttpOnly, SameSite)
┌───────────────▼──────────────────────────────────────────────┐
│  Node.js + Express                                           │
│    REST API · AI chat (SSE) · MCP endpoint (/api/mcp)        │
└───────┬───────────────────────────────┬──────────────────────┘
        │                               │
┌───────▼────────┐              ┌───────▼──────────────────────┐
│ SQLite (WAL)   │              │ Plaid · your AI provider     │
│ data/cove.db   │              │ (optional, user-configured)  │
└────────────────┘              └──────────────────────────────┘
```

---

## Features

- **Bank sync via Plaid** — link checking, savings, credit, loan and investment accounts; balances, transactions and holdings sync on a schedule and on demand.
- **CSV, OFX and QFX import** — a guided column mapper, debit/credit support, duplicate detection, and automatic categorization for any bank, with no third-party service.
- **Automatic categorization** — Plaid's category data, ~200 built-in merchant rules, learned merchant mappings, and your own contains/exact/regex rules.
- **Budgets by category** — monthly limits with progress, over-budget warnings and unbudgeted-spend visibility.
- **Reports that answer questions** — spending by category/merchant/month, income, 12-month cash flow, net worth history, investment allocation and unrealized gains.
- **Recurring bill detection** — finds subscriptions and regular bills from payment cadence and amount stability, with next-due estimates and dismiss controls.
- **Built-in AI assistant** — streaming chat that answers with real numbers through read-only tool calls. Works with OpenAI, OpenRouter, LM Studio or a fully local Ollama.
- **MCP endpoint** — connect Claude Desktop, Claude Code, Cursor or any MCP client to ask things like *"how much did I spend on dining last month?"* and *"what's my budget progress?"*.
- **Self-hosted by default** — single-owner login, encrypted secrets, security headers, CSRF protection and login rate limiting.
- **One-command deploy** — Docker Compose, Podman, or a systemd service on Debian.

---

## Requirements

| Component | Version |
| --- | --- |
| Node.js | 22 LTS (20.11+ works) |
| SQLite | bundled via `better-sqlite3`, no server needed |
| RAM | 256 MB is plenty; 1 GB comfortable |
| Disk | ~1 MB per 10,000 transactions |
| Docker | 24+ with Compose v2 (optional) |

---

## Run locally (without Docker)

This runs Cove directly on your own machine. It is the quickest way to try it or develop the UI.

### 1. Install Node

Cove needs Node.js 22 LTS (20.11 or newer also works). Check your version:

```bash
node -v
npm -v
```

If you normally use nvm, make sure the active version is 22. For a machine-wide service, install Node system-wide so `/usr/bin/node` exists; see the Debian systemd section.

### 2. Install and configure

From the project directory:

```bash
cd project_code
npm ci
cp .env.example .env
```

Edit `.env` for a local-only instance:

```dotenv
APP_URL=http://localhost:3000
HOST=127.0.0.1
PORT=3000
DATA_DIR=./data
TRUST_PROXY=0
```

Leave `PLAID_*` and `AI_*` blank if you want to run without bank sync or the assistant. Cove creates `data/` and its SQLite database on first start.

### 3. Start the app

For a production-like run with the compiled UI:

```bash
npm run build
npm start
```

Open <http://localhost:3000>. The first visit asks you to create the owner account; there is no separate sign-up or password-reset email.

For development with hot reload:

```bash
npm run dev
```

This runs the API on `:3000` and Vite on `:5173`. Open <http://localhost:5173>; Vite proxies `/api` to the API. If you use the assistant or MCP links from the dev server and want the displayed URL to match, set `APP_URL=http://localhost:5173` in `.env`. Stop either command with `Ctrl+C`.

If port 3000 is taken, set `PORT=3001` in `.env` and update `APP_URL`, then start with `API_PORT=3001 npm run dev` so Vite proxies to the new port. For `npm start`, no extra variable is needed.

### 4. Optional demo data

After creating the owner account, go to **Settings → Data & preferences → Load demo data**. This adds four sample accounts and a removable "Cove Demo" institution; remove it from the same section.

Your local data is in `project_code/data/`. Keep `.env` and `data/` out of version control — both are already ignored by `.gitignore`.

---

## Run locally with Docker

This runs the same image used in production on your own machine. Node.js is not required on the host; you need Docker Desktop (macOS/Windows) or Docker Engine with Compose v2 (Linux). Start Docker Desktop or the Docker daemon before continuing.

### 1. Configure

From the project directory:

```bash
cd project_code
cp .env.example .env
```

For a local-only instance, use:

```dotenv
APP_URL=http://localhost:3000
COVE_PORT=3000
TRUST_PROXY=0
```

Compose sets `NODE_ENV`, `PORT`, and `DATA_DIR` for the container; the app binds `0.0.0.0` inside it. A `.env` created for the non-Docker setup still works: Compose reads `APP_URL`, `COVE_PORT`, `TRUST_PROXY`, `TZ`, `APP_SECRET`, and the integration keys from it. Leave `PLAID_*` and `AI_*` blank to start without bank sync or the assistant.

### 2. Build and start

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f cove
```

The first build takes a few minutes because the native SQLite module and the web UI are built. When the container reports healthy, open <http://localhost:3000> and create the owner account.

### 3. Stop, update, and reset

```bash
docker compose down           # stop, keep all data
docker compose up -d --build  # rebuild after code changes
docker compose down -v        # stop AND delete the cove_data volume
```

Your database and encryption key live in the named volume `cove_data`, not in `project_code/data`. See [Backup and restore](#backup-and-restore) for backup commands.

### 4. Ports and host services

If port 3000 is already in use, change both values in `.env` and recreate the container:

```dotenv
COVE_PORT=3001
APP_URL=http://localhost:3001
```

Then run `docker compose up -d` and open <http://localhost:3001>. `COVE_PORT` changes only the host port; the app still listens on 3000 inside the container.

The Compose file maps `host.docker.internal` to the host, so a local Ollama or LM Studio server is reachable from the container at `http://host.docker.internal:11434/v1` or `http://host.docker.internal:1234/v1`. The optional Cloudflare Tunnel profile is for server deployments and is not started by default.

---

## Quick start with Docker

For a laptop or workstation, use [Run locally with Docker](#run-locally-with-docker) above. The steps below target a server install under `/opt`.

```bash
# 1. Get the code onto your server
cd /opt
git clone <your-repo> cove   # or copy the project_code folder
cd cove

# 2. Create your configuration
cp .env.example .env
nano .env                    # set APP_URL, optionally Plaid keys

# 3. Build and start
docker compose up -d --build
docker compose logs -f cove
```

Open **http://localhost:3000** (or your `APP_URL`) and create the owner account. That's the only account — Cove is a personal, single-household app.

Your database lives in the named volume `cove_data`, mounted at `/data`. It survives rebuilds and upgrades.

```bash
docker compose ps            # status + health
docker compose restart cove  # restart
docker compose down          # stop (keeps data)
docker compose down -v       # stop AND DELETE the database — be careful
```

### A minimal `.env`

```dotenv
APP_URL=https://finance.example.com
TRUST_PROXY=1
# APP_SECRET=<64 random hex characters>   # optional but recommended
PLAID_CLIENT_ID=
PLAID_SECRET=
PLAID_ENV=sandbox
SYNC_INTERVAL_HOURS=6
```

Generate a secret with:

```bash
openssl rand -hex 32
```

If `APP_SECRET` is omitted, Cove generates `secret.key` in the data directory on first start. **Back it up with the database** — without it, stored Plaid tokens and the AI key cannot be decrypted (you would need to reconnect banks and re-enter the key).

### Ports and binding

`COVE_PORT` controls the host-side port. On a VPS that only uses Cloudflare Tunnel, bind to loopback so nothing is exposed directly:

```dotenv
COVE_PORT=127.0.0.1:3000
```

Then only the tunnel container can reach the app.

---

## Podman

Cove's image is a normal OCI container and runs rootless.

```bash
podman build -t cove-finance:1.0.0 .

podman volume create cove_data

podman run -d --name cove \
  --restart unless-stopped \
  -p 3000:3000 \
  -v cove_data:/data:Z \
  --env-file .env \
  -e DATA_DIR=/data \
  -e NODE_ENV=production \
  cove-finance:1.0.0

podman logs -f cove
```

The `:Z` suffix relabels the volume for SELinux (Fedora/RHEL hosts). On Debian it is harmless. The `-e DATA_DIR=/data` must come after `--env-file` so it overrides the `.env` value intended for bare-metal installs.

`podman-compose` works for the app as well:

```bash
podman-compose up -d --build
```

Compose **profiles** are not supported by every `podman-compose` release. If `--profile tunnel` fails, run cloudflared as its own container (see below) or install the `cloudflared` binary directly.

---

## Local Debian server (bare metal)

Tested on Debian 12/13. Run these steps as a sudo-capable user.

### 1. Install Node.js 22 and build tools

```bash
sudo apt update
sudo apt install -y curl ca-certificates build-essential python3

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

node -v    # should print v22.x
```

`better-sqlite3` ships prebuilt binaries, so `build-essential` is usually only needed as a fallback.

### 2. Create a service user and data directory

```bash
sudo useradd --system --create-home --home-dir /opt/cove --shell /usr/sbin/nologin cove
sudo mkdir -p /var/lib/cove
sudo chown cove:cove /var/lib/cove
sudo chmod 700 /var/lib/cove
```

### 3. Install the app

From the project directory on your workstation, copy the files (excluding local build output and test data):

```bash
sudo rsync -a --delete \
  --exclude node_modules --exclude data --exclude dist \
  ./cove/ /opt/cove/

sudo chown -R cove:cove /opt/cove
sudo -u cove bash -lc 'cd /opt/cove && npm ci && npm run build && npm prune --omit=dev'
```

### 4. Configure

```bash
sudo -u cove bash -lc 'cd /opt/cove && cp .env.example .env'
sudo -u cove nano /opt/cove/.env
```

Use these values for a bare-metal install:

```dotenv
APP_URL=http://192.168.1.20:3000     # or your tunnel hostname
HOST=0.0.0.0
PORT=3000
DATA_DIR=/var/lib/cove
TRUST_PROXY=0                        # set to 1 behind nginx/Caddy/Cloudflare
PLAID_ENV=sandbox
```

### 5. Install and start the systemd unit

```bash
sudo cp /opt/cove/deploy/cove.service /etc/systemd/system/cove.service
sudo systemctl daemon-reload
sudo systemctl enable --now cove
sudo systemctl status cove
journalctl -u cove -f
```

The unit runs as `cove`, hardens the filesystem with `ProtectSystem=strict`, and only allows writes to `/var/lib/cove`. It expects Node at `/usr/bin/node` — the system-wide binary installed by the NodeSource step above.

> **Do not use an nvm path in `ExecStart`.** Even a correct path such as `/root/.nvm/versions/node/v22.20.0/bin/node` will fail: the service runs as `cove`, cannot traverse `/root`, and `ProtectHome=true` hides home directories. If `command -v node` points into `~/.nvm`, install Node system-wide with the commands in step 1 and use `/usr/bin/node`.

### 6. Reverse proxy (optional)

If you are not using Cloudflare Tunnel, put Caddy or nginx in front for TLS. Caddy example:

```
finance.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Then set `APP_URL=https://finance.example.com` and `TRUST_PROXY=1` in `.env`, and restart Cove.

---

## Debian VPS

The bare-metal steps apply. Add hardening:

```bash
sudo apt install -y ufw unattended-upgrades
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw enable

# SSH: disable password logins once keys work
sudo sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl reload ssh
```

**Recommended topology:** no public app port at all.

1. Install Cove with `HOST=127.0.0.1` (or bind Docker to `127.0.0.1:3000`).
2. Publish it with a Cloudflare Tunnel.
3. Put Cloudflare Access in front (email one-time PIN).
4. Leave Cove's own login enabled as a second layer.

If you do want a public port, use Caddy/nginx with a real certificate and keep `TRUST_PROXY=1`; never expose plain HTTP on the internet.

---

## Cloudflare Tunnel

Cove includes an optional `cloudflared` service in `docker-compose.yml` behind the `tunnel` profile.

### Dashboard-managed tunnel (recommended)

1. Add your domain to Cloudflare (the free plan is fine).
2. In the Cloudflare dashboard go to **Zero Trust → Networks → Tunnels → Create a tunnel**.
3. Choose **Cloudflared**, name it `cove`, and copy the connector token.
4. Add a **Public hostname**:
   - Subdomain: `finance`
   - Domain: `example.com`
   - Service: `http://cove:3000` (Docker service name) or `http://localhost:3000` for a host-installed cloudflared.
5. Put the token in `.env`:

   ```dotenv
   APP_URL=https://finance.example.com
   TRUST_PROXY=1
   CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoi...
   # optional: keep the app off the public interface entirely
   COVE_PORT=127.0.0.1:3000
   ```

6. Start the tunnel profile:

   ```bash
   docker compose --profile tunnel up -d
   docker compose logs -f cloudflared
   ```

   You should see four `Registered tunnel connection` lines. DNS is created automatically.

7. Open `https://finance.example.com`.

### cloudflared installed on the host

```bash
# Debian package repository
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
  | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" \
  | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install -y cloudflared
sudo cloudflared service install <TUNNEL_TOKEN>
```

Use `http://localhost:3000` as the tunnel service when cloudflared is on the host.

> **Never** expose Cove over a tunnel without Access (or at least Cove's own login + HTTPS). A tunnel URL is public by design.

---

## Cloudflare Access: email one-time PIN + 2FA

This gives you a Cloudflare-hosted login gate in front of Cove. The gate asks for your email, sends a one-time PIN, and only lets approved addresses through. Combine it with Cove's own password.

### A. Protect your Cloudflare account itself

1. Cloudflare dashboard → **My Profile → Authentication**.
2. Enable **Two-Factor Authentication** with an authenticator app.
3. Store the recovery codes offline.
4. Require 2FA for all account members (if you ever add any): **Manage Account → Members**.

### B. Enable the One-time PIN login method

1. **Zero Trust → Settings → Authentication → Login methods → Add new**.
2. Choose **One-time PIN** and save.
3. PINs expire after 10 minutes. If your mail gateway filters them, allowlist the sender domain `notify.cloudflare.com`.

New Zero Trust organizations use the Cloudflare identity provider by default; OTP is not always added automatically, which is why this step matters.

### C. Create the Access application

1. **Zero Trust → Access → Applications → Add an application → Self-hosted**.
2. Name: `Cove`.
3. Public hostname: `finance.example.com` (the same hostname as your tunnel route).
4. Session duration: **24 hours** (or 1 week on a trusted device).
5. Identity providers: enable **One-time PIN**.
6. Leave *Instant authentication* off — OTP needs the email step.
7. Save.

### D. Add an allow policy

| Action | Rule type | Selector | Value |
| --- | --- | --- | --- |
| Allow | Include | Emails | `you@example.com` (and any family members) |

Optional hardening — require email OTP as a second factor even if another IdP is added later:

| Action | Rule type | Selector | Value |
| --- | --- | --- | --- |
| Allow | Include | Emails | `you@example.com` |
| Require | Require | Login Methods | `One-time PIN` |

> Do **not** create an Include rule of *Login Methods → One-time PIN* by itself. That lets anyone with any email address request a code. Always pair it with a specific email or email domain.

Test in a private window: visit the hostname, enter your email, receive the PIN, and confirm that a non-allowlisted address never receives one (by design, blocked users get no email).

### E. Let MCP clients through Access

Browser sessions can complete OTP; Claude/Cursor cannot. Create a Cloudflare **service token**:

1. **Zero Trust → Access → Service Auth → Create service token**. Copy the Client ID and Client Secret (shown once).
2. **Access → Applications → Add an application → Self-hosted**:
   - Name: `Cove MCP`
   - Public hostname: `finance.example.com`, path `api/mcp`
   - Policy: Action **Service Auth**, Include **Service Token** → the token you created.
3. In the MCP client configuration add these headers next to the Cove bearer token:

   ```json
   "headers": {
     "CF-Access-Client-Id": "....access",
     "CF-Access-Client-Secret": "...."
   }
   ```

4. Do the same for Plaid webhooks if you want them: create a bypass policy for path `api/plaid/webhook`, or simply rely on Cove's scheduled sync (every 6 hours).

If you would rather not use service tokens, add a **Bypass** policy for `api/mcp`; the endpoint still requires Cove's own high-entropy bearer token. Service Auth is the safer default.

### F. What this buys you

- The origin is never exposed; Cloudflare terminates TLS.
- Unapproved visitors cannot even reach Cove's login page.
- Email OTP is a second factor independent of your Cove password.
- Cove still requires its own login if Access is ever misconfigured.

---

## First run and login

1. Open your Cove URL.
2. Create the owner account (name, email, password ≥ 10 characters).
3. You land on an empty Overview with three options:
   - **Connect a bank** (needs Plaid keys),
   - **Import a statement** (CSV/OFX/QFX),
   - **Load demo data** (14 months of sample accounts and transactions, removable in Settings → Data & preferences).
4. Set budgets in **Budgets**, review categories in **Settings → Categories**, then connect the assistant in **Settings → AI assistant**.

Sessions last 30 days. There is no password-reset email by design — keep the credentials safe. Changing the password in Settings signs out other sessions.

---

## Bank sync with Plaid

Cove uses [Plaid](https://plaid.com) for bank connections. Plaid handles the bank login; Cove receives a token and transaction data, never your bank password.

### 1. Get credentials

1. Create an account at <https://dashboard.plaid.com>.
2. **Team settings → Keys**: copy the `client_id` and the secret for the environment you want.
3. Start in **Sandbox** (free, simulated banks) to try everything.
4. For real banks, apply for **Production** access in the Plaid dashboard. Production has per-Item pricing and an approval process; approval is outside Cove's control.

### 2. Configure

```dotenv
PLAID_CLIENT_ID=your_client_id
PLAID_SECRET=sandbox_secret_or_production_secret
PLAID_ENV=sandbox          # sandbox | development | production
PLAID_COUNTRY_CODES=US,CA
PLAID_INVESTMENTS=true
SYNC_INTERVAL_HOURS=6
```

Restart Cove after changing env values. `Settings → Connections` shows whether keys were detected.

### 3. Link a bank

1. Go to **Accounts → Connect a bank**.
2. Plaid Link opens. Search for your bank and sign in there.
3. On success, Cove exchanges the public token, imports accounts, then runs an initial `transactions/sync` and `investments/holdings/get` (when enabled).
4. In Sandbox, a **Add sandbox bank** button creates a test Item instantly (`First Platypus Bank`, user `user_transactions_dynamic`) so you can see dynamic data without any credentials.

### 4. Sync behaviour

- A background job runs every `SYNC_INTERVAL_HOURS` (default 6), plus balance snapshots and recurring-bill detection.
- **Sync all** on Accounts, or the per-connection **Sync** button, runs on demand.
- Plaid webhooks are supported at `POST /api/plaid/webhook` for `TRANSACTIONS` updates. The endpoint only looks up an existing Item and triggers a sync; it never accepts new credentials. It must be reachable from the internet, so allow it through Cloudflare Access.
- The sync cursor is stored per Item, so repeated syncs only fetch changes.
- Deleting an account removes its transactions. Disconnecting a bank removes the Item and its accounts (Cove cannot revoke the token at Plaid from here; revoke it in the Plaid dashboard if needed).

### 5. Investments

With `PLAID_INVESTMENTS=true` and an investment account, Cove stores holdings, securities, prices, cost basis and daily portfolio snapshots. Some brokerages require the Investments product to be enabled on your Plaid account.

### 6. Privacy notes

- Access tokens are encrypted with AES-256-GCM using `APP_SECRET` (or `data/secret.key`).
- Plaid sees API requests from your server; it does not receive your Cove password or database.
- If you do not want any third-party connection, use CSV/OFX import only.

---

## CSV, OFX and QFX import

### CSV

1. Export a statement from your bank as CSV.
2. **Import → CSV**, pick the destination account, drop the file.
3. Cove detects the delimiter and guesses the column mapping. Adjust:
   - date, description, amount (or separate debit/credit),
   - optional merchant, category, notes,
   - **amount style**: signed (negative = money out), positive-means-spending, or separate debit/credit columns,
   - **date format** when `03/04/2025` is ambiguous.
4. Preview the first rows, then import. Cove reports imported / duplicates / failed rows.

Limits: 25,000 rows and 20 MB per file. Re-importing the same file is safe: a deterministic dedupe key skips already-imported rows, including identical same-day purchases (occurrence counted within the file).

### OFX / QFX

Both OFX 1.x (SGML, unclosed tags) and OFX 2.x / QFX (XML) are parsed. Cove reads `STMTTRN` blocks, `DTPOSTED`, `TRNAMT`, `FITID`, `NAME` and `MEMO`, respects `TRNTYPE` signs, and uses the FITID for deduplication. Choose **Import → OFX / QFX**, pick the account and file.

### After import

- Rows are categorized by the rule engine as they land.
- Fix categories inline in **Transactions**; Cove learns the merchant for next time.
- Create a rule from a transaction with **Always categorize "…" this way**.
- Use **Recategorize** via the API (`POST /api/transactions/recategorize`) or add a rule with *apply to existing* to re-run rules over uncategorized history.

---

## AI assistant

The assistant answers from your own data with read-only tools. It cannot create, edit or delete anything.

### Configure

**Settings → AI assistant**:

| Provider | Base URL | Model | Key |
| --- | --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `gpt-4.1-mini` | required |
| OpenRouter | `https://openrouter.ai/api/v1` | e.g. `anthropic/claude-sonnet-4` | required |
| Ollama (local) | `http://host.docker.internal:11434/v1` | `llama3.1` | none |
| LM Studio | `http://host.docker.internal:1234/v1` | local model name | none |

Docker Compose adds `host.docker.internal:host-gateway`, so a host-run Ollama is reachable from the container. On bare metal use `http://127.0.0.1:11434/v1`.

Remote providers require an API key; loopback and private-network endpoints (Ollama, LM Studio) do not. Without a key Cove shows the assistant setup screen instead of sending requests that would fail. Use **Test connection** to verify. Environment variables `AI_BASE_URL`, `AI_API_KEY` and `AI_MODEL` override the UI values — useful for keeping the key out of the database. The key stored via the UI is encrypted at rest.

### What gets sent

Your question, plus the results of the tool calls needed to answer it (aggregates, matching transactions, budgets, etc.). With Ollama or LM Studio, nothing leaves the machine. With a cloud provider, that data goes to that provider. The system prompt instructs the model to use tools for every factual claim and never invent balances.

### Tools the assistant uses

`get_financial_overview`, `get_spending`, `list_transactions`, `get_budget_status`, `get_cashflow`, `get_net_worth`, `get_recurring_bills`, `get_investments`, `get_income`, `get_accounts`, `list_categories`.

---

## MCP endpoint

Cove exposes the same tools over the **Model Context Protocol** (Streamable HTTP, JSON-RPC 2.0) at:

```
POST https://finance.example.com/api/mcp
```

It is stateless, supports protocol revisions 2024-11-05 through 2026-07-28, and authenticates with a bearer token.

### 1. Create a token

**Settings → Connections & MCP → Create**. Copy the token immediately; only a hash is stored.

### 2. Claude Desktop / generic MCP clients

```json
{
  "mcpServers": {
    "cove": {
      "type": "http",
      "url": "https://finance.example.com/api/mcp",
      "headers": {
        "Authorization": "Bearer cove_mcp_...",
        "CF-Access-Client-Id": "optional-access-client-id.access",
        "CF-Access-Client-Secret": "optional-access-client-secret"
      }
    }
  }
}
```

Older Claude Desktop builds that only support stdio can use `mcp-remote`:

```json
{
  "mcpServers": {
    "cove": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://finance.example.com/api/mcp",
        "--header",
        "Authorization: Bearer cove_mcp_..."
      ]
    }
  }
}
```

### 3. Claude Code

```bash
claude mcp add --transport http cove https://finance.example.com/api/mcp \
  --header "Authorization: Bearer cove_mcp_..."
```

### 4. Test with curl

```bash
curl -s https://finance.example.com/api/mcp \
  -H "Authorization: Bearer cove_mcp_..." \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

curl -s https://finance.example.com/api/mcp \
  -H "Authorization: Bearer cove_mcp_..." \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
       "params":{"name":"get_spending","arguments":{"start_date":"2026-10-01","end_date":"2026-10-31","category":"Dining & Coffee"}}}'
```

### Notes

- Requests without a valid token return `401`; `GET /api/mcp` returns `405` (POST only).
- Tokens are read-only and can be revoked individually. The Settings page shows the prefix and last-used date.
- Behind Cloudflare Access, use a service token as described in the Access section, or bypass `/api/mcp` and rely on the bearer token.
- The MCP endpoint shares the exact tool implementations used by the chat assistant, so answers stay consistent.

---

## Configuration reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_URL` | `http://localhost:3000` | Public URL; used for Plaid redirect/webhook and secure cookies |
| `HOST` | `0.0.0.0` | Bind address; use `127.0.0.1` with a tunnel |
| `PORT` | `3000` | Listen port |
| `DATA_DIR` | `./data` | SQLite database, secret key, WAL files |
| `TRUST_PROXY` | `1` | Set `1` behind Cloudflare/nginx/Caddy |
| `APP_SECRET` | generated | 32-byte hex key used to encrypt stored secrets |
| `PLAID_CLIENT_ID` | — | Plaid client id |
| `PLAID_SECRET` | — | Plaid secret for the selected environment |
| `PLAID_ENV` | `sandbox` | `sandbox`, `development`, or `production` |
| `PLAID_COUNTRY_CODES` | `US,CA` | Comma-separated Link country codes |
| `PLAID_INVESTMENTS` | `true` | Request and sync investment holdings |
| `SYNC_INTERVAL_HOURS` | `6` | Background sync frequency; `0` disables |
| `AI_BASE_URL` | — | Overrides the UI assistant base URL |
| `AI_API_KEY` | — | Overrides the stored assistant key |
| `AI_MODEL` | — | Overrides the stored model |
| `COVE_PORT` | `3000` | Docker Compose host port/binding |
| `CLOUDFLARE_TUNNEL_TOKEN` | — | Enables the `tunnel` Compose profile |

All variables can live in `.env` (read at startup). Never commit `.env` or the `data/` directory.

---

## Backup and restore

Everything that matters is in the data directory:

```
data/
├── cove.db          # accounts, transactions, budgets, chat, tokens
├── cove.db-wal      # write-ahead log
├── cove.db-shm
└── secret.key       # encryption key (if APP_SECRET is not used)
```

### Docker

```bash
docker compose stop cove
docker run --rm -v cove_data:/data -v "$PWD":/backup alpine \
  tar czf /backup/cove-$(date +%F).tar.gz -C /data .
docker compose start cove
```

Restore:

```bash
docker compose down
docker run --rm -v cove_data:/data -v "$PWD":/backup alpine \
  sh -c 'rm -rf /data/* && tar xzf /backup/cove-YYYY-MM-DD.tar.gz -C /data'
docker compose up -d
```

### Bare metal

```bash
sudo systemctl stop cove
sudo -u cove tar czf /var/backups/cove-$(date +%F).tar.gz -C /var/lib/cove .
sudo systemctl start cove
```

For a consistent hot backup, use SQLite's online backup:

```bash
sqlite3 /var/lib/cove/cove.db ".backup '/var/backups/cove.db'"
```

Use `chmod 600` on backups; they contain your entire financial history and token ciphertext.

---

## Updating

```bash
git pull
docker compose up -d --build     # Docker
# or: sudo -u cove bash -lc 'cd /opt/cove && git pull && npm ci && npm run build && npm prune --omit=dev'
sudo systemctl restart cove
```

Schema changes are applied automatically at startup (`CREATE TABLE IF NOT EXISTS` migrations). Take a backup before major upgrades.

---

## Security model

- **Single owner.** First-run setup creates one account; further sign-ups are impossible.
- **Passwords** use scrypt (N=16384, r=8, p=1) with per-user salting and constant-time comparison.
- **Sessions** are random 256-bit tokens stored hashed in SQLite, sent as `HttpOnly`, `SameSite=Lax`, `Secure`-when-HTTPS cookies. 30-day expiry; password change revokes other sessions.
- **CSRF**: all mutating API calls require a custom `x-cove-client` header or a same-origin `Origin`; cross-site forms cannot set custom headers.
- **Rate limiting** on login (20 attempts / 15 min per IP). With `TRUST_PROXY=1`, the real client IP is used.
- **CSP**: `default-src 'self'`, Plaid-only exceptions, `frame-ancestors 'none'`, no inline scripts. HSTS is sent when `APP_URL` is HTTPS.
- **Secrets** (Plaid access tokens, AI API key) are encrypted with AES-256-GCM. MCP tokens are stored as SHA-256 hashes. Session tokens are hashed.
- **Read-only AI/MCP surface.** Tools only run SELECT queries; there is no mutation path.
- **No telemetry.** No analytics, fonts, CDNs, or external scripts except Plaid Link (only when you click Connect bank).
- **Least privilege** in Docker: non-root user, `no-new-privileges`, healthcheck.

If you expose Cove to the internet, use HTTPS + Cloudflare Access (or a VPN) and keep the app's own login enabled. Do not run it on a shared host with untrusted local users; the data directory contains your full financial history.

---

## Project structure

```
project_code/
├── client/                 # React + Vite frontend
│   ├── index.html
│   └── src/
│       ├── App.jsx         # shell, routing, auth bootstrap
│       ├── api.js          # fetch wrapper (CSRF header, errors)
│       ├── components.jsx  # design-system primitives
│       ├── state.jsx       # router, app data, toasts
│       ├── styles.css      # dark fintech theme
│       └── pages/          # Overview, Transactions, Budgets, Accounts,
│                           # Investments, Recurring, Import, Assistant, Settings
├── server/
│   ├── index.js            # Express app, static dist, jobs, shutdown
│   ├── db.js               # SQLite schema, migrations, seed data
│   ├── auth.js             # scrypt, sessions, CSRF, rate limit
│   ├── analytics.js        # spending, cash flow, net worth, budgets
│   ├── categorize.js       # merchant learning + rule engine
│   ├── recurring.js        # subscription/bill detection
│   ├── plaid.js            # Link, token exchange, sync, holdings
│   ├── importers/          # CSV, OFX/QFX parsers and importer
│   ├── finance-tools.js    # shared read-only tools (AI + MCP)
│   ├── ai.js               # OpenAI-compatible streaming + tool loop
│   ├── mcp.js              # JSON-RPC / MCP Streamable HTTP
│   ├── demo.js             # removable sample dataset
│   └── routes/             # REST endpoints
├── deploy/cove.service     # systemd unit
├── scripts/dev.js          # API + Vite dev runner
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

### Development

See [Run locally (without Docker)](#run-locally-without-docker) for prerequisites and configuration. The short version:

```bash
npm ci
npm run dev      # API on :3000, Vite on :5173
npm run build    # production assets into dist/
npm start        # serve API + dist on :3000
```

The Vite dev server proxies `/api` to `127.0.0.1:3000`. For a production-like check, run `npm run build && npm start`.

---

## API overview

All endpoints are under `/api` and require the session cookie except `/api/health`, `/api/auth/*`, `/api/plaid/webhook` and `/api/mcp` (bearer token).

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness and DB check |
| GET | `/auth/status` | Setup required / signed in |
| POST | `/auth/setup`, `/auth/login`, `/auth/logout` | Authentication |
| GET/POST/PATCH/DELETE | `/accounts` | Accounts and balances |
| GET | `/transactions` | Filter, search, paginate |
| POST/PATCH/DELETE | `/transactions` | Create, recategorize, edit |
| GET/POST/DELETE | `/transactions/rules` | Categorization rules |
| GET/POST/PATCH/DELETE | `/categories` | Category management |
| GET/PUT | `/budgets` | Monthly category budgets |
| GET | `/dashboard?month=` | Everything the Overview needs |
| GET | `/reports/spending`, `/income`, `/cashflow`, `/networth` | Report data |
| GET | `/investments` | Holdings, allocation, snapshots |
| GET/POST/PATCH | `/recurring` | Detected bills, detect, dismiss |
| POST | `/import/csv/preview`, `/import/csv`, `/import/ofx` | Statement import |
| GET | `/plaid/status`, `/plaid/items` | Connection status |
| POST | `/plaid/link-token`, `/plaid/exchange`, `/plaid/sync`, `/plaid/sandbox` | Bank sync |
| GET | `/chat`, DELETE `/chat` | Assistant history |
| POST | `/chat` | Streaming assistant (SSE) |
| GET/PUT | `/settings`, `/settings/ai`, `/settings/preferences` | Configuration |
| POST/DELETE | `/settings/mcp-tokens` | MCP credentials |
| GET | `/export/transactions.csv` | CSV export |
| POST | `/mcp` | MCP Streamable HTTP endpoint |

---

## Troubleshooting

**Login page keeps returning after sign-in (reverse proxy).** Set `APP_URL` to the exact public URL and `TRUST_PROXY=1`. The session cookie is only marked `Secure` on HTTPS; a mismatch between `APP_URL` and the browser URL can drop it.

**`cove.service` fails with `status=203/EXEC` or "Unable to locate executable .../bin/node".** The unit points at a Node binary the `cove` user cannot execute — usually an nvm path under `/root` (and a malformed version at that). Check it with:

```bash
systemctl cat cove | grep ExecStart
command -v node
ls -l /usr/bin/node
```

Set `ExecStart=/usr/bin/node server/index.js` (`sudo systemctl edit --full cove`), install the system-wide Node 22 package from step 1 if `/usr/bin/node` is missing, then reinstall dependencies for that Node version:

```bash
sudo -u cove bash -lc 'cd /opt/cove && rm -rf node_modules && npm ci && npm run build && npm prune --omit=dev'
sudo systemctl daemon-reload
sudo systemctl restart cove
sudo systemctl status cove --no-pager
journalctl -u cove -n 50 --no-pager
```

**`better-sqlite3` fails to install.** Install `python3`, `make`, `g++`, then `npm ci` again. On low-memory ARM VPS add swap. Docker builds include the toolchain.

**Docker healthcheck says unhealthy.** Check `docker compose logs cove`. Confirm the container user can write to `/data` (named volumes are fine; bind mounts need `chown 1000:1000`).

**Plaid Link does not open.** Only when keys are present does the button appear; check `Settings → Connections`. The CSP allows `cdn.plaid.com` and `*.plaid.com`; a third-party proxy or browser extension blocking them will break Link. Sandbox needs `PLAID_ENV=sandbox` and the matching sandbox secret.

**Plaid sync error 400/401.** Secrets are environment-specific: a sandbox secret will not work against a production Item. Re-link after changing environments. Check `last_error` on the Accounts page.

**Cloudflare 502/1033.** The tunnel cannot reach the origin. With Docker use `http://cove:3000`; with a host-installed cloudflared use `http://localhost:3000`. Ensure the app container is healthy and on the same Docker network.

**MCP returns 401.** Create a token in Settings → Connections and send `Authorization: Bearer …`. Behind Access, also send the service-token headers or bypass the path.

**MCP returns 405.** The endpoint is POST-only. Use an MCP client with Streamable HTTP support (or `mcp-remote`).

**Assistant says "not configured".** Set the base URL and model in Settings, then Test connection. For Ollama in Docker use `host.docker.internal`, not `localhost`.

**Recurring list is empty.** Detection needs at least three payments with a stable interval and amount. Run **Detect now** after importing a few months.

**Dates look off.** Set `TZ` (e.g. `TZ=America/Los_Angeles`) for both Docker and bare metal. Transaction dates themselves are stored as plain `YYYY-MM-DD` values from your bank.

---

## License / attribution

Cove is provided as-is for personal use. Plaid, Cloudflare and your AI provider have their own terms and pricing. Review them before connecting real accounts.
