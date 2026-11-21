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
        public static string InstallDir => Path.Combine(Local, "Programs", "Istiqamah");
        public static string DataDir
        {
            get { var d = Path.Combine(Local, "Istiqamah"); Directory.CreateDirectory(d); return d; }
        }
        public static string AppDir => AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        public static string WebDir => Path.Combine(AppDir, "web");
        public static string InstalledExe => Path.Combine(InstallDir, "Istiqamah.exe");
        public static string StartMenuShortcut => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Istiqamah.lnk");
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
                    return k?.GetValue("Istiqamah") is string v && v.IndexOf("Istiqamah.exe", StringComparison.OrdinalIgnoreCase) >= 0;
            }
        }
        public static void Set(bool on)
        {
            using (var k = Registry.CurrentUser.CreateSubKey(RunKey))
            {
                if (on) k.SetValue("Istiqamah", "\"" + Paths.InstalledExe + "\" --background");
                else if (k.GetValue("Istiqamah") != null) k.DeleteValue("Istiqamah");
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
                dynamic lnk = shell.CreateShortcut(Paths.StartMenuShortcut);
                lnk.TargetPath = Paths.InstalledExe;
                lnk.WorkingDirectory = Paths.InstallDir;
                lnk.Description = "Istiqamah: the adhan on your laptop and a daily evaluation chart";
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
                CopyDir(Paths.AppDir, Paths.InstallDir);
                Unblock(Paths.InstallDir);
                CreateShortcut();
                if (fresh) Login.Set(true); // an alarm app should start with Windows; it can be turned off in Settings
                Process.Start(new ProcessStartInfo(Paths.InstalledExe, "--welcome") { UseShellExecute = false, WorkingDirectory = Paths.InstallDir });
            }
            catch (Exception ex)
            {
                MessageBox.Show("Istiqamah couldn't install itself:\n\n" + ex.Message, "Istiqamah", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        public static void ApplyUpdate(int oldPid, string installDir)
        {
            try
            {
                try { using (var p = Process.GetProcessById(oldPid)) p.WaitForExit(30000); } catch { /* already gone */ }
                CopyDir(Paths.AppDir, installDir);
                Unblock(installDir);
                Process.Start(new ProcessStartInfo(Path.Combine(installDir, "Istiqamah.exe"), "--updated") { UseShellExecute = false, WorkingDirectory = installDir });
            }
            catch (Exception ex)
            {
                MessageBox.Show("Istiqamah couldn't finish updating:\n\n" + ex.Message + "\n\nYou can download it again from github.com/zaytage/istiqamah.", "Istiqamah", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        /// Remove the app, its shortcut and start-up entry. Your chart (in AppData\Local\Istiqamah) is kept.
        public static void Uninstall()
        {
            Login.Set(false);
            try { File.Delete(Paths.StartMenuShortcut); } catch { }
            var cmd = $"/c timeout /t 2 /nobreak >nul & rmdir /s /q \"{Paths.InstallDir}\"";
            Process.Start(new ProcessStartInfo("cmd.exe", cmd) { CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden });
        }
    }
}
