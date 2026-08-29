# Security Policy

## Secrets

Never commit or publish:

- `.env`
- PostgreSQL passwords
- `AUTH_SECRET`
- Telegram bot tokens
- SMTP/app passwords
- TLS private keys (`privkey.pem`, `*.key`)
- ACME/Let's Encrypt account data
- production database dumps
- user-uploaded files

The repository ships only `.env.example` with placeholders.

## If a secret is exposed

Treat it as compromised even if the Git commit is later deleted. Revoke/rotate the exposed credential and remove it from Git history before making the repository public.

## Reporting vulnerabilities

Do not publish working credentials or private user data in a public issue. Provide a minimal reproduction without secrets.
