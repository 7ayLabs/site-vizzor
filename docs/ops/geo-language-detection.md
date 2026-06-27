# Geo-driven auto-language — operator notes

Vizzor's `middleware.ts` runs a first-visit redirect (`geoRedirect()`) that
maps the visitor's country to the right locale (`/es`, `/fr`, default
`en`) before any page renders. This document explains how it's
configured on the VPS and what to do to upgrade from the
`Accept-Language` fallback to true geo-IP routing.

## Today's state (post v0.4.0)

The middleware reads two headers, in order:
- `x-vercel-ip-country` — set automatically on Vercel.
- `cf-ipcountry` — set automatically when fronted by Cloudflare.

Vizzor runs behind self-hosted nginx on a VPS — **neither header is set
by default**. Consequence: `geoRedirect()` silently returns `null`, and
next-intl's own `Accept-Language` parsing handles the redirect instead.
A visitor from Mexico City with an `es-MX` browser still lands on `/es`;
a visitor from the same country with an `en` browser stays on `/`.

This is acceptable for v0.4.0. The accuracy gap is small (most users
have a locale aligned with their region) and the failure mode is
graceful (English default).

## Upgrade path — nginx-geoip2

To get true geo-IP routing (browser language no longer matters), install
the [nginx geoip2 module](https://github.com/leev/ngx_http_geoip2_module)
and a MaxMind GeoLite2 database, then add a `proxy_set_header` to the
Vizzor nginx site config.

### 1. Install the module

Ubuntu 24.04 ships nginx without geoip2; build dynamic module:

```bash
# Install build deps
sudo apt-get install -y libmaxminddb-dev nginx-dev

# Pull the module sources
git clone https://github.com/leev/ngx_http_geoip2_module.git /tmp/geoip2

# Get nginx source matching the installed version
NGINX_VER=$(nginx -v 2>&1 | grep -oE '[0-9.]+')
curl -O https://nginx.org/download/nginx-${NGINX_VER}.tar.gz
tar xf nginx-${NGINX_VER}.tar.gz
cd nginx-${NGINX_VER}

# Configure + build the module only (dynamic)
./configure --with-compat --add-dynamic-module=/tmp/geoip2
make modules
sudo cp objs/ngx_http_geoip2_module.so /etc/nginx/modules/
```

### 2. Install the MaxMind GeoLite2 database

Free signup at https://www.maxmind.com/en/geolite2/signup → download
`GeoLite2-Country.mmdb` → upload to VPS:

```bash
sudo mkdir -p /usr/share/GeoIP
sudo install -m 0644 GeoLite2-Country.mmdb /usr/share/GeoIP/
```

### 3. Wire into nginx

In `/etc/nginx/nginx.conf` (top-level, NOT inside `http {}`):

```nginx
load_module modules/ngx_http_geoip2_module.so;
```

Then in `/etc/nginx/conf.d/geoip.conf` (or inside the `http {}` block):

```nginx
geoip2 /usr/share/GeoIP/GeoLite2-Country.mmdb {
    auto_reload 60m;
    $geoip2_data_country_code country iso_code;
}
```

And in each Vizzor site (`/etc/nginx/sites-enabled/vizzor.ai` etc.) inside
the `location /` block that proxies to the container, add:

```nginx
proxy_set_header CF-IPCountry $geoip2_data_country_code;
```

Reload nginx:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 4. Verify

After reload, any non-default-locale visitor should be redirected on
first visit. From a French IP:

```bash
curl -sI -H "Accept-Language: en" https://vizzor.ai/
# Expected: HTTP/2 307 + location: /fr/
```

Without geo-IP routing (today): the response is `200 OK` (no redirect)
because Accept-Language matches the default locale.

## Privacy / security note

The geo-IP database is consulted locally — no data leaves the VPS. The
`CF-IPCountry` header is the only thing exposed to the Vizzor container,
and only the 2-letter ISO code (`MX`, `FR`, etc.) — never the IP itself.
This matches the same disclosure surface as a Cloudflare-fronted
deployment.

The audit log (`lib/payment/audit.ts`) hashes IP + UA before persistence
— the country code is never written to durable storage. Reading the
country in the middleware is request-scoped and discarded after the
redirect.
