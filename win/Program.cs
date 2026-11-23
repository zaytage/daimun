using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace Istiqamah
{
    static class Paths
    {
        static string Local => Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        /// Per-user install folder: no admin rights needed, and the app can update itself there.
        public static string InstallDir => Path.Combine(Local, "Programs", "Daimun");
        public static string OldInstallDir => Path.Combine(Local, "Programs", "Istiqamah"); // before the rename (1.2.x)
        public static string DataDir
        {
            get
            {
                var d = Path.Combine(Local, "Daimun");
                var old = Path.Combine(Local, "Istiqamah"); // before the rename: move the chart and settings over once
                if (!Directory.Exists(d) && Directory.Exists(old)) { try { Directory.Move(old, d); } catch { /* in use: keep going with a fresh folder */ } }
                Directory.CreateDirectory(d); return d;
            }
        }
        public static string AppDir => AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        public static string WebDir => Path.Combine(AppDir, "web");
        public static string InstalledExe => Path.Combine(InstallDir, "Daimun.exe");
        public static string CurrentExe => Application.ExecutablePath;
        /// Running from the extracted folder instead of Programs\Daimun (Windows didn't allow the install).
        public static bool Portable => !Same(AppDir, InstallDir);
        public static string StartMenuShortcut => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Da’imun.lnk");
        public static bool Same(string a, string b) =>
            string.Equals(Path.GetFullPath(a).TrimEnd('\\'), Path.GetFullPath(b).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
    }

    static class Program
    {
        public static string[] Args = new string[0];
        public static bool Has(string flag) => Args.Contains(flag);
        /// Runs from its own folder: started that way, or Windows refused the install here before.
        public static bool RunsHere => Has("--portable") || File.Exists(Path.Combine(Paths.AppDir, "runs-here.txt"));

        [STAThread]
        static int Main(string[] args)
        {
            Args = args;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            // A downloaded update runs from its temporary folder to copy itself over the installed app.
            int i = Array.IndexOf(args, "--apply-update");
            if (i >= 0 && args.Length > i + 2)
            {
                Installer.ApplyUpdate(int.Parse(args[i + 1]), args[i + 2]);
                return 0;
            }
            // First run from the downloaded folder: install for this user, then start from there.
            if (!Paths.Same(Paths.AppDir, Paths.InstallDir) && !RunsHere)
            {
                Installer.InstallFromHere();
                return 0;
            }

            using (var mutex = new Mutex(true, @"Local\Istiqamah.SingleInstance", out bool first))
            {
                if (!first) { Signals.Raise("Show"); return 0; }
                Installer.TidyUp();
                Application.Run(new TrayApp());
                GC.KeepAlive(mutex);
            }
            return 0;
        }
    }

    /// Lets a second launch ask the running copy to show its window, and an installer ask it to quit.
    static class Signals
    {
        public static EventWaitHandle Get(string name) => new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\Istiqamah." + name);
        public static void Raise(string name) { using (var h = Get(name)) h.Set(); }
    }

    static class Login
    {
        const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        public static bool Enabled
        {
            get
            {
                using (var k = Registry.CurrentUser.OpenSubKey(RunKey))
                    return (k?.GetValue("Daimun") ?? k?.GetValue("Istiqamah")) is string v && v.IndexOf(".exe", StringComparison.OrdinalIgnoreCase) >= 0;
            }
        }
        /// Start with Windows (or not). Without an exe it uses the copy that is running now.
        public static void Set(bool on, string exe = null)
        {
            exe = exe ?? (Paths.Portable ? Paths.CurrentExe : Paths.InstalledExe);
            bool portable = !Paths.Same(exe, Paths.InstalledExe);
            using (var k = Registry.CurrentUser.CreateSubKey(RunKey))
            {
                if (k.GetValue("Istiqamah") != null) k.DeleteValue("Istiqamah"); // the pre-rename entry
                if (on) k.SetValue("Daimun", "\"" + exe + "\" --background" + (portable ? " --portable" : ""));
                else if (k.GetValue("Daimun") != null) k.DeleteValue("Daimun");
            }
        }
    }

    static class Installer
    {
        /// Copy a folder over another. Files are copied as plain bytes, and a file Windows keeps locked
        /// (a copy still running, or a virus scan) is moved aside first, which Windows allows even then.
        static void CopyDir(string src, string dst)
        {
            src = src.TrimEnd('\\');
            Directory.CreateDirectory(dst);
            foreach (var dir in Directory.GetDirectories(src, "*", SearchOption.AllDirectories))
                Directory.CreateDirectory(dst + dir.Substring(src.Length));
            foreach (var file in Directory.GetFiles(src, "*", SearchOption.AllDirectories))
            {
                if (file.EndsWith(".old", StringComparison.OrdinalIgnoreCase)) continue;
                var target = dst + file.Substring(src.Length);
                // an update made for pre-rename apps carries the program as Istiqamah.exe: install it as Daimun.exe
                var name = Path.GetFileName(target);
                if (name.StartsWith("Istiqamah.exe", StringComparison.OrdinalIgnoreCase))
                    target = Path.Combine(Path.GetDirectoryName(target), "Daimun.exe" + name.Substring("Istiqamah.exe".Length));
                CopyFile(file, target);
            }
        }

        static void CopyFile(string from, string to)
        {
            for (int attempt = 0; ; attempt++)
            {
                try
                {
                    using (var a = new FileStream(from, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                    using (var b = new FileStream(to, FileMode.Create, FileAccess.Write, FileShare.None))
                        a.CopyTo(b);
                    return;
                }
                catch (Exception e) when ((e is IOException || e is UnauthorizedAccessException) && attempt < 12)
                {
                    if (attempt == 3 && File.Exists(to))
                    {
                        // still locked: rename it out of the way and write a fresh file next to it
                        try { var old = to + ".old"; if (File.Exists(old)) File.Delete(old); File.Move(to, old); }
                        catch { try { File.Move(to, to + "." + DateTime.Now.Ticks + ".old"); } catch { } }
                    }
                    Thread.Sleep(400);
                }
            }
        }

        /// Remove files moved aside during an install or update, once nothing is using them.
        public static void TidyUp()
        {
            try { foreach (var f in Directory.GetFiles(Paths.AppDir, "*.old", SearchOption.AllDirectories)) { try { File.Delete(f); } catch { } } } catch { }
            if (Paths.Portable && Program.RunsHere)
            {
                // the folder may have been moved since: keep the start-up entry and shortcut pointing here
                if (Login.Enabled) { try { Login.Set(true); } catch { } }
                CreateShortcut(Paths.CurrentExe, "--portable");
            }
        }

        static void WaitForRunningCopyToQuit()
        {
            bool running;
            try { using (Mutex.OpenExisting(@"Local\Istiqamah.SingleInstance")) running = true; }
            catch { running = false; }
            if (running)
            {
                Signals.Raise("Quit");
                for (int i = 0; i < 40; i++)
                {
                    Thread.Sleep(250);
                    try { using (Mutex.OpenExisting(@"Local\Istiqamah.SingleInstance")) { } }
                    catch { running = false; break; }
                }
            }
            // a copy that didn't answer (stuck, or an older version) is closed so its files can be replaced
            int me = Process.GetCurrentProcess().Id;
            foreach (var p in Process.GetProcessesByName("Daimun").Concat(Process.GetProcessesByName("Istiqamah")))
            {
                try
                {
                    if (p.Id == me) continue;
                    var path = p.MainModule.FileName;
                    if (path.StartsWith(Paths.InstallDir, StringComparison.OrdinalIgnoreCase) || path.StartsWith(Paths.OldInstallDir, StringComparison.OrdinalIgnoreCase))
                    { p.Kill(); p.WaitForExit(5000); }
                }
                catch { /* not ours or already gone */ }
                finally { p.Dispose(); }
            }
        }

        static void CreateShortcut(string exe, string args)
        {
            try
            {
                var t = Type.GetTypeFromProgID("WScript.Shell");
                dynamic shell = Activator.CreateInstance(t);
                try { File.Delete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Istiqamah.lnk")); } catch { }
                dynamic lnk = shell.CreateShortcut(Paths.StartMenuShortcut);
                lnk.TargetPath = exe;
                lnk.Arguments = args;
                lnk.WorkingDirectory = Path.GetDirectoryName(exe);
                lnk.Description = "Da’imun: the adhan on your laptop and a daily evaluation chart";
                lnk.Save();
            }
            catch { /* a missing shortcut is not fatal */ }
        }

        public static void InstallFromHere()
        {
            // Opened straight from inside the zip: Windows gave us only this one file, so nothing can work yet.
            if (Paths.AppDir.StartsWith(Path.GetTempPath().TrimEnd('\\'), StringComparison.OrdinalIgnoreCase) && !Directory.Exists(Paths.WebDir))
            {
                MessageBox.Show("Please extract the download first.\n\nRight-click Daimun-windows.zip, choose Extract All…, then open the Daimun folder and double-click Daimun.exe.",
                    "Da’imun", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            try
            {
                WaitForRunningCopyToQuit();
                bool fresh = !File.Exists(Paths.InstalledExe);
                bool wasOld = Directory.Exists(Paths.OldInstallDir);
                CopyDir(Paths.AppDir, Paths.InstallDir);
                CreateShortcut(Paths.InstalledExe, "");
                if (wasOld) RetireOldInstall();
                if (fresh || wasOld) Login.Set(true, Paths.InstalledExe); // an alarm app should start with Windows; it can be turned off in Settings
                Process.Start(new ProcessStartInfo(Paths.InstalledExe, "--welcome") { UseShellExecute = false, WorkingDirectory = Paths.InstallDir });
            }
            catch (Exception ex)
            {
                RunFromHere(ex);
            }
        }

        /// Windows wouldn't let us install into Programs\Daimun (usually a virus scanner): run from this folder instead.
        static void RunFromHere(Exception why)
        {
            try { File.WriteAllText(Path.Combine(Paths.DataDir, "install-problem.txt"), DateTime.Now + "\r\n" + why); } catch { }
            try { File.WriteAllText(Path.Combine(Paths.AppDir, "runs-here.txt"), "Da’imun runs from this folder because Windows didn't allow it to install. Keep this folder.\r\n"); } catch { }
            MessageBox.Show("Windows didn't let Da’imun install itself, so it will run from this folder instead:\n\n" + Paths.AppDir +
                "\n\nEverything works the same: the adhan, reminders and your chart. Just keep this folder. If you delete it, Da’imun stops.",
                "Da’imun", MessageBoxButtons.OK, MessageBoxIcon.Information);
            try
            {
                CreateShortcut(Paths.CurrentExe, "--portable");
                Login.Set(true, Paths.CurrentExe);
                Process.Start(new ProcessStartInfo(Paths.CurrentExe, "--portable --welcome") { UseShellExecute = false, WorkingDirectory = Paths.AppDir });
            }
            catch (Exception ex)
            {
                MessageBox.Show("Da’imun couldn't start:\n\n" + ex.Message, "Da’imun", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        public static void ApplyUpdate(int oldPid, string installDir)
        {
            try
            {
                try { using (var p = Process.GetProcessById(oldPid)) p.WaitForExit(30000); } catch { /* already gone */ }
                bool fromOld = Paths.Same(installDir, Paths.OldInstallDir);
                if (!fromOld && !Paths.Same(installDir, Paths.InstallDir))
                {
                    // running from its own folder: update it where it is
                    CopyDir(Paths.AppDir, installDir);
                    var exe = Path.Combine(installDir, "Daimun.exe");
                    Process.Start(new ProcessStartInfo(exe, "--portable --updated") { UseShellExecute = false, WorkingDirectory = installDir });
                    return;
                }
                // Programs\Daimun; an app from before the rename lived in Programs\Istiqamah.
                CopyDir(Paths.AppDir, Paths.InstallDir);
                CreateShortcut(Paths.InstalledExe, "");
                if (fromOld) RetireOldInstall();
                Process.Start(new ProcessStartInfo(Paths.InstalledExe, "--updated") { UseShellExecute = false, WorkingDirectory = Paths.InstallDir });
            }
            catch (Exception ex)
            {
                MessageBox.Show("Da’imun couldn't finish updating:\n\n" + ex.Message + "\n\nIt keeps working as before. You can also download it again from zaytage.github.io/daimun.", "Da’imun", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                try { var old = Path.Combine(installDir, "Daimun.exe"); if (File.Exists(old)) Process.Start(new ProcessStartInfo(old, Paths.Same(installDir, Paths.InstallDir) ? "" : "--portable") { UseShellExecute = false, WorkingDirectory = installDir }); } catch { }
            }
        }

        /// After moving from Programs\Istiqamah to Programs\Daimun: keep "start with Windows" as it was, then delete the old folder.
        static void RetireOldInstall()
        {
            Login.Set(Login.Enabled, Paths.InstalledExe); // rewrites the entry under the new name and removes the old one
            for (int i = 0; i < 12 && Directory.Exists(Paths.OldInstallDir); i++)
            {
                try { Directory.Delete(Paths.OldInstallDir, true); } catch { Thread.Sleep(250); }
            }
        }

        /// Remove the app, its shortcut and start-up entry. Your chart (in AppData\Local\Daimun) is kept.
        public static void Uninstall()
        {
            Login.Set(false);
            try { File.Delete(Paths.StartMenuShortcut); } catch { }
            if (Paths.Portable) return; // running from its own folder: the person deletes that folder themselves
            var cmd = $"/c timeout /t 2 /nobreak >nul & rmdir /s /q \"{Paths.InstallDir}\"";
            Process.Start(new ProcessStartInfo("cmd.exe", cmd) { CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden });
        }
    }
}
