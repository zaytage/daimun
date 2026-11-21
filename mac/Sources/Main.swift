import Cocoa

@main
enum IstiqamahMain {
    static let showNotification = Notification.Name("app.istiqamah.mac.show")

    @MainActor
    static func main() {
        // Only one Istiqamah at a time (two copies would play two adhans). A second launch
        // asks the running copy to show its window, then quits.
        let me = ProcessInfo.processInfo.processIdentifier
        let id = Bundle.main.bundleIdentifier ?? "app.istiqamah.mac"
        let others = NSRunningApplication.runningApplications(withBundleIdentifier: id).filter { $0.processIdentifier != me && !$0.isTerminated }
        if !others.isEmpty {
            DistributedNotificationCenter.default().postNotificationName(showNotification, object: nil, userInfo: nil, deliverImmediately: true)
            return
        }

        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        withExtendedLifetime(delegate) { app.run() }
    }
}
