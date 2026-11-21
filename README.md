# Da’imun (دائمون)

*“Those who are constant in their prayer”* (Al-Ma’arij 70:23).

The adhan on your laptop, and a daily evaluation chart to tick, like the paper chart people share in Ramadan.

- **Solat alarm:** the adhan (or a chime) plays at each prayer time and a reminder stays up until you tap **I've prayed**. It asks again every 10 minutes (adjustable) until the prayer's time ends.
- **Adhan:** choose from four openly licensed recordings (Makkah, Aaqib Azeez, Casablanca, Kazakhstan) plus a separate Fajr adhan, or use your own recording.
- **Sunnah and dua times, each with its own tone:** Ishraq, Duha at its best time, the last third of the night, and Friday's last hour.
- **Reminders:** morning and evening adhkar, salawat and dhikr nudges through the day, Friday (Al-Kahf), Quran if today's pages aren't done, before-sleep adhkar, and optional sunnah fasts.
- **Location:** Country → State → City for about 170,000 places, because times shift about 4 minutes per degree of longitude.
- **Today:** mark each solat (on time, late, qada, missed or excused), jama'ah, rawatib, witr and tasbih. Count salawat, istighfar and dhikr, log Quran pages, tick adhkar, Duha and Tahajjud, add your own items (sadaqah…), and write a short muhasabah.
- **Chart:** the evaluation chart for a week, a month or a Hijri month (Ramadan), with results per row. Tap boxes to tick. Print it.

Everything is stored on the person's own device. Nothing is uploaded, and there are no accounts.

## Two ways to use it

| | Mac app | Web app |
|---|---|---|
| Who | Anyone with a Mac (macOS 13 or newer) | Anyone, on any laptop or phone |
| Alarm | Full screen over everything (or a floating window or corner notice), even with the window closed | Inside the app plus a system notification. The page or installed app must stay open |
| Starts at login | Yes (menu bar → Open at login) | No |

## Mac app

**Download:** https://github.com/zaytage/daimun/releases/latest/download/Daimun-mac.zip (always the newest version). Step-by-step guide for everyone: https://zaytage.github.io/daimun/install.html

Unzip it and drag **Da’imun** into **Applications**. The app isn't notarized by Apple, so the first time macOS blocks it: open **System Settings → Privacy & Security**, scroll down, click **Open Anyway** next to Da’imun and confirm. After that it opens normally.

**It updates itself.** The app checks https://zaytage.github.io/daimun/update.json at launch and every 6 hours (or now, via 🌙 → *Check for updates…*). A new version is downloaded, checked against its SHA-256 fingerprint, and swapped in once no alarm is showing and the window is closed; the app then reopens with a short "Updated to version …" note.

Choose an adhan in Settings, or your own recording from the 🌙 menu → *Adhan sound*.

## Windows app

**Download:** https://github.com/zaytage/daimun/releases/latest/download/Daimun-windows.zip (Windows 10 or 11).

1. Right-click the zip → **Extract All**, open the folder and double-click **Daimun.exe**.
2. Windows may say "Windows protected your PC" (the app isn't signed with a paid certificate). Click **More info → Run anyway**.
3. Da’imun installs itself for you (no admin password), adds itself to the Start menu, starts with Windows, and opens. You can then delete the downloaded folder.

It lives by the clock in the taskbar (click the ^ arrow if it's hidden; you can drag it next to the clock). It shows the same full-screen adhan, reminders, Today and Progress as the Mac app, and **updates itself** the same way. To remove it: taskbar icon → *Uninstall Da’imun…* (your chart is kept).

Built from `win/` with the .NET SDK (targets .NET Framework 4.8, built into Windows, and Microsoft Edge WebView2).

## Publishing a new version

```bash
tools/release.sh 1.2 "What changed, in one short sentence"
```

This builds the Mac app (Apple silicon + Intel) and the Windows app, updates the website in `docs/`, creates the GitHub release with the zip, and then publishes `update.json` so every installed app updates itself.

## Web app

**Website:** https://zaytage.github.io/daimun/ (works on phones and laptops; install it to the home screen). A copy also lives at https://claude.ai/artifact/DcyhS7QNfUpuS6feYZwd4q.

On that page the adhan and reminders work while the page is open in a tab. Each person's chart stays in their own browser, and **Settings → Save backup** saves a copy. To update it after changing `web/`, run `python3 tools/make_artifact_page.py` and ask Claude to republish `artifact/index.html`.

The `web/` folder is also a complete static site. On an HTTPS host of your own (GitHub Pages, Netlify, Cloudflare Pages) it additionally gets system notifications, offline use and **Install** as an app in Chrome or Edge. Point `SHARE_URL` at the top of `web/app.js` to wherever it lives.

## Credits

- Adhan recordings come from Wikimedia Commons and were trimmed and levelled for the app (`tools/adhan_audio.swift`). They are shared under their original licences: Makkah (Seyfula Islam, CC BY 3.0), Aaqib Azeez (shared by Atcovi, CC BY-SA 4.0), Casablanca (Fraguando, CC BY-SA 4.0), Kazakhstan (Esetok, CC BY-SA 4.0), Fajr at Malmö Mosque (Islamic Center Malmö, CC BY 3.0).
- Places come from GeoNames (geonames.org), CC BY 4.0. Rebuild them with `python3 -I tools/build_places.py <geonames folder> web/places`.
- The tones for reminders and sunnah times are generated by `tools/make_sounds.py`.

## Notes

- Prayer times are calculated on the device (JAKIM, MUIS, Kemenag, MWL, ISNA, Umm al-Qura and more). Compare them with your mosque or official timetable and fine-tune by a minute or two in Settings if needed.
- The Hijri date uses the Umm al-Qura calendar, which can differ by a day from local moon sighting.
- Backups: Settings → Export backup / Import backup.
