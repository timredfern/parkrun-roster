# Deploying to eclectronics.org

Target: `https://roster.eclectronics.org`, a Dockerised Node app on the host (port 8091),
reverse-proxied by nginx in the `webserver` LXC. What's automated vs. manual:

| Step | How | Where |
| --- | --- | --- |
| 1. DNS | **manual** (one-time) | Cloudflare |
| 2. Run the container | `docker compose up -d --build` | host |
| 3. nginx + TLS | `deploy/setup-proxy.sh` | webserver LXC |
| 4. Backup | **manual** (one-time) | host |
| Later: redeploys | `deploy/update.sh` | host |

> ⚠️ These touch your production nginx/certbot. The script gates every reload on `nginx -t`, but
> review it before running — a bad nginx config can take all subdomains down (see your infra notes).

## 1. DNS (manual, one-time)
- Add an `A` record `roster.eclectronics.org` → your public IP in Cloudflare.
- Add `roster.eclectronics.org` to `/home/tim/work/cloudflare-ddns/config.json` so the dynamic-IP
  updater keeps it current.
- Router already forwards 80/443 to the webserver LXC, so nothing to change there.

## 2. Run the container (host)
```bash
git clone git@github.com:timredfern/parkrun-roster.git
cd parkrun-roster
docker compose up -d --build
curl -s localhost:8091 | head          # sanity: Status page HTML
```
DB persists at `/tank/roster/roster.db` (see the volume in `docker-compose.yml`).

## 3. nginx + TLS (webserver LXC)
```bash
lxc exec webserver -- bash -s < deploy/setup-proxy.sh
```
Then browse `https://roster.eclectronics.org`. (`ORIGIN` in `docker-compose.yml` already matches
this URL, so the poll/generate forms will work.)

## 4. Backup (manual, one-time)
`/tank/roster` is **not** in Borg's backup set. Either:
- point the volume at a backed-up dataset (change `docker-compose.yml` to `/tank/www/roster:/data`), or
- add `/tank/roster` to the source list in `borg-backup.sh`.

The DB is the one irreplaceable thing (accumulated history) — don't skip this.

## Redeploys
After pushing new commits: `./deploy/update.sh` on the host (git pull + rebuild).
