using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;
using Timer = System.Windows.Forms.Timer;

namespace Istiqamah
{
    using Dict = Dictionary<string, object>;

    /// Full-screen alarm window (one per display). Takes focus so its buttons work at once.
    sealed class AlertForm : Form
    {
        public AlertForm()
        {
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            ShowInTaskbar = false;
            TopMost = true;
            BackColor = Color.FromArgb(8, 40, 36);
            Text = "Istiqamah";
        }
    }

    /// Corner reminder card: stays on top without taking focus from what you're typing.
    sealed class ToastForm : Form
    {
        public ToastForm()
        {
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            ShowInTaskbar = false;
            TopMost = true;
            BackColor = Color.FromArgb(30, 40, 37);
            Text = "Istiqamah";
        }
        protected override bool ShowWithoutActivation => true;
        protected override CreateParams CreateParams
        {
            get { var cp = base.CreateParams; cp.ExStyle |= 0x00000080 /* WS_EX_TOOLWINDOW */ | 0x00000008 /* WS_EX_TOPMOST */; return cp; }
        }
    }

    sealed class Alerts
    {
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);

        readonly TrayApp app;
        readonly List<Form> overlay = new List<Form>();
        Dict overlayEvent;
        ToastForm toast;
        Timer toastTimer;

        public Alerts(TrayApp app) { this.app = app; }
        public bool OverlayVisible => overlay.Count > 0;

        static float Scale
        {
            get { using (var g = Graphics.FromHwnd(IntPtr.Zero)) return g.DpiX / 96f; }
        }

        string Payload(Dict e, string mode, bool stale)
        {
            var json = Json.Str(new Dict { ["event"] = e, ["mode"] = mode, ["stale"] = stale, ["alarmSound"] = app.AlarmSound, ["reminderSound"] = app.ReminderSound });
            return Uri.EscapeDataString(Convert.ToBase64String(Encoding.UTF8.GetBytes(json)));
        }

        void Host(Form f, Dict e, string mode, bool stale)
        {
            var web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = f.BackColor };
            f.Controls.Add(web);
            web.CoreWebView2InitializationCompleted += (s, a) =>
            {
                if (!a.IsSuccess) return;
                var core = web.CoreWebView2;
                TrayApp.Map(core);
                core.Settings.AreDefaultContextMenusEnabled = false;
                core.Settings.IsZoomControlEnabled = false;
                core.Settings.IsStatusBarEnabled = false;
                core.WebMessageReceived += (s2, m) => OnMessage(f, e, m.TryGetWebMessageAsString());
                core.Navigate("https://app.istiqamah/alert.html#" + Payload(e, mode, stale));
            };
            _ = web.EnsureCoreWebView2Async(app.Env);
        }

        void OnMessage(Form f, Dict e, string s)
        {
            var m = Json.Obj(s);
            if (m == null) return;
            switch (m.Get("type"))
            {
                case "action": app.OnAlertAction(m.Get("action"), e); break;
                case "close": if (f == toast) CloseToast(); else CloseOverlay(); break;
                case "size":
                    if (f == toast)
                    {
                        var h = (int)Math.Ceiling(m.Num("h") * Scale) + 2;
                        var wa = Screen.PrimaryScreen.WorkingArea;
                        toast.Bounds = new Rectangle(toast.Left, wa.Bottom - h - (int)(12 * Scale), toast.Width, Math.Min(h, wa.Height - 40));
                    }
                    break;
            }
        }

        // ------------------------------------------------------------ full screen

        public void ShowOverlay(Dict e, bool popup, bool stale)
        {
            if (app.Env == null) return;
            CloseOverlay();
            overlayEvent = e;
            var primary = Screen.FromPoint(Cursor.Position);
            var screens = popup ? new[] { primary } : Screen.AllScreens;
            foreach (var sc in screens)
            {
                bool main = sc.DeviceName == primary.DeviceName;
                var f = new AlertForm();
                if (popup)
                {
                    int w = (int)(560 * Scale), h = (int)(540 * Scale);
                    var wa = sc.WorkingArea;
                    f.Bounds = new Rectangle(wa.Left + (wa.Width - w) / 2, wa.Top + (wa.Height - h) / 2, w, h);
                }
                else f.Bounds = sc.Bounds;
                if (!main) f.Opacity = 0.94; // other displays are dimmed; the alarm itself shows where your mouse is
                overlay.Add(f);
                f.Show();
                if (main)
                {
                    Host(f, e, popup ? "popup" : "overlay", stale);
                    f.Activate();
                    SetForegroundWindow(f.Handle);
                }
            }
        }

        public void CloseOverlay()
        {
            foreach (var f in overlay) { try { f.Close(); f.Dispose(); } catch { } }
            overlay.Clear();
            overlayEvent = null;
        }

        /// Close the alarm once its prayer is ticked in the tracker, or its time has ended.
        public void CloseOverlayIfGone(List<Dict> events)
        {
            if (overlayEvent == null || overlayEvent.Flag("test")) return;
            var key = overlayEvent.Get("group") ?? overlayEvent.Get("id");
            if (!events.Any(x => (x.Get("group") ?? x.Get("id")) == key)) CloseOverlay();
        }

        // ------------------------------------------------------------ corner card

        public void ShowToast(Dict e, bool persistent, bool stale)
        {
            if (app.Env == null) return;
            CloseToast();
            var wa = Screen.PrimaryScreen.WorkingArea;
            int w = (int)(380 * Scale), h = (int)(200 * Scale), pad = (int)(12 * Scale);
            toast = new ToastForm { Bounds = new Rectangle(wa.Right - w - pad, wa.Bottom - h - pad, w, h) };
            toast.Show();
            Host(toast, e, "toast", stale);
            var secs = e.Num("autoClose");
            if (!persistent && secs > 0)
            {
                toastTimer = new Timer { Interval = (int)(secs * 1000) };
                toastTimer.Tick += (s, a) => CloseToast();
                toastTimer.Start();
            }
        }

        public void CloseToast()
        {
            toastTimer?.Stop();
            toastTimer?.Dispose();
            toastTimer = null;
            if (toast != null) { try { toast.Close(); toast.Dispose(); } catch { } toast = null; }
        }

        public void CloseAll() { CloseOverlay(); CloseToast(); }
    }
}
