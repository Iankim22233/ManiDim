import AppKit
import CoreGraphics

struct KeyEvent {
    let code: UInt16
    let isDown: Bool
    let time: Double          // seconds, system uptime base (NSEvent.timestamp)
    let chars: String
    let isRepeat: Bool
    let isModifier: Bool
}

/// Central keyboard hub. Uses a local event monitor so that modifier keys
/// (⌘, ⇧, …) can be used as game keys and so we can swallow key events
/// (no beeps / menu shortcuts) while playing.
final class InputCenter {
    static let shared = InputCenter()

    var handler: ((KeyEvent) -> Bool)?
    var captureHandler: ((KeyEvent) -> Bool)?
    var scrollHandler: ((NSEvent) -> Bool)?
    /// Takes priority over `handler` (used by modal overlays, e.g. Esc to close).
    var overlayHandler: ((KeyEvent) -> Bool)?
    /// While true (gameplay, recording) every key is swallowed — including ⌘ combos.
    var lockKeys = false
    private(set) var swallowed = 0
    private(set) var down = Set<UInt16>()
    /// nil = not tested yet. Whether CGEventSource key polling agrees with events.
    private(set) var pollingReliable: Bool?
    private var monitor: Any?
    private var scrollMonitor: Any?
    private var clickMonitor: Any?

    func install() {
        guard monitor == nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .keyUp, .flagsChanged]) { [weak self] e in
            self?.handle(e) ?? e
        }
        // Clicking anywhere that isn't a text field releases a field's keyboard focus (like any Mac app),
        // so editor shortcuts and the game keys work again right after typing in a field.
        clickMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { e in
            if let w = e.window, !(w is NSPanel), w.firstResponder is NSTextView {
                var v: NSView? = w.contentView?.hitTest(e.locationInWindow)
                var onField = false
                while let cur = v {
                    if cur is NSTextView || cur is NSTextField { onField = true; break }
                    v = cur.superview
                }
                if !onField { InputCenter.shared.reclaimKeyboard(w) }
            }
            return e
        }
        scrollMonitor = NSEvent.addLocalMonitorForEvents(matching: [.scrollWheel]) { [weak self] e in
            if self?.scrollHandler?(e) == true { return nil }
            return e
        }
    }

    /// Hands keyboard focus to the invisible KeyCatcherView. The bare window as first responder beeps on every key.
    func reclaimKeyboard(_ window: NSWindow? = NSApp.keyWindow) {
        guard let w = window, !(w is NSPanel) else { return }
        func find(_ v: NSView?) -> KeyCatcherView? {
            guard let v else { return nil }
            if let k = v as? KeyCatcherView { return k }
            for s in v.subviews { if let k = find(s) { return k } }
            return nil
        }
        if let k = find(w.contentView) { w.makeFirstResponder(k) } else { w.makeFirstResponder(nil) }
    }

    func physicallyDown(_ code: UInt16) -> Bool {
        CGEventSource.keyState(.combinedSessionState, key: CGKeyCode(code))
    }

    /// True if we can trust polling to detect missed key-up events.
    func isReallyDown(_ code: UInt16) -> Bool {
        if pollingReliable == true { return physicallyDown(code) }
        return down.contains(code)
    }

    static func modifierIsDown(code: UInt16, raw: UInt) -> Bool? {
        switch code {
        case 54: return raw & 0x10 != 0       // right ⌘
        case 55: return raw & 0x08 != 0       // left ⌘
        case 56: return raw & 0x02 != 0       // left ⇧
        case 60: return raw & 0x04 != 0       // right ⇧
        case 58: return raw & 0x20 != 0       // left ⌥
        case 61: return raw & 0x40 != 0       // right ⌥
        case 59: return raw & 0x01 != 0       // left ⌃
        case 62: return raw & 0x2000 != 0     // right ⌃
        case 63: return NSEvent.ModifierFlags(rawValue: raw).contains(.function)
        default: return nil
        }
    }

    private func handle(_ e: NSEvent) -> NSEvent? {
        let isDown: Bool
        var chars = ""
        var isMod = false
        switch e.type {
        case .keyDown:
            isDown = true
            chars = e.charactersIgnoringModifiers ?? ""
        case .keyUp:
            isDown = false
            chars = e.charactersIgnoringModifiers ?? ""
        case .flagsChanged:
            guard let d = Self.modifierIsDown(code: e.keyCode, raw: e.modifierFlags.rawValue) else { return e }
            isDown = d
            isMod = true
        default:
            return e
        }
        let ke = KeyEvent(code: e.keyCode, isDown: isDown, time: e.timestamp, chars: chars,
                          isRepeat: e.type == .keyDown && e.isARepeat, isModifier: isMod)
        if isDown {
            if pollingReliable == nil && !isMod && !ke.isRepeat {
                pollingReliable = physicallyDown(ke.code)
            }
            down.insert(ke.code)
        } else {
            down.remove(ke.code)
        }
        if let cap = captureHandler {
            return cap(ke) ? nil : e
        }
        let keyWin = NSApp.keyWindow
        if keyWin is NSPanel { return e }
        if isDown, let w = keyWin, w.firstResponder === w { reclaimKeyboard(w) }   // bare window = error beep on every key          // open/save panels and alerts handle their own keys
        if let r = keyWin?.firstResponder, r is NSTextView {
            // A text field kept focus: Esc just ends editing — it must never reach the system
            // (that is what beeps and exits full screen).
            if e.type == .keyDown && e.keyCode == 53 {
                reclaimKeyboard(keyWin)
                swallowed += 1
                return nil
            }
            // Return/Enter commits the field, then hands the keyboard back to the game/editor
            // (otherwise the next Space or lane key would be typed into the field).
            if e.type == .keyDown && (e.keyCode == 36 || e.keyCode == 76) {
                DispatchQueue.main.async { InputCenter.shared.reclaimKeyboard(keyWin) }
            }
            return e
        }
        if overlayHandler?(ke) == true { return nil }
        if handler?(ke) == true { swallowed += 1; return nil }
        // Swallow stray key presses: no system "error" beep, and Esc no longer leaves full screen.
        // ⌘-shortcuts (Quit, Undo, …) still reach the menu.
        if e.type == .keyDown {
            if lockKeys || !e.modifierFlags.contains(.command) { swallowed += 1; return nil }
            // ⌘-combos: only the usual app/window shortcuts pass through; anything else would make the system beep.
            let allowed: Set<UInt16> = [12, 13, 4, 46, 6, 43, 3]   // Q W H M Z , F
            if !allowed.contains(e.keyCode) { swallowed += 1; return nil }
        }
        return e
    }
}

enum KeyNames {
    static func binding(for ev: KeyEvent) -> KeyBinding {
        KeyBinding(code: ev.code, label: label(code: ev.code, chars: ev.chars))
    }

    static func label(code: UInt16, chars: String) -> String {
        switch code {
        case 49: return "Space"
        case 36: return "Return"
        case 76: return "Enter"
        case 48: return "Tab"
        case 51: return "Delete"
        case 53: return "Esc"
        case 123: return "←"
        case 124: return "→"
        case 125: return "↓"
        case 126: return "↑"
        case 55: return "L ⌘"
        case 54: return "R ⌘"
        case 56: return "L ⇧"
        case 60: return "R ⇧"
        case 58: return "L ⌥"
        case 61: return "R ⌥"
        case 59: return "L ⌃"
        case 62: return "R ⌃"
        case 63: return "fn"
        case 57: return "⇪"
        default:
            let c = chars.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            return c.isEmpty ? "Key \(code)" : String(c.prefix(4))
        }
    }
}

/// Shared monotonic clock helpers (same time base as NSEvent.timestamp).
enum Clock {
    static func hostNow() -> Double {
        AudioManagerClock.seconds(mach_absolute_time())
    }
    /// Offset to convert NSEvent.timestamp into host seconds.
    static let eventSkew: Double = ProcessInfo.processInfo.systemUptime - hostNow()
    static func fromEvent(_ t: Double) -> Double { t - eventSkew }
}
