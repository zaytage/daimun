import Cocoa
import WebKit
import ServiceManagement
import UniformTypeIdentifiers

/// Menu-bar app: hosts the shared web app for the tracker and fires the alarms natively,
/// so the adhan and the full-screen reminder work even when the tracker window is closed.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, NSMenuDelegate,
                         WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    let store = DataStore()
    lazy var sound = SoundPlayer(store: store)
    let alerts = AlertPresenter()
    let updater = Updater()

    var statusItem: NSStatusItem!
    var window: NSWindow!
    var webView: WKWebView!

    var events: [AppEvent] = []
    var style = "fullscreen"
    var today: TodaySummary?
    var fired: [String: Double] = [:]
    var pageReady = false
    var pendingJS: [String] = []
    var timers: [Timer] = []
    let debug = ProcessInfo.processInfo.environment["ISTIQAMAH_DEBUG"] != nil

    // MARK: Launch

    func applicationDidFinishLaunching(_ notification: Notification) {
        fired = store.loadFired()
        events = store.loadSchedule()
        alerts.onAction = { [weak self] action, event in self?.handleAlertAction(action, event) }
        buildMainMenu()
        setupStatusItem()
        setupWebView()
        setupWindow()
        timers.append(Timer.scheduledTimer(timeInterval: 10, target: self, selector: #selector(tick), userInfo: nil, repeats: true))
        timers.append(Timer.scheduledTimer(timeInterval: 300, target: self, selector: #selector(requestSchedule), userInfo: nil, repeats: true))
        DistributedNotificationCenter.default().addObserver(self, selector: #selector(openWindowAction),
                                                            name: IstiqamahMain.showNotification, object: nil)
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(didWake),
                                                          name: NSWorkspace.didWakeNotification, object: nil)
        updateStatusTitle()
        setupUpdater()
        if store.dataJSON == nil || CommandLine.arguments.contains("--show") { showWindow() }
        if CommandLine.arguments.contains("--login-on") {
            setLogin(true)
            NSLog("Istiqamah: open at login status = \(SMAppService.mainApp.status.rawValue) (1 = enabled, 2 = needs approval)")
        }
        if CommandLine.arguments.contains("--test-alarm") { runJS("window.Istiqamah && window.Istiqamah.testAlarm()") }
    }

    // MARK: Updates

    func setupUpdater() {
        updater.isBusy = { [weak self] in
            guard let self else { return true }
            return self.alerts.overlayEvent != nil || self.window.isVisible
        }
        updater.tell = { [weak self] title, body in
            let now = Date().timeIntervalSince1970 * 1000
            self?.alerts.showToast(AppEvent(id: "update-\(now)", at: now, until: now + 600_000, kind: "info", title: title, body: body,
                                            actions: [EventAction(id: "dismiss", label: "OK", primary: nil)], autoClose: 25))
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.updater.announceIfJustUpdated() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 45) { [weak self] in self?.updater.check() }
        updater.watchNetwork()
        timers.append(Timer.scheduledTimer(timeInterval: 3 * 3600, target: self, selector: #selector(checkUpdatesQuietly), userInfo: nil, repeats: true))
    }
    @objc func checkUpdatesQuietly() { updater.check() }
    @objc func checkUpdatesNow() { updater.check(userInitiated: true) }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showWindow()
        return true
    }

    // MARK: Menus

    func buildMainMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Da’imun", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Settings…", action: #selector(openSettings), keyEquivalent: ",")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Da’imun", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Quit Da’imun", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let editItem = NSMenuItem()
        main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit

        let winItem = NSMenuItem()
        main.addItem(winItem)
        let win = NSMenu(title: "Window")
        win.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        win.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: "Reload", action: #selector(reloadPage), keyEquivalent: "r")
        winItem.submenu = win
        NSApp.mainMenu = main
    }

    func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let b = statusItem.button {
            let img = NSImage(systemSymbolName: "moon.stars.fill", accessibilityDescription: "Da’imun")
            img?.isTemplate = true
            b.image = img
            b.imagePosition = .imageLeading
            b.font = NSFont.monospacedDigitSystemFont(ofSize: NSFont.systemFontSize, weight: .regular)
        }
        let menu = NSMenu()
        menu.delegate = self
        statusItem.menu = menu
    }

    private func menuItem(_ title: String, _ action: Selector?, _ key: String = "") -> NSMenuItem {
        let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
        i.target = self
        return i
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let now = Date().timeIntervalSince1970 * 1000
        let fmt = DateFormatter()
        fmt.timeStyle = .short
        fmt.dateStyle = .none
        if let t = today, !t.prayers.isEmpty {
            let head = NSMenuItem(title: "Today" + (t.place.map { " · \($0)" } ?? ""), action: nil, keyEquivalent: "")
            head.isEnabled = false
            menu.addItem(head)
            let next = t.prayers.first { $0.at > now }?.key
            let ps = NSMutableParagraphStyle()
            ps.tabStops = [NSTextTab(textAlignment: .right, location: 170)]
            for p in t.prayers {
                let item = menuItem("", #selector(openWindowAction))
                let time = fmt.string(from: Date(timeIntervalSince1970: p.at / 1000))
                let font = p.key == next ? NSFont.menuFont(ofSize: 0).withWeight(.semibold) : NSFont.menuFont(ofSize: 0)
                item.attributedTitle = NSAttributedString(string: "\(p.name)\t\(time)", attributes: [.paragraphStyle: ps, .font: font])
                if let st = p.status { item.state = st == "missed" ? .mixed : .on }
                menu.addItem(item)
            }
            if let cur = currentPending(now) {
                menu.addItem(.separator())
                menu.addItem(menuItem("I've prayed \(cur.name)", #selector(markCurrentPrayed)))
            }
            if t.paused == true {
                let p = NSMenuItem(title: "Solat alarms are paused", action: nil, keyEquivalent: "")
                p.isEnabled = false
                menu.addItem(p)
            }
        } else {
            menu.addItem(menuItem("Choose your city to get started…", #selector(openWindowAction)))
        }
        menu.addItem(.separator())
        menu.addItem(menuItem("Open Da’imun", #selector(openWindowAction), "o"))
        menu.addItem(menuItem("Test the alarm", #selector(testAlarm)))
        let soundItem = NSMenuItem(title: "Adhan sound", action: nil, keyEquivalent: "")
        let sm = NSMenu()
        sm.addItem(menuItem("Choose the adhan in Settings…", #selector(openSettings)))
        sm.addItem(.separator())
        sm.addItem(menuItem("Use my own recording…", #selector(chooseAdhan)))
        if let name = store.adhanName {
            sm.addItem(menuItem("Play my recording (\(name))", #selector(previewAdhan)))
            sm.addItem(menuItem("Remove my recording", #selector(clearAdhan)))
        }
        sm.addItem(menuItem("Stop sound", #selector(stopSound)))
        soundItem.submenu = sm
        menu.addItem(soundItem)
        let login = menuItem("Open at login", #selector(toggleLogin))
        login.state = loginEnabled ? .on : .off
        menu.addItem(login)
        menu.addItem(.separator())
        menu.addItem(menuItem("Check for updates…", #selector(checkUpdatesNow)))
        let version = NSMenuItem(title: "Version \(updater.currentVersion)", action: nil, keyEquivalent: "")
        version.isEnabled = false
        menu.addItem(version)
        menu.addItem(menuItem("Quit Da’imun", #selector(quit), "q"))
    }

    // MARK: Web view and window

    func setupWebView() {
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "istiqamah")
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1060, height: 820), configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        if #available(macOS 13.3, *) { webView.isInspectable = true }
        refreshDataScript()
        let dir = Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true)
        webView.loadFileURL(dir.appendingPathComponent("index.html"), allowingReadAccessTo: dir)
    }

    /// The page reads its saved data from this script, so it survives restarts even if WebKit storage is cleared.
    func refreshDataScript() {
        let ucc = webView.configuration.userContentController
        ucc.removeAllUserScripts()
        let src = "window.__ISTIQAMAH_DATA__ = \(store.dataJSON ?? "null");"
        ucc.addUserScript(WKUserScript(source: src, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    func setupWindow() {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1060, height: 820),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Da’imun"
        window.minSize = NSSize(width: 400, height: 520)
        window.contentView = webView
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.center()
        window.setFrameAutosaveName("IstiqamahMain")
    }

    func showWindow() {
        NSApp.setActivationPolicy(.regular)
        window.makeKeyAndOrderFront(nil)
        activate()
    }

    func windowWillClose(_ notification: Notification) {
        if (notification.object as? NSWindow) === window {
            NSApp.setActivationPolicy(.accessory)
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in self?.updater.installWhenQuiet() }
        }
    }

    func activate() {
        if #available(macOS 14.0, *) { NSApp.activate() } else { NSApp.activate(ignoringOtherApps: true) }
    }

    // MARK: Messages from the page

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let s = message.body as? String, let d = s.data(using: .utf8) else { return }
        let msg: Incoming
        do { msg = try JSONDecoder().decode(Incoming.self, from: d) } catch {
            NSLog("Istiqamah: could not read message: \(error)")
            return
        }
        if debug {
            let ev = msg.events?.items ?? []
            let kinds = Dictionary(grouping: ev, by: { $0.kind }).mapValues(\.count).sorted { $0.key < $1.key }.map { "\($0.key):\($0.value)" }.joined(separator: " ")
            let adhans = Set(ev.compactMap { e in e.adhan.map { "\(e.prayer ?? "?")=\($0)" } }).sorted().joined(separator: " ")
            NSLog("Istiqamah: message \(msg.type) event=\(msg.event?.id ?? "-") kinds[\(kinds)] adhans[\(adhans)]")
        }
        switch msg.type {
        case "ready":
            pageReady = true
            let queued = pendingJS
            pendingJS = []
            for js in queued { webView.evaluateJavaScript(js, completionHandler: nil) }
            sendNativeInfo()
        case "schedule":
            if let ev = msg.events?.items { events = ev; store.saveSchedule(ev) }
            if let s = msg.style { style = s }
            if let a = msg.alarmSound { sound.alarmMode = a }
            if let r = msg.reminderSound { sound.remindersOn = r }
            if let t = msg.today { today = t }
            // Close a prayer alarm that is no longer pending (marked in the tracker, or its time has ended).
            if let oe = alerts.overlayEvent, oe.test != true, let g = oe.group, !events.contains(where: { $0.group == g }) {
                alerts.closeOverlay()
                sound.stop()
            }
            tick()
        case "save":
            if let data = msg.data { store.saveData(data); refreshDataScript() }
        case "fire":
            if let e = msg.event { present(e, stale: false) }
        case "show":
            if let e = msg.event {
                alerts.showToast(e)
                if e.kind != "info" && e.kind != "after" { sound.playReminder(e.sound ?? "soft") }
            }
        case "chooseAdhan": chooseAdhan()
        case "clearAdhan": clearAdhan()
        case "preview": sound.preview(msg.text ?? "adhan")
        case "stopSound": sound.stop()
        case "setLogin": setLogin(msg.on ?? false)
        case "export": exportData(msg.data ?? "{}", filename: msg.filename ?? "istiqamah-backup.json")
        case "print": printPage()
        case "copy":
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(msg.text ?? "", forType: .string)
        case "openURL":
            if let u = msg.url, let url = URL(string: u), let scheme = url.scheme, ["https", "http", "mailto"].contains(scheme) {
                NSWorkspace.shared.open(url)
            }
        default: break
        }
    }

    func runJS(_ js: String) {
        if pageReady { webView.evaluateJavaScript(js, completionHandler: nil) } else { pendingJS.append(js) }
    }

    func sendToPage(_ action: String, _ e: AppEvent) {
        guard let ej = try? JSONEncoder().encode(e), let es = String(data: ej, encoding: .utf8),
              let aj = try? JSONEncoder().encode(action), let asv = String(data: aj, encoding: .utf8) else { return }
        runJS("window.Istiqamah && window.Istiqamah.nativeAction(\(asv), \(es))")
    }

    func sendNativeInfo() {
        let info: [String: Any] = ["adhanName": store.adhanName ?? NSNull(), "login": loginEnabled]
        guard let d = try? JSONSerialization.data(withJSONObject: info), let s = String(data: d, encoding: .utf8) else { return }
        runJS("window.Istiqamah && window.Istiqamah.setNativeInfo(\(s))")
    }

    // MARK: Alarms

    @objc func tick() {
        let now = Date().timeIntervalSince1970 * 1000
        let due = events.filter { $0.at <= now && now <= $0.until && fired[$0.id] == nil }
        if !due.isEmpty {
            var latest: [String: AppEvent] = [:]
            for e in due {
                fired[e.id] = now
                let g = e.group ?? e.id
                if let c = latest[g], c.at >= e.at { continue }
                latest[g] = e
            }
            let cutoff = now - 3 * 86_400_000
            fired = fired.filter { $0.value > cutoff }
            store.saveFired(fired)
            for e in latest.values.sorted(by: { $0.at < $1.at }) { present(e, stale: now - e.at > 180_000) }
        }
        updateStatusTitle()
    }

    func present(_ e: AppEvent, stale: Bool) {
        if debug { NSLog("Istiqamah: present \(e.id) kind=\(e.kind) style=\(style) stale=\(stale)") }
        var snd = e.sound ?? "soft"
        if stale && snd == "adhan" { snd = "chime" }
        if e.isPrayer {
            if style == "notification" { alerts.showToast(e, persistent: true) } else { alerts.showPrayer(e, style: style) }
            sound.playAlarm(snd, adhan: e.adhan)
        } else if e.fullscreen == true {
            alerts.showPrayer(e, style: style == "popup" ? "popup" : "fullscreen")
            sound.playTone(snd)
        } else {
            alerts.showToast(e)
            sound.playReminder(snd)
        }
    }

    func handleAlertAction(_ action: String, _ e: AppEvent) {
        // Ishraq / Duha screens close on any choice except Stop sound.
        if e.fullscreen == true, !e.isPrayer, action != "stop" { sound.stop(); alerts.closeOverlay() }
        switch action {
        case "stop":
            sound.stop()
            return
        case "snooze", "prayed", "prayed-jamaah":
            sound.stop()
            if e.isPrayer { alerts.closeOverlay() }
        case "open":
            alerts.closeOverlay()
            showWindow()
            runJS("window.Istiqamah && window.Istiqamah.showToday()")
        default: break
        }
        sendToPage(action, e)
    }

    @objc func requestSchedule() { runJS("window.Istiqamah && window.Istiqamah.pushSchedule()") }

    @objc func didWake() {
        requestSchedule()
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in self?.updater.check() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.tick() }
    }

    // MARK: Menu bar title

    func currentPending(_ now: Double) -> TodayPrayer? {
        guard let t = today, t.paused != true else { return nil }
        return t.prayers.first { $0.key != "sunrise" && $0.status == nil && $0.at <= now && now < ($0.end ?? 0) }
    }

    func updateStatusTitle() {
        guard let b = statusItem?.button else { return }
        let now = Date().timeIntervalSince1970 * 1000
        guard let t = today, !t.prayers.isEmpty else { b.title = ""; return }
        if let cur = currentPending(now) { b.title = " \(cur.name) · now"; return }
        var next: (String, Double)?
        for p in t.prayers where p.at > now { next = (p.name, p.at); break }
        if next == nil, let nf = t.nextFajr, nf > now { next = ("Fajr", nf) }
        guard let n = next else { b.title = ""; return }
        let mins = Int(((n.1 - now) / 60_000).rounded(.up))
        if mins <= 60 {
            b.title = " \(n.0) in \(mins)m"
        } else {
            let f = DateFormatter()
            f.timeStyle = .short
            f.dateStyle = .none
            b.title = " \(n.0) \(f.string(from: Date(timeIntervalSince1970: n.1 / 1000)))"
        }
    }

    // MARK: Menu actions

    @objc func openWindowAction() { showWindow() }
    @objc func openSettings() { showWindow(); runJS("window.Istiqamah && window.Istiqamah.openSettings()") }
    @objc func testAlarm() { runJS("window.Istiqamah && window.Istiqamah.testAlarm()") }
    @objc func reloadPage() { pageReady = false; webView.reload() }
    @objc func stopSound() { sound.stop() }
    @objc func previewAdhan() { sound.preview("custom") }
    @objc func quit() { NSApp.terminate(nil) }

    @objc func markCurrentPrayed() {
        let now = Date().timeIntervalSince1970 * 1000
        guard let cur = currentPending(now), let dk = cur.dateKey else { return }
        let e = AppEvent(id: "menu", at: now, until: now, kind: "prayer", group: "\(dk):\(cur.key)", prayer: cur.key, dateKey: dk, title: cur.name)
        handleAlertAction("prayed", e)
    }

    @objc func chooseAdhan() {
        activate()
        let p = NSOpenPanel()
        p.title = "Choose an adhan recording"
        p.message = "Pick an audio file (mp3, m4a, wav…). Da’imun keeps its own copy."
        p.allowedContentTypes = [.audio]
        p.allowsMultipleSelection = false
        guard p.runModal() == .OK, let url = p.url else { return }
        do {
            try store.setAdhan(from: url)
            runJS("window.Istiqamah && window.Istiqamah.useCustomAdhan()")
        } catch {
            let a = NSAlert()
            a.messageText = "Couldn't use that file"
            a.informativeText = error.localizedDescription
            a.runModal()
        }
        sendNativeInfo()
    }

    @objc func clearAdhan() { store.clearAdhan(); sendNativeInfo() }

    var loginEnabled: Bool { SMAppService.mainApp.status == .enabled }

    func setLogin(_ on: Bool) {
        do {
            if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
        } catch {
            let a = NSAlert()
            a.messageText = on ? "Couldn't turn on Open at Login" : "Couldn't turn off Open at Login"
            a.informativeText = "\(error.localizedDescription)\n\nYou can also add Da’imun in System Settings → General → Login Items."
            a.runModal()
        }
        sendNativeInfo()
    }

    @objc func toggleLogin() { setLogin(!loginEnabled) }

    func exportData(_ data: String, filename: String) {
        activate()
        let p = NSSavePanel()
        p.nameFieldStringValue = filename
        p.allowedContentTypes = [.json]
        guard p.runModal() == .OK, let url = p.url else { return }
        do { try data.write(to: url, atomically: true, encoding: .utf8) } catch { NSAlert(error: error).runModal() }
    }

    func printPage() {
        let info = NSPrintInfo.shared
        info.orientation = .landscape
        info.horizontalPagination = .fit
        info.verticalPagination = .automatic
        let op = webView.printOperation(with: info)
        op.view?.frame = webView.bounds
        op.runModal(for: window, delegate: nil, didRun: nil, contextInfo: nil)
    }

    // MARK: WKUIDelegate (file pickers and confirm dialogs inside the page)

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo) async -> [URL]? {
        activate()
        let p = NSOpenPanel()
        p.canChooseFiles = true
        p.canChooseDirectories = false
        p.allowsMultipleSelection = parameters.allowsMultipleSelection
        return p.runModal() == .OK ? p.urls : nil
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo) async -> Bool {
        let a = NSAlert()
        a.messageText = message
        a.addButton(withTitle: "OK")
        a.addButton(withTitle: "Cancel")
        return a.runModal() == .alertFirstButtonReturn
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo) async {
        let a = NSAlert()
        a.messageText = message
        a.runModal()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        pageReady = false
        webView.reload()
    }
}

private extension NSFont {
    func withWeight(_ weight: NSFont.Weight) -> NSFont {
        NSFont.systemFont(ofSize: pointSize, weight: weight)
    }
}
