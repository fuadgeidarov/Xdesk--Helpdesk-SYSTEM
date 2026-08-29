# Xdesk

Self-hosted helpdesk portal with ticket management, roles, knowledge base, analytics, file attachments, SMTP password recovery, and optional two-way Telegram integration.

Stack: **Next.js 15 + React 19 + Prisma + PostgreSQL 16 + Docker Compose + Nginx**.

> This repository is a public template. It contains **no production passwords, bot tokens, SMTP credentials, TLS private keys, company accounts, or private deployment IP addresses**.

## Features

- USER / AGENT / ADMIN roles
- Ticket queue, priorities, statuses, assignees and pagination
- Ticket chat and file attachments
- Knowledge base
- Analytics and Excel export
- User management
- Password recovery through SMTP
- Telegram ticket creation through a bot
- Two-way Xdesk ↔ Telegram ticket chat
- Telegram ticket status notifications and 1–5 star rating
- Docker Compose deployment
- PostgreSQL persistence
- Optional Nginx reverse proxy and Let's Encrypt IP-certificate helper for Windows deployments

## 1. Requirements

Recommended:

- Docker Desktop / Docker Engine with Docker Compose v2
- 4+ GB RAM (8 GB recommended)
- A writable disk for PostgreSQL and uploads
- Internet access if Telegram, SMTP or Let's Encrypt are enabled

## 2. Configure the project

Copy the template:

### Windows

```cmd
copy .env.example .env
```

### Linux/macOS

```bash
cp .env.example .env
```

Edit `.env`. At minimum change:

```env
POSTGRES_PASSWORD=YOUR_STRONG_DATABASE_PASSWORD
AUTH_SECRET=YOUR_LONG_RANDOM_SECRET_AT_LEAST_32_CHARS
```

For a local HTTP installation:

```env
APP_URL=http://localhost
PUBLIC_HOST=localhost
TLS_CERT_NAME=localhost
COOKIE_SECURE=false
```

For a public IPv4 installation, for example `203.0.113.10`:

```env
APP_URL=https://203.0.113.10
PUBLIC_HOST=203.0.113.10
TLS_CERT_NAME=203.0.113.10
COOKIE_SECURE=true
```

`203.0.113.10` is only a documentation example. Replace it with your own address.

## 3. Start Xdesk

```bash
docker compose up -d --build
```

Check services:

```bash
docker compose ps
```

Typical services:

- `db` — PostgreSQL
- `app` — Xdesk
- `telegram-bot` — optional Telegram long-polling process
- `proxy` — Nginx on ports 80/443

If no TLS certificate exists yet, the proxy intentionally starts in HTTP bootstrap mode.

Logs:

```bash
docker compose logs --tail=200 app
docker compose logs --tail=200 telegram-bot
docker compose logs --tail=200 proxy
```

## 4. Initial administrator/test accounts

No real passwords are included in this repository and demo seeding is disabled by default.

For a temporary test installation, set:

```env
SEED_DEFAULT_USERS=auto
SEED_ADMIN_EMAIL=admin@xdesk.local
SEED_AGENT_EMAIL=agent@xdesk.local
SEED_USER_EMAIL=user@xdesk.local
SEED_ADMIN_PASSWORD=CHOOSE_YOUR_OWN_PASSWORD
SEED_AGENT_PASSWORD=CHOOSE_YOUR_OWN_PASSWORD
SEED_USER_PASSWORD=CHOOSE_YOUR_OWN_PASSWORD
```

Each password must be at least 12 characters. Restart the app after changing the values:

```bash
docker compose up -d
```

For production, create your required users and then set:

```env
SEED_DEFAULT_USERS=false
```

Never publish your real `.env`.

## 5. Configure locations/stores

The public template contains neutral examples:

- Магазин 1
- Магазин 2
- Магазин 3
- Офис
- Склад
- Производство

Before production use, replace them in both:

- `lib/stores.ts`
- `bot/telegram-bot.mjs`

Then rebuild:

```bash
docker compose build --no-cache
docker compose up -d
```

## 6. Telegram integration

Create a bot using the official `@BotFather`, then configure:

```env
TELEGRAM_BOT_ENABLED=true
TELEGRAM_BOT_TOKEN=YOUR_OWN_BOT_TOKEN
BOT_COMPANY_NAME=Your Company
```

Restart:

```bash
docker compose up -d
```

The integration uses **Long Polling**, so a Telegram webhook is not required. See [docs/TELEGRAM.md](docs/TELEGRAM.md).

## 7. SMTP password recovery

SMTP is optional. Example for a generic provider:

```env
SMTP_PROVIDER=custom
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=notifications@example.com
SMTP_PASSWORD=YOUR_APP_OR_SMTP_PASSWORD
SMTP_FROM="Xdesk <notifications@example.com>"
```

Gmail and Mail.ru presets are supported by setting `SMTP_PROVIDER=gmail` or `SMTP_PROVIDER=mailru`. Use provider-specific app passwords where required; do not commit them.

`APP_URL` must be the actual URL users can open, otherwise password-reset links will point to the wrong address.

## 8. HTTPS on a public IPv4 address

This repository includes optional Windows helper scripts for Let's Encrypt IP certificates:

- `TEST-HTTPS-CERT.cmd`
- `GET-HTTPS-CERT.cmd`
- `RENEW-HTTPS-CERT.cmd`
- `CREATE-HTTPS-RENEW-TASK.cmd`

They read the public IP from `PUBLIC_HOST` in `.env`; no deployment IP is hard-coded in the repository.

See [docs/HTTPS-IP.md](docs/HTTPS-IP.md).

## 9. Persistent data

Docker volumes hold:

- PostgreSQL data
- uploaded files
- Let's Encrypt certificates
- Certbot webroot data

Normal update:

```bash
docker compose down
docker compose up -d --build
```

**Do not use `docker compose down -v` on a production installation.** It removes named volumes and can destroy the database and uploaded files.

## 10. Security checklist before public deployment

- Replace every placeholder in `.env`
- Use a strong PostgreSQL password
- Use a long random `AUTH_SECRET`
- Keep `.env` outside Git history
- Keep Telegram and SMTP secrets only in `.env`
- Use HTTPS for internet-facing installations
- Set `COOKIE_SECURE=true` when using HTTPS
- Back up the PostgreSQL volume and uploads
- Restrict router/firewall rules to only required ports
- Never commit TLS private keys or ACME directories

See [SECURITY.md](SECURITY.md).

## Repository hygiene

`.gitignore` and `.dockerignore` exclude secrets, `.env`, TLS keys, uploads, build output and local runtime files. Always run `git status` before every commit and verify that no secret file is staged.

## License

MIT. See [LICENSE](LICENSE).
