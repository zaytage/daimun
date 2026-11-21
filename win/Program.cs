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
        public static string StartMenuShortcut => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Da’imun.lnk");
        public static bool Same(string a, string b) =>
            string.Equals(Path.GetFullPath(a).TrimEnd('\\'), Path.GetFullPath(b).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
    }

    static class Program
    {
        public static string[] Args = new string[0];
        public static bool Has(string flag) => Args.Contains(flag);

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
            if (!Paths.Same(Paths.AppDir, Paths.InstallDir) && !Has("--portable"))
            {
                Installer.InstallFromHere();
                return 0;
            }

            using (var mutex = new Mutex(true, @"Local\Istiqamah.SingleInstance", out bool first))
            {
                if (!first) { Signals.Raise("Show"); return 0; }
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
        public static void Set(bool on)
        {
            using (var k = Registry.CurrentUser.CreateSubKey(RunKey))
            {
                if (k.GetValue("Istiqamah") != null) k.DeleteValue("Istiqamah"); // the pre-rename entry
                if (on) k.SetValue("Daimun", "\"" + Paths.InstalledExe + "\" --background");
                else if (k.GetValue("Daimun") != null) k.DeleteValue("Daimun");
            }
        }
    }

    static class Installer
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool DeleteFile(string path);

        /// Copy a folder over another, retrying briefly while files are still locked.
        static void CopyDir(string src, string dst)
        {
            src = src.TrimEnd('\\');
            Directory.CreateDirectory(dst);
            foreach (var dir in Directory.GetDirectories(src, "*", SearchOption.AllDirectories))
                Directory.CreateDirectory(dst + dir.Substring(src.Length));
            foreach (var file in Directory.GetFiles(src, "*", SearchOption.AllDirectories))
            {
                var target = dst + file.Substring(src.Length);
                // an update made for pre-rename apps carries the program as Istiqamah.exe: install it as Daimun.exe
                var name = Path.GetFileName(target);
                if (name.StartsWith("Istiqamah.exe", StringComparison.OrdinalIgnoreCase))
                    target = Path.Combine(Path.GetDirectoryName(target), "Daimun.exe" + name.Substring("Istiqamah.exe".Length));
                for (int attempt = 0; ; attempt++)
                {
                    try { File.Copy(file, target, true); break; }
                    catch (IOException) when (attempt < 40) { Thread.Sleep(250); }
                    catch (UnauthorizedAccessException) when (attempt < 40) { Thread.Sleep(250); }
                }
            }
        }

        /// Remove the "downloaded from the internet" mark so Windows doesn't warn again for our own files.
        static void Unblock(string dir)
        {
            foreach (var f in Directory.GetFiles(dir, "*", SearchOption.AllDirectories)) DeleteFile(f + ":Zone.Identifier");
        }

        static void WaitForRunningCopyToQuit()
        {
            bool running;
            try { using (Mutex.OpenExisting(@"Local\Istiqamah.SingleInstance")) running = true; }
            catch { running = false; }
            if (!running) return;
            Signals.Raise("Quit");
            for (int i = 0; i < 40; i++)
            {
                Thread.Sleep(250);
                try { using (Mutex.OpenExisting(@"Local\Istiqamah.SingleInstance")) { } }
                catch { return; }
            }
        }

        static void CreateShortcut()
        {
            try
            {
                var t = Type.GetTypeFromProgID("WScript.Shell");
                dynamic shell = Activator.CreateInstance(t);
                try { File.Delete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Istiqamah.lnk")); } catch { }
                dynamic lnk = shell.CreateShortcut(Paths.StartMenuShortcut);
                lnk.TargetPath = Paths.InstalledExe;
                lnk.WorkingDirectory = Paths.InstallDir;
                lnk.Description = "Da’imun: the adhan on your laptop and a daily evaluation chart";
                lnk.Save();
            }
            catch { /* a missing shortcut is not fatal */ }
        }

        public static void InstallFromHere()
        {
            try
            {
                WaitForRunningCopyToQuit();
                bool fresh = !File.Exists(Paths.InstalledExe);
                bool wasOld = Directory.Exists(Paths.OldInstallDir);
                CopyDir(Paths.AppDir, Paths.InstallDir);
                Unblock(Paths.InstallDir);
                CreateShortcut();
                if (wasOld) RetireOldInstall();
                if (fresh) Login.Set(true); // an alarm app should start with Windows; it can be turned off in Settings
                Process.Start(new ProcessStartInfo(Paths.InstalledExe, "--welcome") { UseShellExecute = false, WorkingDirectory = Paths.InstallDir });
            }
            catch (Exception ex)
            {
                MessageBox.Show("Da’imun couldn't install itself:\n\n" + ex.Message, "Da’imun", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        public static void ApplyUpdate(int oldPid, string installDir)
        {
            try
            {
                try { using (var p = Process.GetProcessById(oldPid)) p.WaitForExit(30000); } catch { /* already gone */ }
                // Always install into Programs\Daimun; an app from before the rename lived in Programs\Istiqamah.
                bool fromOld = !Paths.Same(installDir, Paths.InstallDir);
                CopyDir(Paths.AppDir, Paths.InstallDir);
                Unblock(Paths.InstallDir);
                CreateShortcut();
                if (fromOld) RetireOldInstall();
                Process.Start(new ProcessStartInfo(Paths.InstalledExe, "--updated") { UseShellExecute = false, WorkingDirectory = Paths.InstallDir });
            }
            catch (Exception ex)
            {
                MessageBox.Show("Da’imun couldn't finish updating:\n\n" + ex.Message + "\n\nYou can download it again from github.com/zaytage/daimun.", "Da’imun", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        /// After moving from Programs\Istiqamah to Programs\Daimun: keep "start with Windows" as it was, then delete the old folder.
        static void RetireOldInstall()
        {
            bool startedWithWindows = Login.Enabled;
            Login.Set(startedWithWindows); // rewrites the entry under the new name and removes the old one
            var cmd = $"/c timeout /t 3 /nobreak >nul & rmdir /s /q \"{Paths.OldInstallDir}\"";
            try { Process.Start(new ProcessStartInfo("cmd.exe", cmd) { CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden }); } catch { }
        }

        /// Remove the app, its shortcut and start-up entry. Your chart (in AppData\Local\Daimun) is kept.
        public static void Uninstall()
        {
            Login.Set(false);
            try { File.Delete(Paths.StartMenuShortcut); } catch { }
            var cmd = $"/c timeout /t 2 /nobreak >nul & rmdir /s /q \"{Paths.InstallDir}\"";
            Process.Start(new ProcessStartInfo("cmd.exe", cmd) { CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden });
        }
    }
}
