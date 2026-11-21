import AppKit
import AVFoundation

/// Everything the Mac app keeps on disk, in ~/Library/Application Support/Istiqamah.
@MainActor
final class DataStore {
    let dir: URL
    private(set) var dataJSON: String?

    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        dir = base.appendingPathComponent("Istiqamah", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        if let s = try? String(contentsOf: file("data.json"), encoding: .utf8), Self.isJSON(s) { dataJSON = s }
    }

    func file(_ name: String) -> URL { dir.appendingPathComponent(name) }

    static func isJSON(_ s: String) -> Bool {
        guard let d = s.data(using: .utf8) else { return false }
        return (try? JSONSerialization.jsonObject(with: d)) != nil
    }

    /// The tracker data (settings + days) as written by the web app.
    func saveData(_ s: String) {
        guard Self.isJSON(s) else { return }
        dataJSON = s
        try? s.data(using: .utf8)?.write(to: file("data.json"), options: .atomic)
    }

    func saveSchedule(_ events: [AppEvent]) {
        if let d = try? JSONEncoder().encode(events) { try? d.write(to: file("schedule.json"), options: .atomic) }
    }

    func loadSchedule() -> [AppEvent] {
        guard let d = try? Data(contentsOf: file("schedule.json")) else { return [] }
        return (try? JSONDecoder().decode([AppEvent].self, from: d)) ?? []
    }

    func loadFired() -> [String: Double] {
        guard let d = try? Data(contentsOf: file("fired.json")) else { return [:] }
        return (try? JSONDecoder().decode([String: Double].self, from: d)) ?? [:]
    }

    func saveFired(_ f: [String: Double]) {
        if let d = try? JSONEncoder().encode(f) { try? d.write(to: file("fired.json"), options: .atomic) }
    }

    var adhanURL: URL? {
        let items = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
        return items.first { $0.lastPathComponent.hasPrefix("adhan.") }
    }

    var adhanName: String? {
        guard adhanURL != nil else { return nil }
        return UserDefaults.standard.string(forKey: "adhanName") ?? "Adhan"
    }

    func setAdhan(from src: URL) throws {
        clearAdhan()
        let ext = src.pathExtension.isEmpty ? "mp3" : src.pathExtension.lowercased()
        try FileManager.default.copyItem(at: src, to: file("adhan.\(ext)"))
        UserDefaults.standard.set(src.lastPathComponent, forKey: "adhanName")
    }

    func clearAdhan() {
        if let u = adhanURL { try? FileManager.default.removeItem(at: u) }
        UserDefaults.standard.removeObject(forKey: "adhanName")
    }
}

/// Plays the adhan, the chime and the soft reminder sound.
@MainActor
final class SoundPlayer {
    let store: DataStore
    var alarmMode = "adhan"      // adhan | chime | silent
    var remindersOn = true
    private var alarmPlayer: AVAudioPlayer?
    private var reminderPlayer: AVAudioPlayer?

    init(store: DataStore) { self.store = store }

    static let defaultAdhan = "sounds/adhan-makkah.mp4"
    static let tones: Set<String> = ["chime", "ishraq", "duha", "night", "dua"]

    /// `adhan` is the file the page chose for this prayer (a path under web/), or "custom".
    func playAlarm(_ kind: String, adhan: String? = nil) {
        if alarmMode == "silent" || kind == "none" { return }
        if kind == "adhan", alarmMode == "adhan" {
            alarmPlayer = play(adhanURL(adhan ?? Self.defaultAdhan), replacing: alarmPlayer)
            return
        }
        alarmPlayer = play(bundled("sounds/chime.wav"), replacing: alarmPlayer)
    }

    /// A sunnah time's own tone, played like an alarm (so Stop sound works) when it is shown full screen.
    func playTone(_ kind: String) {
        if alarmMode == "silent" { return }
        alarmPlayer = play(bundled("sounds/\(Self.tones.contains(kind) ? kind : "soft").wav"), replacing: alarmPlayer)
    }

    /// Reminders and the sunnah times each have their own tone.
    func playReminder(_ kind: String) {
        guard remindersOn, kind != "none" else { return }
        reminderPlayer = play(bundled("sounds/\(Self.tones.contains(kind) ? kind : "soft").wav"), replacing: reminderPlayer)
    }

    /// Play a file from the page's settings: a path under web/, or "custom".
    func preview(_ path: String) {
        alarmPlayer = play(adhanURL(path), replacing: alarmPlayer)
    }

    func stop() {
        alarmPlayer?.stop()
        alarmPlayer = nil
    }

    private func adhanURL(_ path: String) -> URL? {
        if path == "custom" { return store.adhanURL ?? bundled(Self.defaultAdhan) }
        return bundled(path) ?? bundled(Self.defaultAdhan)
    }

    private func bundled(_ rel: String) -> URL? {
        guard !rel.contains(".."), let base = Bundle.main.resourceURL?.appendingPathComponent("web", isDirectory: true) else { return nil }
        let url = base.appendingPathComponent(rel)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    private func play(_ url: URL?, replacing old: AVAudioPlayer?) -> AVAudioPlayer? {
        old?.stop()
        guard let url, let p = try? AVAudioPlayer(contentsOf: url) else { NSSound.beep(); return nil }
        p.prepareToPlay()
        p.play()
        return p
    }
}
