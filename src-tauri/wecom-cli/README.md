# Bundled WeCom CLI

Kardii's build step downloads the official `@wecom/cli` v1.1.0 binary for the
target platform, verifies the pinned npm SHA-512 integrity value, and places it
in this directory for Tauri to bundle.

The downloaded binary is not committed. `wecom-cli` is published by WeComTeam
under the MIT license: https://github.com/WecomTeam/wecom-cli. The required
license notice is bundled as `LICENSE.wecom-cli`.
