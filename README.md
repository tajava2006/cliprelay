# ClipRelay

A tool that automatically syncs your clipboard across your own devices.  
Copy with Ctrl+C / Cmd+C, paste with Ctrl+V / Cmd+V on any other device.

All communication goes through **Nostr relays**, and content is encrypted with **NIP-44** to yourself.  
No server. No account. Your private key stays outside the app.

---

## Installation

### Android

Search for **ClipRelay** on [Zapstore](https://zapstore.dev) and install.

### macOS

1. Download `ClipRelay_x.x.x_aarch64.dmg` (Apple Silicon) or `ClipRelay_x.x.x_x64.dmg` (Intel) from the [releases page](https://github.com/tajava2006/cliprelay/releases)
2. Open the DMG and drag `ClipRelay.app` to `/Applications`
3. Run the following in Terminal to bypass Gatekeeper:

```sh
xattr -cr /Applications/ClipRelay.app
```

4. Launch `/Applications/ClipRelay.app`

### Windows

1. Download `ClipRelay_x.x.x_x64-setup.exe` from the [releases page](https://github.com/tajava2006/cliprelay/releases)
2. Run the installer

### Linux

#### AppImage

1. Download `ClipRelay_x.x.x_amd64.AppImage` from the [releases page](https://github.com/tajava2006/cliprelay/releases)
2. Make it executable and run:

```sh
chmod +x ClipRelay_x.x.x_amd64.AppImage
./ClipRelay_x.x.x_amd64.AppImage
```

#### .deb (Debian / Ubuntu)

1. Download `ClipRelay_x.x.x_amd64.deb` from the [releases page](https://github.com/tajava2006/cliprelay/releases)
2. Install:

```sh
sudo dpkg -i ClipRelay_x.x.x_amd64.deb
```

---

## Uninstallation

### macOS

```sh
rm -rf /Applications/ClipRelay.app
rm -rf ~/Library/Application\ Support/com.hoppe.cliprelay
```

### Windows

Settings → Apps → **ClipRelay** → Uninstall  
To also remove app data:

```
C:\Users\<username>\AppData\Roaming\com.hoppe.cliprelay
```

### Linux (AppImage)

Delete the AppImage file, then remove app data:

```sh
rm -rf ~/.local/share/com.hoppe.cliprelay
```

### Linux (deb)

```sh
sudo apt purge clip-relay
rm -rf ~/.local/share/com.hoppe.cliprelay
```

---

## Data Storage

App settings, clipboard history, relay list, and other data are stored at:

| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/com.hoppe.cliprelay/` |
| Windows | `C:\Users\<username>\AppData\Roaming\com.hoppe.cliprelay\` |
| Linux | `~/.local/share/com.hoppe.cliprelay/` |
| Android | App internal storage (Settings → Apps → ClipRelay → Storage) |

---

## Usage

### Initial Setup

1. On first launch, you'll see the NIP-46 bunker connection screen.
2. **Android**: If [Amber](https://github.com/greenart7c3/Amber) is installed, it connects automatically. Otherwise, scan the QR code with Amber or enter a bunker URL manually.
3. **Desktop**: Scan the QR code with Amber or enter a bunker URL directly.
4. Once connected, the app moves to the background and starts syncing.

> Your Nostr account must have a `kind:10002` relay list published for syncing to begin.

### Syncing

- After setup, **nothing else is needed.** Copy on one device, paste on another.
- Check sync status via the system tray (desktop) or notifications (Android).
- Click the tray icon to open the clipboard history viewer.

### What Gets Synced

Text and images are supported. General file sync is not yet available.  
Images are transferred via the Blossom server registered in your `kind:10063` event.

---

## Encryption

| | |
|---|---|
| Transport encryption | NIP-44 (ChaCha20 + HMAC-SHA256, self-encrypted) |
| Key derivation | `conversation_key = ECDH(your private key, your public key)` |
| Image encryption | Encrypted binary is uploaded to Blossom — the server never sees plaintext |
| Private key | Never stored in the app — delegated to NIP-46 bunker |
| Session key | Stored in OS keychain (macOS Keychain / Android Keystore / Windows DPAPI) |
| Notifications & logs | Never contain clipboard content — fixed placeholder text only |

Third parties including relay operators only see encrypted binary and cannot read the content.
