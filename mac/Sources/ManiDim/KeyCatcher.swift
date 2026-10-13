import SwiftUI
import AppKit

/// Invisible first responder that eats key events, so the system never plays the "error" beep
/// and Esc can't leave full screen. (The local event monitor in InputCenter does the real work.)
final class KeyCatcherView: NSView {
    override var acceptsFirstResponder: Bool { true }
    override func keyDown(with event: NSEvent) {}
    override func keyUp(with event: NSEvent) {}
    override func cancelOperation(_ sender: Any?) {}
    override func noResponder(for eventSelector: Selector) {}
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        DispatchQueue.main.async { [weak self] in
            guard let self, let w = self.window else { return }
            w.makeFirstResponder(self)
        }
    }
}

struct KeyCatcher: NSViewRepresentable {
    func makeNSView(context: Context) -> KeyCatcherView { KeyCatcherView() }
    func updateNSView(_ v: KeyCatcherView, context: Context) {
        // Re-claim focus when nothing (e.g. a text field) is using it.
        if let w = v.window, w.firstResponder === w || w.firstResponder == nil { w.makeFirstResponder(v) }
    }
}
