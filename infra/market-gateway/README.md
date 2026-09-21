# Kardii Market Data Gateway

This is a stateless, public-market-data-only egress boundary for Kardii.

It exists so the Kardii desktop app does not depend on the desktop browser/VPN route when reading public market data.

## Security boundary

The gateway:

- only accepts `GET`
- only proxies allowlisted Binance public market-data paths
- never accepts Binance API keys or secrets
- rejects `/api/v3/account`, `/sapi/*`, orders, transfers, withdrawals, and trading endpoints
- optionally requires `X-Kardii-Market-Token`
- does not persist account or trading state

The desktop app uses:

- `KARDII_MARKET_GATEWAY_BASE=https://<gateway-host>`
- `KARDII_MARKET_GATEWAY_TOKEN=<shared-token>`

When `KARDII_MARKET_GATEWAY_BASE` is set, Kardii uses the gateway only for public market data and does not fall back to direct Binance public endpoints. This keeps market-data egress stable even if the desktop VPN changes.

Private/read-only Binance account calls intentionally remain on their separate path and are never sent through this gateway.

## Run with Docker

```bash
docker build -t kardii-market-gateway .
docker run --rm -p 8787:8787 \
  -e KARDII_MARKET_GATEWAY_TOKEN='replace-with-a-long-random-token' \
  kardii-market-gateway
```

Health check:

```text
GET /healthz
```

For remote use, place the container behind HTTPS on a host whose outbound region and use are compliant with the upstream service's terms and the user's actual account eligibility. This gateway is for public market data, not for bypassing account-region restrictions.


## Railway deployment

This directory is self-contained for a Railway service.

Use `infra/market-gateway` as the service root directory. Railway will detect the Dockerfile and `railway.json`.

Required service variable:

```text
KARDII_MARKET_GATEWAY_TOKEN=<32-256 character random token>
```

Do not set `KARDII_MARKET_GATEWAY_ALLOW_UNAUTHENTICATED=1` outside isolated development.

After Railway assigns a public HTTPS domain, configure that HTTPS root URL plus the same token in Kardii's **公共行情 Gateway** panel. Kardii verifies an authenticated BTCUSDT public-price request before saving the connection.

The Railway health check uses `GET /healthz`; this endpoint exposes no account data or credentials.


## Optional OKX public provider

The same gateway can expose a second **public-market-only** provider for OKX without adding a second Kardii state source.

Set:

```text
KARDII_OKX_PUBLIC_BASE=https://<official regional OKX API domain>
```

The value must be an HTTPS root URL under `okx.com`. Use the official API domain that applies to the account/region; do not use this setting to bypass regional service restrictions.

When configured, the gateway accepts only these OKX public routes under the `/okx` prefix:

- `/okx/api/v5/market/tickers`
- `/okx/api/v5/market/ticker`
- `/okx/api/v5/market/books`
- `/okx/api/v5/market/candles`
- `/okx/api/v5/public/instruments`

Account, order, transfer and withdrawal endpoints remain blocked. This provider is optional and is not used for private account access.
