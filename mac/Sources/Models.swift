import Foundation

/// A button on an alarm or reminder, defined by the web app.
struct EventAction: Codable, Hashable {
    var id: String
    var label: String
    var primary: Bool?
}

/// One scheduled alarm or reminder. The web app builds the schedule; the Mac app fires it.
struct AppEvent: Codable {
    var id: String
    var at: Double            // ms since 1970
    var until: Double         // ms since 1970; not shown after this
    var kind: String          // prayer | nag | pre | adhkar | nudge | friday | dua | quran | sleep | fast | after | info
    var group: String?
    var prayer: String?
    var dateKey: String?
    var title: String
    var subtitle: String?
    var body: String?
    var arabic: String?
    var tr: String?
    var duaAr: String?
    var duaTr: String?
    var sound: String?
    var adhan: String?        // adhan file under web/, or "custom" for the person's own recording
    var actions: [EventAction]?
    var autoClose: Double?
    var sticky: Bool?
    var test: Bool?
    var snooze: Double?
    var fullscreen: Bool?    // Ishraq / Duha shown full screen like the prayers

    var isPrayer: Bool { kind == "prayer" || kind == "nag" }
}

struct TodayPrayer: Codable {
    var key: String
    var name: String
    var at: Double
    var end: Double?
    var status: String?
    var dateKey: String?
}

struct TodaySummary: Codable {
    var place: String?
    var prayers: [TodayPrayer]
    var nextFajr: Double?
    var paused: Bool?
}

/// Decodes an array, skipping any element that doesn't decode instead of failing the whole array.
struct Lossy<T: Codable>: Codable {
    var items: [T]
    private struct Skip: Codable {}
    init(from decoder: Decoder) throws {
        var c = try decoder.unkeyedContainer()
        var out: [T] = []
        while !c.isAtEnd {
            if let v = try? c.decode(T.self) { out.append(v) } else if (try? c.decode(Skip.self)) == nil { break }
        }
        items = out
    }
    func encode(to encoder: Encoder) throws { try items.encode(to: encoder) }
}

/// A message posted from the web page.
struct Incoming: Codable {
    var type: String
    var style: String?
    var alarmSound: String?
    var reminderSound: Bool?
    var events: Lossy<AppEvent>?
    var event: AppEvent?
    var today: TodaySummary?
    var data: String?
    var text: String?
    var url: String?
    var on: Bool?
    var filename: String?
}
