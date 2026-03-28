# Limitless on VDS

## What this setup runs

- `frontend`: React/Vite site, served by Caddy with HTTPS
- `backend`: Rust API on the internal Docker network, now backed by PostgreSQL for prompt and account snapshots
- `postgres`: shared PostgreSQL database for both Telegram bots
- `telegram-bot`: main Telegram bot and token API
- `support-bot`: support Telegram bot

The public site is served through Caddy on ports `80` and `443`.
The backend and both bots stay internal inside Docker.

## 1. Point the domain to the VDS

For your OVH VDS, point the domain to the server IP:

- `A` record for `limitless.pp.ua` -> `217.60.245.238`
- `A` record for `www.limitless.pp.ua` -> `217.60.245.238`

Wait for DNS to update before expecting HTTPS to work.

## 2. Connect to the server

```bash
ssh root@217.60.245.238
```

## 3. Install Docker on CentOS 9 Stream

```bash
dnf -y update
dnf -y install dnf-plugins-core git
dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
dnf -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl enable --now docker
```

If `firewalld` is enabled:

```bash
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --permanent --add-service=ssh
firewall-cmd --reload
```

## 4. Clone the project

```bash
cd /opt
git clone https://github.com/trotsenko2040-glitch/limitless.git
cd limitless
```

## 5. Create the production env file

```bash
cp .env.vds.example .env.vds
nano .env.vds
```

Fill in at least these values:

```env
SITE_HOST=limitless.pp.ua

POSTGRES_DB=limitless
POSTGRES_USER=limitless
POSTGRES_PASSWORD=change-this-postgres-password

BOT_INTERNAL_API_KEY=put-a-long-random-string-here

ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-admin-password
ADMIN_TERMINAL_PASSWORD=change-this-terminal-password
ADMIN_ACCESS_TOKEN=change-this-admin-access-token

TELEGRAM_BOT_TOKEN=your-main-bot-token
TELEGRAM_ADMIN_IDS=1839845039
PAY_SUPPORT_CONTACT=https://t.me/LimitlessSupport_bot

SUPPORT_BOT_TOKEN=your-support-bot-token
SUPPORT_BOT_OWNER_ID=1839845039
SUPPORT_RETRY_INTERVAL_SECONDS=15
```

The VDS stack now starts PostgreSQL automatically. If you already have old SQLite data inside the Docker volumes, the bots migrate it into PostgreSQL on first start. The Rust backend also uses PostgreSQL when the stack is started through Docker Compose, while keeping the old file store as a fallback/migration source.

## 6. Start the whole project

```bash
docker compose --env-file .env.vds up -d --build
```

## 7. Check that containers are running

```bash
docker compose ps
docker compose logs -f frontend
docker compose logs -f backend
docker compose logs -f telegram-bot
docker compose logs -f support-bot
```

## 8. Open the site

After DNS is updated and Caddy gets the certificate:

- `https://limitless.pp.ua`

## Useful commands

Restart after updates:

```bash
cd /opt/limitless
git pull
docker compose --env-file .env.vds up -d --build
```

Stop everything:

```bash
docker compose down
```

See only one service logs:

```bash
docker compose logs -f backend
docker compose logs -f telegram-bot
```

## Important notes

- If the same Telegram bot token is still running on Render or on your PC, Telegram will return `409 Conflict`.
  Stop the old instance before starting the VDS version.
- Your bot tokens were shown earlier in screenshots and code. Rotate both bot tokens in `@BotFather` before production use.
- The Rust backend primarily stores prompt and account data in PostgreSQL, with `backend_data` kept as fallback and migration storage.
- The Telegram bots now use PostgreSQL for active data.
- The old `telegram_bot_data` and `support_bot_data` volumes are kept mounted only for SQLite fallback and one-time migration.
- PostgreSQL data lives in the `postgres_data` Docker volume.

## First quick smoke test

```bash
curl -I http://127.0.0.1
docker compose exec backend sh -lc "wget -qO- http://127.0.0.1:8080/api/health || true"
docker compose exec telegram-bot sh -lc "wget -qO- http://127.0.0.1:3001/health || true"
docker compose exec support-bot sh -lc "wget -qO- http://127.0.0.1:3002/health || true"
```
