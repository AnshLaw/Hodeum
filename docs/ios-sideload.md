# Put the Hodeum test app on your iPhone (free Apple ID, no Mac)

This first build is a **test app**. It checks that Hodeum can see your iPhone screen while you're in other apps, read it, show Hodey's ring in a floating window, and talk to you. Everything stays on the phone.

## 1. Get the app file

1. Open https://github.com/AnshLaw/Hodeum/actions/workflows/ios.yml and click the newest green run on `feat/ios-app`.
2. Under **Artifacts**, download **Hodeum-ipas** and unzip it. Inside are two files:
   - `Hodeum-sck.ipa`: try this first. It uses iOS 27's new screen capture.
   - `Hodeum-basic.ipa`: use this only if the first one won't install.

## 2. One-time setup on Windows

1. Install **iTunes** and **iCloud** from Apple's website, **not** the Microsoft Store versions. Sideloadly needs the website versions.
2. Install **Sideloadly** from https://sideloadly.io.

## 3. One-time setup on the iPhone

1. Plug the iPhone into the laptop with your USB-C cable. Unlock it and tap **Trust**.
2. Turn on **Settings → Privacy & Security → Developer Mode**. The iPhone restarts; confirm when it asks.

## 4. Install

1. Open Sideloadly. Your iPhone should appear at the top.
2. Drag `Hodeum-sck.ipa` into Sideloadly.
3. Enter **your** Apple ID. Sideloadly signs the app with your free account; your password goes only to Apple.
4. Click **Start**. If asked about a two-factor code, enter it.
5. On the iPhone, go to **Settings → General → VPN & Device Management**, tap your Apple ID, then tap **Trust**.

If step 4 fails with an entitlement or provisioning error, repeat it with `Hodeum-basic.ipa`.

The free signature lasts **7 days**. After that, plug in and run Sideloadly again; it can refresh automatically if you leave it running.

## 5. Try it (and tell me what happened)

1. Open **Hodeum**. Under **2 · Floating guide**, a small black preview box appears.
2. Tap **Speak test**. You should hear Hodey.
3. Tap **Start screen capture (iOS 27)** and choose your **entire screen** in the iOS sheet.
   - "Frames (all)" should start counting.
   - The preview box shows your screen with "Hodey is watching…".
4. Swipe up to go to the **Home Screen**.
   - A **floating window** should appear. If it doesn't, go back to Hodeum, tap **Start floating window now**, then swipe home again.
   - When the Settings icon is visible, the window should **zoom in on "Settings" with an orange ring**, and Hodey should **say "I can see Settings"**.
5. Open the real **Settings** app. The window keeps following the screen.
6. Go back to Hodeum and check:
   - **Frames in background** (should be more than 0);
   - **"Settings" found** (Yes/No);
   - the text lines it read.
7. **If step 3 shows an error, or no frames:** tap the round **ReplayKit** button, pick **Hodeum Screen**, tap **Start Broadcast**, and go home for a few seconds. "ReplayKit frames" should count up.

Send me a screenshot of the Hodeum screen, especially the **Log** section, plus what you saw in steps 2–5. That tells me which capture method works on your phone, so I can build the Dark Mode lesson on it.
