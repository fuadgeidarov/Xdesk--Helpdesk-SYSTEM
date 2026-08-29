# Xdesk

Self-hosted helpdesk portal with ticket management, roles, knowledge base, analytics, file attachments, SMTP password recovery, and optional two-way Telegram integration.

Stack: **Next.js 15 + React 19 + Prisma + PostgreSQL 16 + Docker Compose + Nginx**.

> This repository is a public template. It contains \*\*no production passwords, bot tokens, SMTP credentials, TLS private keys, company accounts, or private deployment IP addresses\*\*.

## Features

* USER / AGENT / ADMIN roles
* Ticket queue, priorities, statuses, assignees and pagination
* Ticket chat and file attachments
* Knowledge base
* Analytics and Excel export
* User management
* Password recovery through SMTP
* Telegram ticket creation through a bot
* Two-way Xdesk ↔ Telegram ticket chat
* Telegram ticket status notifications and 1–5 star rating
* Docker Compose deployment
* PostgreSQL persistence
* Optional Nginx reverse proxy and Let's Encrypt IP-certificate helper for Windows deployments

## 1\. Requirements

Recommended:

* Docker Desktop / Docker Engine with Docker Compose v2
* 4+ GB RAM (8 GB recommended)
* A writable disk for PostgreSQL and uploads
* Internet access if Telegram, SMTP or Let's Encrypt are enabled

## 2\. Configure the project

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
POSTGRES\_PASSWORD=YOUR\_STRONG\_DATABASE\_PASSWORD
AUTH\_SECRET=YOUR\_LONG\_RANDOM\_SECRET\_AT\_LEAST\_32\_CHARS
```

For a local HTTP installation:

```env
APP\_URL=http://localhost
PUBLIC\_HOST=localhost
TLS\_CERT\_NAME=localhost
COOKIE\_SECURE=false
```

For a public IPv4 installation, for example `203.0.113.10`:

```env
APP\_URL=https://203.0.113.10
PUBLIC\_HOST=203.0.113.10
TLS\_CERT\_NAME=203.0.113.10
COOKIE\_SECURE=true
```

`203.0.113.10` is only a documentation example. Replace it with your own address.

## 3\. Start Xdesk

```bash
docker compose up -d --build
```

Check services:

```bash
docker compose ps
```

Typical services:

* `db` — PostgreSQL
* `app` — Xdesk
* `telegram-bot` — optional Telegram long-polling process
* `proxy` — Nginx on ports 80/443

If no TLS certificate exists yet, the proxy intentionally starts in HTTP bootstrap mode.

Logs:

```bash
docker compose logs --tail=200 app
docker compose logs --tail=200 telegram-bot
docker compose logs --tail=200 proxy
```

## 4\. Initial administrator/test accounts

No real passwords are included in this repository and demo seeding is disabled by default.

For a temporary test installation, set:

```env
SEED\_DEFAULT\_USERS=auto
SEED\_ADMIN\_EMAIL=admin@xdesk.local
SEED\_AGENT\_EMAIL=agent@xdesk.local
SEED\_USER\_EMAIL=user@xdesk.local
SEED\_ADMIN\_PASSWORD=CHOOSE\_YOUR\_OWN\_PASSWORD
SEED\_AGENT\_PASSWORD=CHOOSE\_YOUR\_OWN\_PASSWORD
SEED\_USER\_PASSWORD=CHOOSE\_YOUR\_OWN\_PASSWORD
```

Each password must be at least 12 characters. Restart the app after changing the values:

```bash
docker compose up -d
```

For production, create your required users and then set:

```env
SEED\_DEFAULT\_USERS=false
```

Never publish your real `.env`.

## 5\. Configure locations/stores

The public template contains neutral examples:

* Магазин 1
* Магазин 2
* Магазин 3
* Офис
* Склад
* Производство

Before production use, replace them in both:

* `lib/stores.ts`
* `bot/telegram-bot.mjs`

Then rebuild:

```bash
docker compose build --no-cache
docker compose up -d
```

## 6\. Telegram integration

Create a bot using the official `@BotFather`, then configure:

```env
TELEGRAM\_BOT\_ENABLED=true
TELEGRAM\_BOT\_TOKEN=YOUR\_OWN\_BOT\_TOKEN
BOT\_COMPANY\_NAME=Your Company
```

Restart:

```bash
docker compose up -d
```

The integration uses **Long Polling**, so a Telegram webhook is not required. See [docs/TELEGRAM.md](docs/TELEGRAM.md).

## 7\. SMTP password recovery

SMTP is optional. Example for a generic provider:

```env
SMTP\_PROVIDER=custom
SMTP\_HOST=smtp.example.com
SMTP\_PORT=465
SMTP\_SECURE=true
SMTP\_USER=notifications@example.com
SMTP\_PASSWORD=YOUR\_APP\_OR\_SMTP\_PASSWORD
SMTP\_FROM="Xdesk <notifications@example.com>"
```

Gmail and Mail.ru presets are supported by setting `SMTP\_PROVIDER=gmail` or `SMTP\_PROVIDER=mailru`. Use provider-specific app passwords where required; do not commit them.

`APP\_URL` must be the actual URL users can open, otherwise password-reset links will point to the wrong address.

## 8\. HTTPS on a public IPv4 address

This repository includes optional Windows helper scripts for Let's Encrypt IP certificates:

* `TEST-HTTPS-CERT.cmd`
* `GET-HTTPS-CERT.cmd`
* `RENEW-HTTPS-CERT.cmd`
* `CREATE-HTTPS-RENEW-TASK.cmd`

They read the public IP from `PUBLIC\_HOST` in `.env`; no deployment IP is hard-coded in the repository.

See [docs/HTTPS-IP.md](docs/HTTPS-IP.md).

## 9\. Persistent data

Docker volumes hold:

* PostgreSQL data
* uploaded files
* Let's Encrypt certificates
* Certbot webroot data

Normal update:

```bash
docker compose down
docker compose up -d --build
```

**Do not use `docker compose down -v` on a production installation.** It removes named volumes and can destroy the database and uploaded files.

## 10\. Security checklist before public deployment

* Replace every placeholder in `.env`
* Use a strong PostgreSQL password
* Use a long random `AUTH\_SECRET`
* Keep `.env` outside Git history
* Keep Telegram and SMTP secrets only in `.env`
* Use HTTPS for internet-facing installations
* Set `COOKIE\_SECURE=true` when using HTTPS
* Back up the PostgreSQL volume and uploads
* Restrict router/firewall rules to only required ports
* Never commit TLS private keys or ACME directories

See [SECURITY.md](SECURITY.md).



\## Screenshots



\### Landing page

!\[Xdesk landing page](docs/images/landing.png)



\### Ticket queue

!\[Xdesk ticket queue](docs/images/ticket-queue.png)



\### User profile

!\[Xdesk profile](docs/images/profile.png)



\### Telegram bot

!\[Xdesk Telegram bot](docs/images/telegram-bot.png)



\## Quick Start



!\[Xdesk Quick Start](docs/images/quick-start.png)





## Repository hygiene

`.gitignore` and `.dockerignore` exclude secrets, `.env`, TLS keys, uploads, build output and local runtime files. Always run `git status` before every commit and verify that no secret file is staged.

## License

MIT. See [LICENSE](LICENSE).

