# Mirroring your iPhone into Hodey

Hodey can show your iPhone's screen in the enlarged notch and teach you on it. While the mirror is open, the notch grows to fit the whole phone screen, uncropped, in the shape of the incoming picture: as tall as your screen's work area allows beside Hodey's guidance (top notch), or above it in the sidebar. Closing the mirror shrinks it back. The first iPhone Hode is "Turn on Dark Mode".

There are three ways to get the screen onto the laptop. Hodeum only reads what arrives. Frames stay in memory on this PC, text is read by Windows' built-in OCR, and nothing is uploaded or saved.

**Start with Option 3 (Wi-Fi / AirPlay).** It needs no extra hardware: the iPhone mirrors itself to the laptop the same way it would to an Apple TV.

### "USB cable" is not a webcam

Hodey never points a webcam at your phone. The **USB cable** source reads a *video input*: a program (iPhoneMirror) or a capture card that makes the iPhone's screen look like a camera to Windows. Hodey only picks inputs whose names look like an iPhone mirror or capture card, never the laptop's own webcam. If you have neither, use **Wi-Fi (AirPlay)**.

## Why a USB-C cable alone isn't enough

A laptop's USB-C port can send video **out** to a monitor, but it can't take video **in**. Plugging the iPhone straight into the laptop therefore gives charging and data, not the screen. You need one of the options below.

## Option 1 — Wired, free: iPhoneMirror

[iPhoneMirror](https://github.com/RayrenSX/iPhoneMirror) reads the iPhone's screen over the normal USB cable and shows it to Windows as a camera.

1. Install **Apple Devices** (or iTunes) from the Microsoft Store, so Windows has Apple's USB driver.
2. Install iPhoneMirror and follow its driver step (a `libusb` filter). **Do not** use Zadig or WinUSB on the Apple device; that replaces Apple's driver.
3. Plug in the iPhone, unlock it, tap **Trust**, and start iPhoneMirror.
4. In Hodey, open the ⋯ menu → **Show iPhone** → **USB cable**, then pick the iPhoneMirror input if there is more than one.

Caveats: iPhoneMirror is preview software built on a private Apple protocol, so an iOS update can break it. Its demo mode shows a fake status bar.

## Option 2 — Wired, most reliable: a capture card

1. Get a USB-C → HDMI adapter and an HDMI → USB capture card (MS2130-based cards cost about $20).
2. Connect them: iPhone → adapter → HDMI → capture card → laptop.
3. In Hodey: ⋯ → **Show iPhone** → **USB cable**, and pick the card (often called "USB Video").

Hodey crops the phone out of the card's 16:9 picture automatically. Streaming apps such as Netflix or Apple TV+ show black over HDMI (HDCP); Settings and normal apps work.

## Option 3 — Wireless, no hardware: AirPlay with UxPlay (recommended)

[UxPlay](https://github.com/FDH2/UxPlay) is an open-source AirPlay receiver (GPL). Hodeum never ships it; it only runs a copy you built, and only from Hodeum's own `runtime\uxplay` folder.

1. Build it (no admin needed). From the Hodeum folder in PowerShell:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\setup-airplay.ps1
   ```
   This installs MSYS2 into `%LOCALAPPDATA%\msys64` (only your account can write there), builds a pinned UxPlay with its GStreamer plugins, and links it as `runtime\uxplay`. UxPlay brings its own device discovery, so Bonjour isn't needed. The first run takes several minutes; re-running skips finished steps.
2. Windows Firewall: allow `uxplay.exe` when Windows asks the first time you press **Show iPhone**. If you set a rule by hand, allow the program `%LOCALAPPDATA%\msys64\ucrt64\bin\uxplay.exe` (inbound); it picks its ports at run time, so per-port rules don't work.
   Turn off VPNs such as Cloudflare WARP while mirroring.
3. Make sure the laptop's Wi-Fi profile is **Private** (Settings → Network & internet → Wi-Fi → your network). Guest and venue Wi-Fi usually keep devices from seeing each other; use the hotspot below instead.
4. In Hodey: ⋯ → **Show iPhone** → **Wi-Fi (AirPlay)** (the default). On the iPhone: **Control Center → Screen Mirroring → Hodeum**.

**If the iPhone doesn't see "Hodeum"** (guest Wi-Fi and VPNs such as Cloudflare WARP often block it): turn on **Settings → Network & internet → Mobile hotspot** on the laptop and join that network from the iPhone.

If AirPlay stops, the notch shows the reason. The full log is `runtime\uxplay.log`.

## Rehearse without a phone

Run `npm run dev` and open the **iPhone** tab on the practice stage. Then start a Hode with "turn on dark mode on my iphone". The notch mirrors the practice iPhone (it opens on its own, or from ⋯ → **Show iPhone**), so you can check the enlarged notch and Hodey's highlights on the mirror.

## Troubleshooting

| What you see | What to do |
|---|---|
| "No iPhone video input found" | Start iPhoneMirror or plug in the capture card, then press **Try again**. Or switch to **Wi-Fi (AirPlay)**. |
| "… stopped. Is it still plugged in?" | Reconnect the cable, then press **Try again**. |
| "AirPlay receiver not installed" | Run `scripts\setup-airplay.ps1` (Option 3, step 1). |
| Stuck on "On your iPhone: Control Center → Screen Mirroring → Hodeum." | Check the firewall and Private network, or use the laptop hotspot. |
| Hodey says "Connect your iPhone…" | The mirror isn't live. Open **Show iPhone** and start a source. |
| Hodey says it can't spot something | Scroll a little. Hodey looks again after each change on screen. |
