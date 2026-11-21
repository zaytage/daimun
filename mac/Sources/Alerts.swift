import AppKit
import SwiftUI

// MARK: - Theme

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255,
                  blue: Double(hex & 0xff) / 255, opacity: opacity)
    }
}

enum Theme {
    static let gold = Color(hex: 0xE2B85C)
    static let goldText = Color(hex: 0xF1D58E)
    static let goldInk = Color(hex: 0x2A1D05)
    static let deep = Color(hex: 0x0B3C36)
    static let deeper = Color(hex: 0x051412)
    static let accent = Color(hex: 0x0F6B5F)
    static func arabic(_ size: CGFloat) -> Font { .custom("Geeza Pro", size: size) }
}

struct VisualEffect: NSViewRepresentable {
    var material: NSVisualEffectView.Material = .hudWindow
    func makeNSView(context: Context) -> NSVisualEffectView {
        let v = NSVisualEffectView()
        v.material = material
        v.blendingMode = .behindWindow
        v.state = .active
        return v
    }
    func updateNSView(_ v: NSVisualEffectView, context: Context) { v.material = material }
}

struct PillButton: ButtonStyle {
    var primary: Bool
    var large = true
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: large ? 16 : 13, weight: .semibold))
            .padding(.horizontal, large ? 24 : 14)
            .padding(.vertical, large ? 13 : 7)
            .foregroundStyle(primary ? Theme.goldInk : Color.white)
            .background(Capsule().fill(primary ? Theme.gold : Color.white.opacity(0.13)))
            .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.5)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .contentShape(Capsule())
    }
}

struct ToastButton: ButtonStyle {
    var primary: Bool
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12.5, weight: .semibold))
            .lineLimit(1)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .foregroundStyle(primary ? Color.white : Color.primary)
            .background(Capsule().fill(primary ? Theme.accent : Color.primary.opacity(0.08)))
            .opacity(configuration.isPressed ? 0.75 : 1)
            .contentShape(Capsule())
    }
}

// MARK: - Windows

final class AlertWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

final class ToastPanel: NSPanel {
    override var canBecomeKey: Bool { true }
}

/// Lets the first click on an inactive alert press the button instead of only activating the app.
final class FirstMouseHostingView<Content: View>: NSHostingView<Content> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

// MARK: - Prayer alarm view

/// View state lives in small observable models (the SwiftUI @State macro needs full Xcode to compile).
final class AlertModel: ObservableObject {
    @Published var jamaah = false
    @Published var armed = false
}

final class ToastModel: ObservableObject {
    @Published var done: Set<String> = []
}

struct PrayerAlertView: View {
    let event: AppEvent
    let showContent: Bool
    let fullScreen: Bool
    var compact = false
    @ObservedObject var model: AlertModel
    let onAction: (String) -> Void

    var body: some View {
        ZStack {
            if fullScreen {
                VisualEffect(material: .fullScreenUI).ignoresSafeArea()
                RadialGradient(colors: [Color(hex: 0x135F54, opacity: 0.93), Theme.deeper.opacity(0.97)],
                               center: UnitPoint(x: 0.5, y: 0.3), startRadius: 40, endRadius: 1100)
                    .ignoresSafeArea()
            } else {
                RoundedRectangle(cornerRadius: 26, style: .continuous)
                    .fill(LinearGradient(colors: [Color(hex: 0x135F54), Theme.deep], startPoint: .top, endPoint: .bottom))
            }
            if showContent { content.padding(fullScreen ? (compact ? 24 : 40) : 26) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear { [model] in DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { model.armed = true } }
    }

    private var content: some View {
        VStack(spacing: fullScreen ? (compact ? 9 : 14) : 10) {
            if let ar = event.arabic {
                Text(ar).font(Theme.arabic(fullScreen ? (compact ? 64 : 84) : 52)).foregroundStyle(Theme.goldText)
            }
            Text(event.title)
                .font(.system(size: fullScreen ? (compact ? 34 : 42) : 26, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
            if let s = event.subtitle {
                Text(s).font(.system(size: fullScreen ? 17 : 13)).foregroundStyle(.white.opacity(0.7)).multilineTextAlignment(.center)
            }
            if event.kind == "prayer" {
                HStack(spacing: 8) {
                    Text("حَيَّ عَلَى الصَّلَاةِ").font(Theme.arabic(fullScreen ? 26 : 19))
                    Text("· Come to prayer").font(.system(size: fullScreen ? 16 : 13))
                }
                .foregroundStyle(.white.opacity(0.9))
            }
            if let b = event.body {
                Text(b).font(.system(size: fullScreen ? 15 : 12.5)).foregroundStyle(.white.opacity(0.72))
                    .multilineTextAlignment(.center).frame(maxWidth: 520)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if fullScreen, let dua = event.duaAr {
                VStack(spacing: 6) {
                    Text(dua).font(Theme.arabic(compact ? 18 : 21)).multilineTextAlignment(.center).lineSpacing(compact ? 4 : 8)
                        .foregroundStyle(.white.opacity(0.92)).environment(\.layoutDirection, .rightToLeft)
                    if let t = event.duaTr { Text(t).font(.system(size: 12)).foregroundStyle(.white.opacity(0.55)) }
                }
                .padding(.horizontal, 20).padding(.vertical, 14)
                .frame(maxWidth: 620)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white.opacity(0.07)))
            }
            if event.isPrayer {
                Toggle(isOn: $model.jamaah) { Text("Prayed in jama'ah").foregroundStyle(.white.opacity(0.88)) }
                    .toggleStyle(.checkbox)
                    .padding(.top, 4)
                HStack(spacing: 12) {
                    Button("Remind me in \(Int(event.snooze ?? 10)) min") { onAction("snooze") }
                        .buttonStyle(PillButton(primary: false, large: fullScreen))
                        .keyboardShortcut(.cancelAction)
                    Button("I've prayed") { onAction(model.jamaah ? "prayed-jamaah" : "prayed") }
                        .buttonStyle(PillButton(primary: true, large: fullScreen))
                }
                .disabled(!model.armed)
            } else {
                // Ishraq / Duha: their own buttons (e.g. "Prayed Ishraq ✓" and "Later").
                HStack(spacing: 12) {
                    ForEach((event.actions ?? []).reversed(), id: \.id) { a in
                        Button(a.label) { onAction(a.id) }
                            .buttonStyle(PillButton(primary: a.primary ?? false, large: fullScreen))
                            .keyboardShortcut(a.id == "dismiss" ? .cancelAction : nil)
                    }
                }
                .padding(.top, 6)
                .disabled(!model.armed)
            }
            HStack(spacing: 22) {
                Button("Stop sound") { onAction("stop") }
                Button("Open tracker") { onAction("open") }
            }
            .buttonStyle(.plain)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(.white.opacity(0.6))
            .padding(.top, 2)
        }
        .frame(maxWidth: 680)
    }
}

// MARK: - Toast (reminders)

struct ToastView: View {
    let event: AppEvent
    @ObservedObject var model: ToastModel
    let onAction: (String, Int) -> Void

    private var buttons: [EventAction] { (event.actions ?? []).filter { !model.done.contains($0.id) } }
    private var main: [EventAction] { buttons.filter { $0.id != "dismiss" } }
    private var dismiss: EventAction? { buttons.first { $0.id == "dismiss" } }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: "moon.stars.fill").foregroundStyle(Theme.gold)
                Text(event.title).font(.system(size: 14, weight: .semibold)).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 4)
                Button { onAction("dismiss", 0) } label: {
                    Image(systemName: "xmark").font(.system(size: 10, weight: .bold)).padding(4)
                }
                .buttonStyle(.plain).foregroundStyle(.secondary)
            }
            if let ar = event.arabic {
                Text(ar).font(Theme.arabic(21)).lineSpacing(6)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .multilineTextAlignment(.trailing)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let tr = event.tr { Text(tr).font(.system(size: 12)).italic().foregroundStyle(.secondary) }
            if let b = event.body {
                Text(b).font(.system(size: 12.5)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            if !main.isEmpty || dismiss != nil {
                let rows = stride(from: 0, to: main.count, by: 2).map { Array(main[$0..<min($0 + 2, main.count)]) }
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                        HStack(spacing: 6) {
                            ForEach(row, id: \.id) { a in
                                Button(a.label) { tap(a.id) }.buttonStyle(ToastButton(primary: a.primary ?? false))
                            }
                        }
                    }
                    if let d = dismiss {
                        Button(d.label) { onAction("dismiss", 0) }
                            .buttonStyle(.plain).font(.system(size: 12.5, weight: .medium)).foregroundStyle(.secondary)
                    }
                }
                .padding(.top, 4)
            }
        }
        .padding(14)
        .background(VisualEffect(material: .popover).clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous)))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Color.primary.opacity(0.1)))
    }

    private func tap(_ id: String) {
        if event.sticky == true { model.done.insert(id) }
        let remaining = (event.actions ?? []).filter { $0.id != "dismiss" && !model.done.contains($0.id) }.count
        onAction(id, remaining)
    }
}

// MARK: - Presenter

@MainActor
final class AlertPresenter: NSObject {
    var onAction: ((String, AppEvent) -> Void)?
    private var overlayWindows: [NSWindow] = []
    private(set) var overlayEvent: AppEvent?
    private var toast: NSPanel?
    private var toastTimer: Timer?

    static func activeScreen() -> NSScreen {
        let loc = NSEvent.mouseLocation
        return NSScreen.screens.first { NSMouseInRect(loc, $0.frame, false) } ?? NSScreen.main ?? NSScreen.screens[0]
    }

    /// Full screen covers every display; "popup" shows a floating card on the active display.
    func showPrayer(_ e: AppEvent, style: String) {
        closeOverlay()
        overlayEvent = e
        let model = AlertModel()
        let full = style != "popup"
        let primary = Self.activeScreen()
        let screens = full ? NSScreen.screens : [primary]
        for screen in screens {
            let isPrimary = screen == primary
            let frame: NSRect
            if full {
                frame = screen.frame
            } else {
                let w: CGFloat = 540, h: CGFloat = 520, vf = screen.visibleFrame
                frame = NSRect(x: vf.midX - w / 2, y: vf.midY - h / 2 + 60, width: w, height: h)
            }
            let win = AlertWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
            win.level = full ? .screenSaver : .floating
            win.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
            win.isOpaque = false
            win.backgroundColor = .clear
            win.hasShadow = !full
            win.isReleasedWhenClosed = false
            let view = PrayerAlertView(event: e, showContent: isPrimary, fullScreen: full,
                                       compact: screen.frame.height < 940, model: model) { [weak self] action in
                self?.onAction?(action, e)
            }
            let host = FirstMouseHostingView(rootView: view)
            host.sizingOptions = []   // keep the window exactly the size of the screen / card
            win.contentView = host
            win.setFrame(frame, display: true)
            win.alphaValue = 0
            win.orderFrontRegardless()
            NSAnimationContext.runAnimationGroup { ctx in
                ctx.duration = 0.35
                win.animator().alphaValue = 1
            }
            if isPrimary { win.makeKey() }
            overlayWindows.append(win)
        }
        NSApp.activate(ignoringOtherApps: true)
    }

    func closeOverlay() {
        for w in overlayWindows { w.orderOut(nil); w.close() }
        overlayWindows.removeAll()
        overlayEvent = nil
    }

    func showToast(_ e: AppEvent, persistent: Bool = false) {
        closeToast()
        let width: CGFloat = 370
        let view = ToastView(event: e, model: ToastModel()) { [weak self] action, remaining in
            guard let self else { return }
            if action != "dismiss" { self.onAction?(action, e) }
            if action == "dismiss" || action == "open" || e.sticky != true || remaining == 0 { self.closeToast() }
        }
        .frame(width: width)
        let host = FirstMouseHostingView(rootView: view)
        let size = host.fittingSize
        let vf = Self.activeScreen().visibleFrame
        let frame = NSRect(x: vf.maxX - width - 14, y: vf.maxY - size.height - 12, width: width, height: size.height)
        let p = ToastPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        p.level = .statusBar
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        p.isOpaque = false
        p.backgroundColor = .clear
        p.hasShadow = true
        p.isReleasedWhenClosed = false
        p.hidesOnDeactivate = false
        p.isFloatingPanel = true
        p.contentView = host
        p.setFrame(frame, display: true)
        p.alphaValue = 0
        p.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.25
            p.animator().alphaValue = 1
        }
        toast = p
        if !persistent, let secs = e.autoClose, secs > 0 {
            toastTimer = Timer.scheduledTimer(timeInterval: secs, target: self, selector: #selector(toastTimedOut), userInfo: nil, repeats: false)
        }
    }

    @objc private func toastTimedOut() { closeToast() }

    func closeToast() {
        toastTimer?.invalidate()
        toastTimer = nil
        toast?.orderOut(nil)
        toast?.close()
        toast = nil
    }
}
