using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Security.Cryptography;

namespace Istiqamah
{
    using Dict = Dictionary<string, object>;

    /// Keeps Istiqamah up to date by itself, from the same feed the Mac app uses ("windows" section).
    /// Downloads the zip from the GitHub release, checks its SHA-256, waits until nothing is on screen,
    /// then lets the new version copy itself over this one and start.
    sealed class Updater
    {
        const string Feed = "https://zaytage.github.io/daimun/update.json";
        readonly TrayApp app;
        bool checking;
        string readyDir;
        Dict readyInfo;

        public Updater(TrayApp app) { this.app = app; }

        public static string Version =>
            Assembly.GetExecutingAssembly().GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion?.Split('+')[0] ?? "?";
        public static int Build => Assembly.GetExecutingAssembly().GetName().Version.Revision;

        public async void Check(bool userInitiated)
        {
            if (readyDir != null) { InstallWhenQuiet(); return; }
            if (checking) return;
            checking = true;
            try
            {
                ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
                using (var http = new HttpClient { Timeout = TimeSpan.FromMinutes(3) })
                {
                    http.DefaultRequestHeaders.UserAgent.ParseAdd("Daimun/" + Version);
                    var feed = Json.Obj(await http.GetStringAsync(Feed + "?t=" + DateTime.UtcNow.Ticks));
                    var win = feed.Child("windows");
                    if (win == null || (int)win.Num("build") <= Build)
                    {
                        if (userInitiated) app.Tell("Da’imun is up to date", "You have the latest version, " + Version + ".");
                        return;
                    }
                    if (userInitiated) app.Tell("Updating to version " + win.Get("version") + "…", "It installs itself once no alarm is showing.");

                    var bytes = await http.GetByteArrayAsync(win.Get("url"));
                    string sha;
                    using (var h = SHA256.Create()) sha = string.Concat(h.ComputeHash(bytes).Select(b => b.ToString("x2")));
                    if (!string.Equals(sha, win.Get("sha256"), StringComparison.OrdinalIgnoreCase))
                        throw new InvalidDataException("The download didn't match its published fingerprint, so it wasn't installed.");

                    var dir = Path.Combine(Path.GetTempPath(), "istiqamah-update-" + (int)win.Num("build"));
                    if (Directory.Exists(dir)) Directory.Delete(dir, true);
                    Directory.CreateDirectory(dir);
                    var zip = Path.Combine(dir, "update.zip");
                    File.WriteAllBytes(zip, bytes);
                    ZipFile.ExtractToDirectory(zip, Path.Combine(dir, "files"));
                    var exe = Directory.GetFiles(Path.Combine(dir, "files"), "Daimun.exe", SearchOption.AllDirectories).FirstOrDefault()
                              ?? throw new InvalidDataException("The download didn't contain the app.");
                    readyDir = Path.GetDirectoryName(exe);
                    readyInfo = win;
                    InstallWhenQuiet();
                }
            }
            catch (Exception ex)
            {
                Trace.WriteLine("Istiqamah update check failed: " + ex.Message);
                if (userInitiated) app.Tell("Couldn't check for updates", ex.Message);
                else app.Later(20 * 60_000, () => Check(false)); // offline or a hiccup: try again in 20 minutes
            }
            finally { checking = false; }
        }

        /// Swap once no alarm is showing and the window is closed; otherwise try again in two minutes.
        public void InstallWhenQuiet()
        {
            if (readyDir == null) return;
            if (app.Busy) { app.Later(120_000, InstallWhenQuiet); return; }
            try
            {
                File.WriteAllText(Path.Combine(Paths.DataDir, "updated.txt"), readyInfo.Get("version") + "\n" + (readyInfo.Get("notes") ?? ""));
                var args = $"--apply-update {Process.GetCurrentProcess().Id} \"{Paths.AppDir}\"";
                Process.Start(new ProcessStartInfo(Path.Combine(readyDir, "Daimun.exe"), args) { UseShellExecute = false, WorkingDirectory = readyDir });
                app.Quit();
            }
            catch (Exception ex) { app.Tell("Couldn't install the update", ex.Message); }
        }

        /// After an update, say so once.
        public void AnnounceIfJustUpdated()
        {
            var f = Path.Combine(Paths.DataDir, "updated.txt");
            if (!Program.Has("--updated") || !File.Exists(f)) return;
            var lines = File.ReadAllText(f).Split(new[] { '\n' }, 2);
            try { File.Delete(f); } catch { }
            app.Later(2500, () => app.Tell("Da’imun updated to version " + lines[0], lines.Length > 1 && lines[1].Trim().Length > 0 ? lines[1].Trim() : null));
        }
    }
}
