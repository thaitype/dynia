# Dynia TLS Plan

## Goals

* Single front door on the **active node** (Reserved IP → HAProxy :80/:443).
* **TLS terminates at HAProxy** in both modes.
* **Caddy stays HTTP-only** on `:8080` and just reverse-proxies to services (e.g., `dynia-placeholder:80`).
* Per-host flexibility via `tlsMode` in cluster state.

---

## tlsMode 1: `haproxy-origin` (default)

**Use when Cloudflare (or similar proxy) is ON (“orange cloud”).**
Terminate TLS at HAProxy using **Cloudflare Origin Certificates**.

### Flow

Internet → Cloudflare (Full/Strict) → RIP → **HAProxy:443 (Origin cert)** → Caddy:8080 (HTTP) → Services

### Steps

1. **Issue Origin Certificate** in Cloudflare for each host (or wildcard).
   Download `cert.pem` and `key.pem`, concatenate to `origin.pem`:

   ```bash
   sudo mkdir -p /etc/haproxy/certs
   sudo bash -c 'cat cert.pem key.pem > /etc/haproxy/certs/<host>-origin.pem'
   sudo chmod 600 /etc/haproxy/certs/*.pem
   ```

2. **HAProxy bind to RIP + select by SNI**:

   ```haproxy
   global
     daemon
     log stdout local0 info
     maxconn 8192
   defaults
     mode http
     timeout connect 5s
     timeout client 30s
     timeout server 30s
     option http-keep-alive

   frontend fe_http
     bind <RIP>:80
     http-request redirect scheme https code 301

   frontend fe_https
     bind <RIP>:443 ssl crt /etc/haproxy/certs/
     http-response set-header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
     acl host_placeholder hdr(host) -i dynia-placeholder-<cluster>.<domain>
     use_backend be_caddy if host_placeholder
     default_backend be_caddy

   backend be_caddy
     balance roundrobin
     option httpchk GET /healthz
     http-check expect status 200
     http-request set-header X-Forwarded-Proto https
     http-request set-header X-Forwarded-For %[src]
     server caddy_local 127.0.0.1:8080 check
   ```

3. **Caddy (HTTP-only)**:

   ```caddy
   {
     auto_https off
     admin off
   }
   :8080 {
     handle_path /healthz { respond 200 }
     reverse_proxy dynia-placeholder:80
   }
   ```

4. **Firewall/Hardening**

* Allow **only Cloudflare IP ranges → RIP** on 80/443.
* Bind HAProxy explicitly to **`<RIP>`** (not `0.0.0.0`) so only MASTER serves public.
* Keepalived moves RIP; ensure HAProxy reloads gracefully.

---

## tlsMode 2: `haproxy-lets-encrypt` (for DNS-only providers)

**Use when DNS is “gray cloud” (no proxy) or any DNS provider without an edge proxy.**
Terminate TLS at HAProxy using **public Let’s Encrypt** certificates.

### Flow

Internet → DNS (no proxy) → RIP → **HAProxy:443 (LE cert)** → Caddy:8080 (HTTP) → Services

### ACME options

* **HTTP-01**: open port 80; *must* allow `/.well-known/acme-challenge/*`.
* **DNS-01**: use provider API (Cloudflare, Route53, etc.); no need to expose :80.

### HAProxy (HTTP-01 example with webroot on 127.0.0.1:9080)

```haproxy
frontend fe_http
  bind <RIP>:80
  acl acme path_beg /.well-known/acme-challenge/
  use_backend be_acme if acme
  http-request redirect scheme https code 301

backend be_acme
  server webroot 127.0.0.1:9080

frontend fe_https
  bind <RIP>:443 ssl crt /etc/haproxy/certs/   # place LE PEMs here
  http-response set-header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
  default_backend be_caddy
```

* Use `certbot`/`acme.sh` to issue/renew, deploy to `/etc/haproxy/certs/<host>.pem` (fullchain+key), then **graceful reload** HAProxy.

### DNS-01 variant

* No special port-80 handling needed; run ACME client with DNS plugin and deploy to `/etc/haproxy/certs/`.

