#!/bin/sh
set -eu

PUBLIC_HOST="${PUBLIC_HOST:-localhost}"
CERT_NAME="${TLS_CERT_NAME:-$PUBLIC_HOST}"
CERT_DIR="/etc/letsencrypt/live/$CERT_NAME"

if [ -s "$CERT_DIR/fullchain.pem" ] && [ -s "$CERT_DIR/privkey.pem" ]; then
  echo "[Xdesk proxy] TLS certificate found for $CERT_NAME; starting HTTPS."
  sed "s|__CERT_NAME__|$CERT_NAME|g" /opt/xdesk-nginx/https.conf > /etc/nginx/conf.d/default.conf
else
  echo "[Xdesk proxy] TLS certificate not found for $CERT_NAME; starting HTTP bootstrap mode."
  cp /opt/xdesk-nginx/bootstrap.conf /etc/nginx/conf.d/default.conf
fi

exec nginx -g 'daemon off;'
