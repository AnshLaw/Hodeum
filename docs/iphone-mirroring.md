# Mirroring your iPhone into Hodey

Hodey can show your iPhone's screen in the enlarged notch and teach you on it. The first iPhone Hode is "Turn on Dark Mode".

There are three ways to get the screen onto the laptop. Hodeum only reads what arrives. Frames stay in memory on this PC, text is read by Windows' built-in OCR, and nothing is uploaded or saved.

## Why a USB-C cable alone isn't enough

A laptop's USB-C port can send video **out** to a monitor, but it can't take video **in**. Plugging the iPhone straight into the laptop therefore gives charging and data, not the screen. You need one of the options below.

## Option 1 — Wired, free: iPhoneMirror

[iPhoneMirror](https://github.com/RayrenSX/iPhoneMirror) reads the iPhone's screen over the normal USB cable and shows it to Windows as a camera.

1. Install **Apple Devices** (or iTunes) from the Microsoft Store, so Windows has Apple's USB driver.
2. Install iPhoneMirror and follow its driver step (a `libusb` filter). **Do not** use Zadig or WinUSB on the Apple device; that replaces Apple's driver.
3. Plug in the iPhone, unlock it, tap **Trust**, and start iPhoneMirror.
4. In Hodey, open the ⋯ menu → **Show iPhone** → **Cable / camera**, then pick the iPhoneMirror camera if there is more than one.

Caveats: iPhoneMirror is preview software built on a private Apple protocol, so an iOS update can break it. Its demo mode shows a fake status bar.

## Option 2 — Wired, most reliable: a capture card

1. Get a USB-C → HDMI adapter and an HDMI → USB capture card (MS2130-based cards cost about $20).
2. Connect them: iPhone → adapter → HDMI → capture card → laptop.
3. In Hodey: ⋯ → **Show iPhone** → **Cable / camera**, and pick the card (often called "USB Video").

Hodey crops the phone out of the card's 16:9 picture automatically. Streaming apps such as Netflix or Apple TV+ show black over HDMI (HDCP); Settings and normal apps work.

## Option 3 — Wireless: AirPlay with UxPlay

[UxPlay](https://github.com/FDH2/UxPlay) is an open-source AirPlay receiver (GPL). Hodeum never ships it; it only runs a copy you installed, and only from Hodeum's own `runtime\uxplay` folder.

1. Install [MSYS2](https://www.msys2.org/). In its **UCRT64** shell run:
   ```sh
   pacman -S mingw-w64-ucrt-x86_64-uxplay
   ```
   If that package isn't available, build UxPlay with the Windows instructions in its README, including the GStreamer plugins (base, good, bad, libav).
2. Point Hodeum at it. From the Hodeum folder in PowerShell:
   ```powershell
   cmd /c mklink /J runtime\uxplay C:\msys64\ucrt64\bin
   ```
   Hodeum only runs a receiver you put in its own `runtime\uxplay` folder; it never searches other folders on its own.
   The link above makes that folder the MSYS2 folder, so you are trusting `C:\msys64` itself. By default, other accounts on the PC can write there.
   On a PC only you use, that's fine. On a shared PC, either restrict `C:\msys64` to administrators, or copy `uxplay.exe` with its DLLs and GStreamer plugins into a folder only you can write to, and link that instead.
3. Windows Firewall: allow `uxplay.exe` on **Private** networks when Windows asks. If you set rules by hand, open:
   - TCP 7000, 7001, 7100
   - UDP 6000, 6001, 7011, 5353
4. Make sure your Wi-Fi network profile is **Private**.
5. In Hodey: ⋯ → **Show iPhone** → **AirPlay**. On the iPhone: **Control Center → Screen Mirroring → Hodeum**.

**If the iPhone doesn't see "Hodeum"** (venue Wi-Fi often blocks it): turn on **Settings → Network & internet → Mobile hotspot** on the laptop and join that network from the iPhone.

If AirPlay stops, the notch shows the reason. The full log is `runtime\uxplay.log`.

## Rehearse without a phone

Run `npm run dev` and open the **iPhone** tab on the practice stage. Then start a Hode with "turn on dark mode on my iphone".

## Troubleshooting

| What you see | What to do |
|---|---|
| "No camera found" | Start iPhoneMirror or plug in the capture card, then press **Try again**. |
| "… stopped. Is it still plugged in?" | Reconnect the cable, then press **Try again**. |
| "AirPlay receiver not installed" | Do Option 3, steps 1–2. |
| Stuck on "On your iPhone: Control Center → Screen Mirroring → Hodeum." | Check the firewall and Private network, or use the laptop hotspot. |
| Hodey says "Connect your iPhone…" | The mirror isn't live. Open **Show iPhone** and start a source. |
| Hodey says it can't spot something | Scroll a little. Hodey looks again after each change on screen. |
