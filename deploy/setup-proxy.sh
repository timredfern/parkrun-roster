#!/usr/bin/env bash
# Set up the nginx reverse proxy + TLS for the roster app.
# RUN THIS INSIDE THE webserver LXC, as root:
#     lxc exec webserver -- bash -s < deploy/setup-proxy.sh
# (or copy it in and run it). It is idempotent and gates every reload on `nginx -t`.
#
# Prerequisites (see deploy/README.md):
#   - roster.eclectronics.org resolves to this server (Cloudflare A record) and port 80/443 are
#     forwarded to the webserver LXC.
#   - the roster container is up on the host (docker compose up -d) listening on 8091.
set -euo pipefail

DOMAIN="${DOMAIN:-roster.eclectronics.org}"
UPSTREAM="${UPSTREAM:-http://10.176.70.1:8091}"
EMAIL="${EMAIL:-tim@eclectronics.org}"
AVAIL="/etc/nginx/sites-available/$DOMAIN"
ENABLED="/etc/nginx/sites-enabled/$DOMAIN"

proxy_block() {
  cat <<EOF
    location / {
        proxy_pass $UPSTREAM;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
EOF
}

echo "1/4 bootstrap HTTP-only config (so certbot can complete the challenge)…"
{ echo "server {"; echo "    listen 80;"; echo "    server_name $DOMAIN;"; proxy_block; echo "}"; } > "$AVAIL"
ln -sf "$AVAIL" "$ENABLED"
nginx -t && systemctl reload nginx

echo "2/4 obtain certificate (certonly — does NOT rewrite our config, so proxy headers survive)…"
certbot certonly --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --keep-until-expiring

echo "3/4 write final config (HTTPS + redirect, headers intact)…"
cat > "$AVAIL" <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl;
    server_name $DOMAIN;

    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

$(proxy_block)
}
EOF

echo "4/4 test + reload…"
nginx -t && systemctl reload nginx
echo "Done → https://$DOMAIN"
