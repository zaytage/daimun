using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.NetworkInformation;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;
using Timer = System.Windows.Forms.Timer;

namespace Istiqamah
{
    using Dict = Dictionary<string, object>;

    static class Json
    {
        public static readonly JavaScriptSerializer S = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 512 };
        public static Dict Obj(string s) { try { return S.DeserializeObject(s) as Dict; } catch { return null; } }
        public static string Str(object o) => S.Serialize(o);
        public static string Get(this Dict d, string k) =>
            d != null && d.TryGetValue(k, out var v) && v != null ? Convert.ToString(v, CultureInfo.InvariantCulture) : null;
        public static double Num(this Dict d, string k)
        {
            if (d == null || !d.TryGetValue(k, out var v) || v == null) return 0;
            try { return Convert.ToDouble(v, CultureInfo.InvariantCulture); } catch { return 0; }
        }
        public static bool Flag(this Dict d, string k) => d != null && d.TryGetValue(k, out var v) && v is bool b && b;
        public static Dict Child(this Dict d, string k) => d != null && d.TryGetValue(k, out var v) ? v as Dict : null;
        public static IEnumerable<Dict> List(this Dict d, string k) =>
            d != null && d.TryGetValue(k, out var v) && v is object[] a ? a.OfType<Dict>() : Enumerable.Empty<Dict>();
    }

    /// Everything kept on disk, in %LOCALAPPDATA%\Istiqamah.
    sealed class Store
    {
        string F(string name) => Path.Combine(Paths.DataDir, name);
        public string DataJson { get; private set; }
        public Store()
        {
            try { var s = File.ReadAllText(F("data.json")); if (Json.Obj(s) != null) DataJson = s; } catch { }
        }
        public void SaveData(string s)
        {
            if (Json.Obj(s) == null) return;
            DataJson = s;
            WriteAtomic("data.json", s);
        }
        public List<Dict> LoadSchedule()
        {
            try { return (Json.S.DeserializeObject(File.ReadAllText(F("schedule.json"))) as object[])?.OfType<Dict>().ToList() ?? new List<Dict>(); }
            catch { return new List<Dict>(); }
        }
        public void SaveSchedule(List<Dict> events) => WriteAtomic("schedule.json", Json.Str(events));
        public Dictionary<string, double> LoadFired()
        {
            var o = new Dictionary<string, double>();
            try { foreach (var kv in Json.Obj(File.ReadAllText(F("fired.json"))) ?? new Dict()) o[kv.Key] = Convert.ToDouble(kv.Value, CultureInfo.InvariantCulture); } catch { }
            return o;
        }
        public void SaveFired(Dictionary<string, double> f) => WriteAtomic("fired.json", Json.Str(f));
        void WriteAtomic(string name, string text)
        {
            try { var tmp = F(name + ".tmp"); File.WriteAllText(tmp, text); if (File.Exists(F(name))) File.Delete(F(name)); File.Move(tmp, F(name)); } catch { }
        }
    }

    /// The tracker window. Closing it only hides it; Istiqamah keeps running by the clock.
    sealed class MainWindow : Form
    {
        readonly TrayApp app;
        public readonly WebView2 Web = new WebView2 { Dock = DockStyle.Fill };
        string dataScriptId;
        bool shownOnce;

        public MainWindow(TrayApp app)
        {
            this.app = app;
            Text = "Istiqamah";
            Icon = TrayApp.AppIcon;
            ClientSize = new Size(1060, 800);
            MinimumSize = new Size(420, 560);
            Controls.Add(Web);
            FormClosing += (s, e) =>
            {
                if (e.CloseReason != CloseReason.UserClosing) return;
                e.Cancel = true;
                Hide();
                app.OnMainHidden();
            };
        }

        public async Task Init(CoreWebView2Environment env)
        {
            // WebView2 needs a real window to start in: open it invisibly off-screen, then hide it.
            StartPosition = FormStartPosition.Manual;
            Location = new Point(-32000, -32000);
            Opacity = 0;
            ShowInTaskbar = false;
            Show();
            await Web.EnsureCoreWebView2Async(env);
            Hide();
            Opacity = 1;
            ShowInTaskbar = true;

            var core = Web.CoreWebView2;
            TrayApp.Map(core);
            core.Settings.IsStatusBarEnabled = false;
            core.WebMessageReceived += (s, e) => app.OnMessage(e.TryGetWebMessageAsString());
            core.NewWindowRequested += (s, e) => { e.Handled = true; TrayApp.OpenUrl(e.Uri); };
            core.ProcessFailed += (s, e) => { app.PageReady = false; core.Reload(); };
            await RefreshDataScript();
            core.Navigate("https://app.istiqamah/index.html");
        }

        /// The page reads its saved data from this script, so it survives restarts even if WebView2 storage is cleared.
        public async Task RefreshDataScript()
        {
            var core = Web.CoreWebView2;
            if (core == null) return;
            if (dataScriptId != null) core.RemoveScriptToExecuteOnDocumentCreated(dataScriptId);
            dataScriptId = await core.AddScriptToExecuteOnDocumentCreatedAsync("window.__ISTIQAMAH_DATA__ = " + (app.Store.DataJson ?? "null") + ";");
        }

        public void ShowNow()
        {
            if (!shownOnce)
            {
                shownOnce = true;
                var wa = Screen.FromPoint(Cursor.Position).WorkingArea;
                Size = new Size(Math.Min(1100, wa.Width - 40), Math.Min(860, wa.Height - 40));
                Location = new Point(wa.Left + (wa.Width - Width) / 2, wa.Top + (wa.Height - Height) / 2);
            }
            Show();
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            Activate();
            BringToFront();
        }
    }

    /// The taskbar (tray) icon that runs everything: schedule, alarms, reminders and updates.
    sealed class TrayApp : ApplicationContext
    {
        public static readonly Icon AppIcon = LoadIcon();
        static Icon LoadIcon() { try { return Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { return SystemIcons.Application; } }

        public readonly Store Store = new Store();
        public CoreWebView2Environment Env { get; private set; }
        public bool PageReady;
        public string Style = "fullscreen", AlarmSound = "adhan";
        public bool ReminderSound = true;

        readonly NotifyIcon tray;
        readonly ContextMenuStrip menu = new ContextMenuStrip();
        readonly Alerts alerts;
        readonly Updater updater;
        readonly SynchronizationContext ui;
        readonly List<string> pendingJs = new List<string>();
        readonly List<Timer> timers = new List<Timer>();
        MainWindow main;
        List<Dict> events;
        Dict today;
        Dictionary<string, double> fired;

        static double NowMs => (DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;

        public TrayApp()
        {
            ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
            fired = Store.LoadFired();
            events = Store.LoadSchedule();
            alerts = new Alerts(this);
            updater = new Updater(this);
            menu.Opening += (s, e) => BuildMenu();
            tray = new NotifyIcon { Icon = AppIcon, Text = "Istiqamah", ContextMenuStrip = menu, Visible = true };
            tray.MouseClick += (s, e) => { if (e.Button == MouseButtons.Left) ShowMain(); };

            Every(10_000, Tick);
            Every(300_000, () => RunJs("window.Istiqamah && window.Istiqamah.pushSchedule()"));
            Every(3 * 3600_000, () => updater.Check(false));
            SystemEvents.PowerModeChanged += (s, e) =>
            {
                if (e.Mode != PowerModes.Resume) return;
                Ui(() =>
                {
                    RunJs("window.Istiqamah && window.Istiqamah.pushSchedule()");
                    Later(3000, Tick);
                    Later(30_000, () => updater.Check(false));
                });
            };
            NetworkChange.NetworkAvailabilityChanged += (s, e) => { if (e.IsAvailable) Ui(() => Later(15_000, () => updater.Check(false))); };
            Listen("Show", ShowMain);
            Listen("Quit", Quit);
            _ = Start();
        }

        async Task Start()
        {
            try
            {
                var opts = new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required");
                Env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Paths.DataDir, "WebView2"), opts);
            }
            catch
            {
                var r = MessageBox.Show("Istiqamah needs Microsoft Edge WebView2, which comes with Windows 10 and 11.\n\nOpen Microsoft's download page now?",
                    "Istiqamah", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
                if (r == DialogResult.Yes) OpenUrl("https://developer.microsoft.com/microsoft-edge/webview2/");
                Quit();
                return;
            }
            main = new MainWindow(this);
            await main.Init(Env);
            UpdateTrayText();
            if (Store.DataJson == null || Program.Has("--welcome")) ShowMain();
            if (Program.Has("--test-alarm")) RunJs("window.Istiqamah && window.Istiqamah.testAlarm()");
            updater.AnnounceIfJustUpdated();
            Later(45_000, () => updater.Check(false));
        }

        // ------------------------------------------------------------ helpers

        public static void Map(CoreWebView2 core) =>
            core.SetVirtualHostNameToFolderMapping("app.istiqamah", Paths.WebDir, CoreWebView2HostResourceAccessKind.Allow);

        public static void OpenUrl(string url)
        {
            if (string.IsNullOrEmpty(url)) return;
            if (!(url.StartsWith("https://") || url.StartsWith("http://") || url.StartsWith("mailto:"))) return;
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
        }

        public void Ui(Action a) => ui.Post(_ => a(), null);

        public void Later(int ms, Action a)
        {
            var t = new Timer { Interval = Math.Max(1, ms) };
            t.Tick += (s, e) => { t.Stop(); t.Dispose(); a(); };
            t.Start();
        }

        void Every(int ms, Action a)
        {
            var t = new Timer { Interval = ms };
            t.Tick += (s, e) => a();
            t.Start();
            timers.Add(t);
        }

        void Listen(string name, Action a)
        {
            var handle = Signals.Get(name);
            new Thread(() => { while (true) { handle.WaitOne(); Ui(a); } }) { IsBackground = true }.Start();
        }

        public void RunJs(string js)
        {
            if (PageReady && main?.Web.CoreWebView2 != null) _ = main.Web.CoreWebView2.ExecuteScriptAsync(js);
            else pendingJs.Add(js);
        }

        public bool Busy => alerts.OverlayVisible || (main != null && main.Visible);

        public void ShowMain() { if (main != null) main.ShowNow(); }

        public void OnMainHidden() => Later(1000, updater.InstallWhenQuiet);

        public void Quit()
        {
            foreach (var t in timers) t.Stop();
            alerts.CloseAll();
            tray.Visible = false;
            tray.Dispose();
            ExitThread();
        }

        /// A short corner message (update notes, check results).
        public void Tell(string title, string body)
        {
            var now = NowMs;
            alerts.ShowToast(new Dict
            {
                ["id"] = "info-" + now, ["at"] = now, ["until"] = now + 600_000, ["kind"] = "info", ["title"] = title, ["body"] = body,
                ["autoClose"] = 25, ["actions"] = new object[] { new Dict { ["id"] = "dismiss", ["label"] = "OK" } },
            }, false, false);
        }

        // ------------------------------------------------------------ messages from the page

        public void OnMessage(string s)
        {
            var m = Json.Obj(s);
            if (m == null) return;
            switch (m.Get("type"))
            {
                case "ready":
                    PageReady = true;
                    foreach (var js in pendingJs) _ = main.Web.CoreWebView2.ExecuteScriptAsync(js);
                    pendingJs.Clear();
                    SendNativeInfo();
                    break;
                case "schedule":
                    if (m.ContainsKey("events"))
                    {
                        events = m.List("events").Where(e => e.Num("at") > 0 && e.Num("until") > 0).ToList();
                        Store.SaveSchedule(events);
                    }
                    Style = m.Get("style") ?? Style;
                    AlarmSound = m.Get("alarmSound") ?? AlarmSound;
                    if (m.ContainsKey("reminderSound")) ReminderSound = m.Flag("reminderSound");
                    if (m.Child("today") != null) today = m.Child("today");
                    alerts.CloseOverlayIfGone(events);
                    Tick();
                    break;
                case "save":
                    var data = m.Get("data");
                    if (data != null) { Store.SaveData(data); _ = main.RefreshDataScript(); }
                    break;
                case "fire":
                    if (m.Child("event") is Dict fe) Present(fe, false);
                    break;
                case "show":
                    if (m.Child("event") is Dict se) alerts.ShowToast(se, false, false);
                    break;
                case "setLogin":
                    Login.Set(m.Flag("on"));
                    SendNativeInfo();
                    break;
                case "openURL":
                    OpenUrl(m.Get("url"));
                    break;
            }
        }

        void SendNativeInfo() =>
            RunJs("window.Istiqamah && window.Istiqamah.setNativeInfo(" + Json.Str(new Dict { ["login"] = Login.Enabled, ["version"] = Updater.Version }) + ")");

        public void SendToPage(string action, Dict e) =>
            RunJs("window.Istiqamah && window.Istiqamah.nativeAction(" + Json.Str(action) + ", " + Json.Str(e) + ")");

        // ------------------------------------------------------------ alarms

        void Tick()
        {
            var now = NowMs;
            var due = events.Where(e => e.Num("at") <= now && now <= e.Num("until") && e.Get("id") != null && !fired.ContainsKey(e.Get("id"))).ToList();
            if (due.Count > 0)
            {
                var latest = new Dictionary<string, Dict>();
                foreach (var e in due)
                {
                    fired[e.Get("id")] = now;
                    var g = e.Get("group") ?? e.Get("id");
                    if (latest.TryGetValue(g, out var c) && c.Num("at") >= e.Num("at")) continue;
                    latest[g] = e;
                }
                var cutoff = now - 3 * 86_400_000.0;
                fired = fired.Where(kv => kv.Value > cutoff).ToDictionary(kv => kv.Key, kv => kv.Value);
                Store.SaveFired(fired);
                foreach (var e in latest.Values.OrderBy(x => x.Num("at"))) Present(e, now - e.Num("at") > 180_000);
            }
            UpdateTrayText();
        }

        static bool IsPrayer(Dict e) { var k = e.Get("kind"); return k == "prayer" || k == "nag"; }

        void Present(Dict e, bool stale)
        {
            if (IsPrayer(e))
            {
                if (Style == "notification") alerts.ShowToast(e, true, stale);
                else alerts.ShowOverlay(e, Style == "popup", stale);
            }
            else if (e.Flag("fullscreen")) alerts.ShowOverlay(e, Style == "popup", stale);
            else alerts.ShowToast(e, false, stale);
        }

        public void OnAlertAction(string action, Dict e)
        {
            if (string.IsNullOrEmpty(action) || action == "stop") return;
            if (IsPrayer(e) || e.Flag("fullscreen")) alerts.CloseOverlay();
            if (action == "open")
            {
                ShowMain();
                RunJs("window.Istiqamah && window.Istiqamah.showToday()");
            }
            SendToPage(action, e);
        }

        // ------------------------------------------------------------ tray

        Dict CurrentPending(double now)
        {
            if (today == null || today.Flag("paused")) return null;
            return today.List("prayers").FirstOrDefault(p =>
                p.Get("key") != "sunrise" && p.Get("status") == null && p.Num("at") <= now && now < p.Num("end"));
        }

        static string Clock(double ms) =>
            new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddMilliseconds(ms).ToLocalTime().ToString("t", CultureInfo.CurrentCulture);

        void UpdateTrayText()
        {
            var now = NowMs;
            string text = "Istiqamah";
            var cur = CurrentPending(now);
            if (cur != null) text = $"Istiqamah · {cur.Get("name")} has come in";
            else if (today != null)
            {
                var next = today.List("prayers").FirstOrDefault(p => p.Num("at") > now);
                string name = next?.Get("name");
                double at = next?.Num("at") ?? 0;
                if (next == null && today.Num("nextFajr") > now) { name = "Fajr"; at = today.Num("nextFajr"); }
                if (name != null)
                {
                    var mins = (int)Math.Ceiling((at - now) / 60000);
                    text = mins <= 60 ? $"Istiqamah · {name} in {mins} min" : $"Istiqamah · {name} at {Clock(at)}";
                }
            }
            tray.Text = text.Length > 63 ? text.Substring(0, 63) : text;
        }

        void BuildMenu()
        {
            menu.Items.Clear();
            var now = NowMs;
            if (today != null && today.List("prayers").Any())
            {
                menu.Items.Add(new ToolStripMenuItem("Today" + (today.Get("place") != null ? " · " + today.Get("place") : "")) { Enabled = false });
                var nextKey = today.List("prayers").FirstOrDefault(p => p.Num("at") > now)?.Get("key");
                foreach (var p in today.List("prayers"))
                {
                    var item = new ToolStripMenuItem($"{p.Get("name"),-10}\t{Clock(p.Num("at"))}") { Checked = p.Get("status") != null && p.Get("status") != "missed" };
                    if (p.Get("key") == nextKey) item.Font = new Font(item.Font, FontStyle.Bold);
                    item.Click += (s, e) => ShowMain();
                    menu.Items.Add(item);
                }
                var cur = CurrentPending(now);
                if (cur != null)
                {
                    menu.Items.Add(new ToolStripSeparator());
                    var pr = new ToolStripMenuItem("I've prayed " + cur.Get("name"));
                    pr.Click += (s, e) => SendToPage("prayed", new Dict
                    {
                        ["id"] = "menu", ["kind"] = "prayer", ["prayer"] = cur.Get("key"), ["dateKey"] = cur.Get("dateKey"),
                        ["group"] = cur.Get("dateKey") + ":" + cur.Get("key"), ["title"] = cur.Get("name"),
                    });
                    menu.Items.Add(pr);
                }
            }
            else
            {
                var setup = new ToolStripMenuItem("Choose your city to get started…");
                setup.Click += (s, e) => ShowMain();
                menu.Items.Add(setup);
            }
            menu.Items.Add(new ToolStripSeparator());
            Add("Open Istiqamah", ShowMain);
            Add("Test the alarm", () => RunJs("window.Istiqamah && window.Istiqamah.testAlarm()"));
            var login = new ToolStripMenuItem("Start with Windows") { Checked = Login.Enabled };
            login.Click += (s, e) => { Login.Set(!Login.Enabled); SendNativeInfo(); };
            menu.Items.Add(login);
            menu.Items.Add(new ToolStripSeparator());
            Add("Check for updates…", () => updater.Check(true));
            menu.Items.Add(new ToolStripMenuItem("Version " + Updater.Version) { Enabled = false });
            Add("Uninstall Istiqamah…", () =>
            {
                var r = MessageBox.Show("Remove Istiqamah from this PC?\n\nYour chart is kept, so it's still there if you install it again.",
                    "Istiqamah", MessageBoxButtons.OKCancel, MessageBoxIcon.Question);
                if (r != DialogResult.OK) return;
                Installer.Uninstall();
                Quit();
            });
            Add("Quit Istiqamah", Quit);

            void Add(string text, Action a)
            {
                var i = new ToolStripMenuItem(text);
                i.Click += (s, e) => a();
                menu.Items.Add(i);
            }
        }
    }
}
