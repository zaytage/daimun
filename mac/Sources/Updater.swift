import AppKit
import CryptoKit

/// Keeps Istiqamah up to date by itself.
/// Reads a small feed on the Istiqamah website; when it lists a newer build, downloads the zip from
/// the GitHub release, checks its SHA-256 against the feed, waits until nothing is on screen,
/// swaps the app bundle and reopens it.
@MainActor
final class Updater: NSObject {
    static let feedURL = URL(string: "https://zaytage.github.io/istiqamah/update.json")!

    struct Feed: Decodable {
        struct App: Decodable {
            let version: String
            let build: Int
            let url: String
            let sha256: String
            let notes: String?
        }
        let app: App
    }

    enum UpdateError: LocalizedError {
        case badChecksum, badArchive
        var errorDescription: String? {
            switch self {
            case .badChecksum: return "The download didn't match the published fingerprint, so it wasn't installed."
            case .badArchive: return "The download didn't contain the app."
            }
        }
    }

    /// True while an alarm is on screen or the tracker window is open; the swap waits for a quiet moment.
    var isBusy: () -> Bool = { false }
    /// Shows a short message to the person (used for manual checks and after an update).
    var tell: (String, String?) -> Void = { _, _ in }

    private var checking = false
    private var ready: (app: URL, info: Feed.App)?

    var currentVersion: String { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?" }
    var currentBuild: Int { Int(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0") ?? 0 }

    func check(userInitiated: Bool = false) {
        if ready != nil { installWhenQuiet(); return }
        guard !checking else { return }
        checking = true
        Task {
            defer { self.checking = false }
            do {
                var req = URLRequest(url: Self.feedURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
                req.setValue("Istiqamah/\(currentVersion)", forHTTPHeaderField: "User-Agent")
                let (data, _) = try await URLSession.shared.data(for: req)
                let feed = try JSONDecoder().decode(Feed.self, from: data)
                guard feed.app.build > currentBuild else {
                    if userInitiated { tell("Istiqamah is up to date", "You have the latest version, \(currentVersion).") }
                    return
                }
                if userInitiated { tell("Updating to version \(feed.app.version)…", "It installs itself once no alarm is showing.") }
                try await download(feed.app)
            } catch {
                NSLog("Istiqamah: update check failed: \(error.localizedDescription)")
                if userInitiated { tell("Couldn't check for updates", error.localizedDescription) }
            }
        }
    }

    private func download(_ info: Feed.App) async throws {
        guard let url = URL(string: info.url) else { throw UpdateError.badArchive }
        let (file, _) = try await URLSession.shared.download(from: url)
        let data = try Data(contentsOf: file)
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        guard digest == info.sha256.lowercased() else { throw UpdateError.badChecksum }

        let work = FileManager.default.temporaryDirectory.appendingPathComponent("istiqamah-update-\(info.build)", isDirectory: true)
        try? FileManager.default.removeItem(at: work)
        try FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)
        let zip = work.appendingPathComponent("Istiqamah.zip")
        try data.write(to: zip)
        let unzip = Process()
        unzip.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
        unzip.arguments = ["-x", "-k", zip.path, work.path]
        try unzip.run()
        unzip.waitUntilExit()
        let app = work.appendingPathComponent("Istiqamah.app")
        guard unzip.terminationStatus == 0, FileManager.default.fileExists(atPath: app.appendingPathComponent("Contents/MacOS/Istiqamah").path) else {
            throw UpdateError.badArchive
        }
        ready = (app, info)
        installWhenQuiet()
    }

    /// Swap the app once no alarm is showing and the window is closed; otherwise try again in two minutes.
    func installWhenQuiet() {
        guard let ready else { return }
        if isBusy() {
            DispatchQueue.main.asyncAfter(deadline: .now() + 120) { [weak self] in self?.installWhenQuiet() }
            return
        }
        let target = Bundle.main.bundleURL
        guard FileManager.default.isWritableFile(atPath: target.deletingLastPathComponent().path) else {
            tell("Version \(ready.info.version) is ready", "Move Istiqamah into your Applications folder so it can update itself.")
            return
        }
        UserDefaults.standard.set(ready.info.version, forKey: "updatedTo")
        UserDefaults.standard.set(ready.info.notes ?? "", forKey: "updateNotes")
        // Runs after this process quits: put the new app in place (keeping the old one until the new one is there), then reopen.
        let script = """
        while /bin/kill -0 "$1" 2>/dev/null; do /bin/sleep 0.2; done
        /bin/rm -rf "$2.new" "$2.old"
        /usr/bin/ditto "$3" "$2.new" || exit 1
        /bin/mv "$2" "$2.old" && /bin/mv "$2.new" "$2" && /bin/rm -rf "$2.old"
        /usr/bin/xattr -dr com.apple.quarantine "$2" 2>/dev/null
        /usr/bin/open "$2" --args --updated
        """
        let sh = Process()
        sh.executableURL = URL(fileURLWithPath: "/bin/sh")
        sh.arguments = ["-c", script, "istiqamah-update", String(ProcessInfo.processInfo.processIdentifier), target.path, ready.app.path]
        do { try sh.run() } catch {
            tell("Couldn't install the update", error.localizedDescription)
            return
        }
        NSApp.terminate(nil)
    }

    /// After an update, say so once.
    func announceIfJustUpdated() {
        guard CommandLine.arguments.contains("--updated"), let v = UserDefaults.standard.string(forKey: "updatedTo") else { return }
        let notes = UserDefaults.standard.string(forKey: "updateNotes") ?? ""
        UserDefaults.standard.removeObject(forKey: "updatedTo")
        tell("Istiqamah updated to version \(v)", notes.isEmpty ? nil : notes)
    }
}
