# Kardii Remote Read-Only Transport

Kardii's canonical runtime state remains on the personal computer. The local read-only viewer binds only to `127.0.0.1:43199`; this folder documents transport options that expose that local service without turning the company PC into a second state source.

## Recommended: Tailscale Serve

Use Tailscale Serve when both the personal Mac and company Windows PC can join the same private tailnet.

On the personal Mac, with Kardii running:

```bash
tailscale serve --bg http://127.0.0.1:43199
```

Tailscale returns a private HTTPS URL under the tailnet's `.ts.net` domain. Do **not** use Tailscale Funnel for this viewer.

Then:

1. In personal Kardii, choose **设置 HTTPS 入口** and save the Tailscale HTTPS root URL.
2. Choose **复制本机配对链接**. The access token stays in the URL fragment and is not stored in the company PC until the user explicitly connects.
3. On company Windows Kardii, choose **连接** and paste that pairing link.
4. The company PC stores only the viewer URL/token in its OS credential store. It does not store Binance API credentials and cannot submit orders, transfers, or withdrawals.

Tailscale ACLs remain an additional network-level boundary. The Kardii viewer still requires its own Bearer token for `/status`.

## Alternative: Cloudflare Tunnel

A named Cloudflare Tunnel can publish `http://127.0.0.1:43199` behind a stable HTTPS hostname. Quick Tunnels are suitable only for temporary testing because their hostname changes.

Whichever transport is used:

- keep Kardii's local listener on `127.0.0.1`;
- expose only the read-only viewer;
- do not proxy Binance private/account APIs;
- do not reuse the Market Data Gateway token as the viewer token;
- do not enable remote control or trade execution.
