# HTTPS on a public IPv4 address

This helper path is intended for a public IPv4 installation where TCP 80 and 443 can be forwarded to the Xdesk host.

## Configure `.env`

Example only:

```env
PUBLIC_HOST=203.0.113.10
TLS_CERT_NAME=203.0.113.10
APP_URL=https://203.0.113.10
COOKIE_SECURE=true
```

Replace the example IP with your own public IPv4 address.

## Network forwarding

Forward on your router/firewall:

- public TCP 80 → Xdesk host TCP 80
- public TCP 443 → Xdesk host TCP 443

The application itself still listens on Docker-internal port 3000. Nginx receives 80/443 and proxies requests to `app:3000`.

Do not create an unrestricted destination-NAT rule that accidentally captures all TCP 443 traffic in other directions. Scope forwarding rules to the correct WAN interface/address as appropriate for your router.

## Windows Firewall example

Run as Administrator:

```cmd
netsh advfirewall firewall add rule name="Xdesk HTTP 80" dir=in action=allow protocol=TCP localport=80
netsh advfirewall firewall add rule name="Xdesk HTTPS 443" dir=in action=allow protocol=TCP localport=443
```

## Start the application

```cmd
docker compose up -d --build
docker compose ps
```

Before a certificate exists, Nginx runs in HTTP bootstrap mode so the ACME challenge can be reached.

## Test staging certificate

```cmd
TEST-HTTPS-CERT.cmd
```

## Request the trusted certificate

```cmd
GET-HTTPS-CERT.cmd
```

The helper reads `PUBLIC_HOST` from `.env` and requests an IP-address certificate. It then restarts the proxy.

## Renewal

Manual renewal test:

```cmd
RENEW-HTTPS-CERT.cmd
```

Create a daily Windows Scheduled Task:

```cmd
CREATE-HTTPS-RENEW-TASK.cmd
```

The renewal script reloads/restarts the proxy after successful renewal.

## Domain deployments

The bundled certificate helper is intentionally optimized for public IPv4 certificates. If you use a DNS hostname instead, obtain a certificate using the appropriate Certbot domain (`-d`) flow and set `TLS_CERT_NAME` to the resulting certificate name.
