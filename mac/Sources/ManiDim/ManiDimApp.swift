import SwiftUI
import AVFoundation

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) {
        AudioManager.shared.stop()
        AudioManager.shared.stopSFX()
        AudioManager.shared.engine.stop()
    }
}

@main
struct ManiDimApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var app = AppModel()

    init() {
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--icon"), i + 1 < args.count {
            MainActor.assumeIsolated { IconMaker.render(to: args[i + 1]) }
            exit(0)
        }
        if args.contains("--prerender") { Prerender.run(); exit(0) }
        if args.contains("--selftest") {
            SelfTest.run()
            exit(0)
        }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                .frame(minWidth: 1100, minHeight: 720)
                .preferredColorScheme(.light)
                .focusEffectDisabled()
                .onAppear {
                    NSApp.setActivationPolicy(.regular)
                    NSApp.activate(ignoringOtherApps: true)
                }
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1360, height: 860)
        .commands {
            CommandGroup(replacing: .newItem) {}
            CommandGroup(replacing: .undoRedo) {
                Button("Undo") { NotificationCenter.default.post(name: .editorUndo, object: nil) }.keyboardShortcut("z")
                Button("Redo") { NotificationCenter.default.post(name: .editorRedo, object: nil) }.keyboardShortcut("z", modifiers: [.command, .shift])
            }
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        ZStack {
            if app.screen != .game {
                AttractView(showFan: app.screen == .home, centerX: 0.73,
                            hue: app.screen == .songSelect ? app.library.song(id: app.selectedSongID)?.hue : nil)
                    .transition(.opacity)
            }

            switch app.screen {
            case .home:
                HomeView().transition(.opacity.combined(with: .move(edge: .leading)))
            case .songSelect:
                SongSelectView().transition(.opacity.combined(with: .scale(scale: 0.98)))
            case .settings:
                SettingsView().transition(.opacity.combined(with: .scale(scale: 0.98)))
            case .editor:
                EditorHost().transition(.opacity)
            case .game:
                if let s = app.session { GameView(session: s).id(ObjectIdentifier(s)).transition(.opacity) }
            case .results:
                if let r = app.result { ResultsView(result: r).transition(.opacity) }
            }

            if app.showHowTo {
                HowToPlayView { withAnimation(.easeOut(duration: 0.25)) { app.showHowTo = false } }
            }
            if app.showMods {
                ModsView(song: app.library.song(id: app.selectedSongID)) { withAnimation(.easeOut(duration: 0.25)) { app.showMods = false } }
            }
            if app.showNewSong {
                NewSongView { withAnimation(.easeOut(duration: 0.25)) { app.showNewSong = false } }
            }
        }
        .overlay(alignment: .bottom) {
            if let t = app.toast {
                Text(t).font(UI.font(17)).foregroundStyle(.black)
                    .padding(.horizontal, 20).padding(.vertical, 12)
                    .background(Capsule().fill(.white).overlay(Capsule().stroke(.black, lineWidth: 4)))
                    .shadow(color: .black.opacity(0.8), radius: 0, y: 5)
                    .padding(.bottom, 36)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .background(KeyCatcher())
        .onOpenURL { app.importMadim($0) }
        .background(Color.black)
        .ignoresSafeArea()
        .onAppear {
            DemoRunner.shared.setMusic(true)
            if CommandLine.arguments.contains("--ratetest") { DispatchQueue.main.asyncAfter(deadline: .now() + 2) { RateTest.run() } }
            if CommandLine.arguments.contains("--bpmtest") { DispatchQueue.main.asyncAfter(deadline: .now() + 6) { KeyTest.runBPM() } }
            if CommandLine.arguments.contains("--keytest") { DispatchQueue.main.asyncAfter(deadline: .now() + (CommandLine.arguments.contains("--screen") ? 6 : 3)) { KeyTest.run() } }
        }
        .animation(.easeInOut(duration: 0.3), value: app.showHowTo)
        .animation(.easeInOut(duration: 0.3), value: app.showNewSong)
        .animation(.easeInOut(duration: 0.3), value: app.showMods)
    }
}

enum IconMaker {
    @MainActor static func render(to path: String) {
        let view = ZStack {
            RoundedRectangle(cornerRadius: 224, style: .continuous)
                .fill(LinearGradient(colors: [Color(white: 0.62), Color(white: 0.38)], startPoint: .top, endPoint: .bottom))
            FanIcon(lanes: 4).frame(width: 760, height: 760).offset(y: 10)
        }
        .frame(width: 1024, height: 1024)
        let r = ImageRenderer(content: view)
        r.scale = 1
        if let img = r.nsImage, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
           let png = rep.representation(using: .png, properties: [:]) {
            try? png.write(to: URL(fileURLWithPath: path))
        }
    }
}

enum KeyTest {
    /// Sends synthetic key events through NSApp.sendEvent and reports how many the app swallowed.
    static func run() {
        func key(_ code: UInt16, _ chars: String, _ flags: NSEvent.ModifierFlags = []) -> NSEvent {
            NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime,
                             windowNumber: NSApp.keyWindow?.windowNumber ?? 0, context: nil, characters: chars,
                             charactersIgnoringModifiers: chars, isARepeat: false, keyCode: code)!
        }
        print("keytest: first responder on entry = \(String(describing: NSApp.keyWindow?.firstResponder))")
        let before = InputCenter.shared.swallowed
        let events = [key(53, "\u{1b}"), key(7, "x"), key(0, "a"), key(2, "d", .command), key(126, "\u{F700}")]
        for e in events { NSApp.sendEvent(e) }
        let n = InputCenter.shared.swallowed - before
        print("keytest: sent \(events.count) key events, swallowed \(n)")
        guard let w = NSApp.keyWindow, let content = w.contentView else { exit(n == events.count ? 0 : 1) }

        // A text field holding focus must not let Esc through, and Return must hand the keyboard back.
        let tv = NSTextView(frame: NSRect(x: 0, y: 0, width: 50, height: 20))
        content.addSubview(tv)
        w.makeFirstResponder(tv)
        let focused = w.firstResponder === tv
        let b2 = InputCenter.shared.swallowed
        NSApp.sendEvent(key(53, "\u{1b}"))
        let escOK = focused && InputCenter.shared.swallowed == b2 + 1 && !(w.firstResponder is NSTextView)
        print("keytest: Esc inside a focused text view swallowed + focus released = \(escOK)")

        w.makeFirstResponder(tv)
        NSApp.sendEvent(key(36, "\r"))
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            let returnOK = !(w.firstResponder is NSTextView)
            print("keytest: Return releases focus after committing = \(returnOK)")
            tv.removeFromSuperview()
            exit(n == events.count && escOK && returnOK ? 0 : 1)
        }
    }
}

/// Renders every built-in song into the audio cache so the first play is instant.
enum Prerender {
    static func run() {
        let sem = DispatchSemaphore(value: 0)
        Task {
            for a in BuiltinSongs.arrangements {
                let t0 = Date()
                let url = await BuiltinSongs.ensureAudio(key: a.key)
                print("\(a.title): \(url != nil ? "ok" : "FAILED") (\(String(format: "%.1f", Date().timeIntervalSince(t0))) s)")
                fflush(stdout)
            }
            sem.signal()
        }
        sem.wait()
    }
}

extension KeyTest {
    /// Focuses the editor's BPM field and types at it; run with the NSBeep hook to see which keys beep.
    static func runBPM() {
        func key(_ code: UInt16, _ chars: String, _ down: Bool = true) -> NSEvent {
            NSEvent.keyEvent(with: down ? .keyDown : .keyUp, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                             windowNumber: NSApp.keyWindow?.windowNumber ?? 0, context: nil, characters: chars,
                             charactersIgnoringModifiers: chars, isARepeat: false, keyCode: code)!
        }
        setvbuf(stdout, nil, _IONBF, 0)
        guard let w = NSApp.keyWindow, let content = w.contentView else { print("bpmtest: no window"); exit(2) }
        func fields(_ v: NSView) -> [NSTextField] { (v as? NSTextField).map { [$0] } ?? [] + v.subviews.flatMap(fields) }
        func allFields(_ v: NSView) -> [NSTextField] {
            var out: [NSTextField] = []
            if let f = v as? NSTextField, f.isEditable { out.append(f) }
            for s in v.subviews { out += allFields(s) }
            return out
        }
        let fs = allFields(content)
        print("bpmtest: editable fields = \(fs.map { "“\($0.stringValue)”" })")
        guard let bpm = fs.first(where: { $0.stringValue == "128" }) else { print("bpmtest: BPM field not found"); exit(3) }
        w.makeFirstResponder(bpm)
        print("bpmtest: focused = \(w.firstResponder is NSTextView)")
        let steps: [(String, UInt16, String)] = [
            ("backspace", 51, "\u{7f}"), ("backspace", 51, "\u{7f}"), ("backspace", 51, "\u{7f}"), ("backspace on empty", 51, "\u{7f}"),
            ("digit 1", 18, "1"), ("digit 2", 19, "2"), ("digit 0", 29, "0"), ("period", 47, "."), ("digit 5", 23, "5"),
            ("space", 49, " "), ("letter a", 0, "a"), ("letter d", 2, "d"), ("minus", 27, "-"),
            ("arrow left", 123, "\u{F702}"), ("arrow right", 124, "\u{F703}"), ("arrow up", 126, "\u{F700}"), ("arrow down", 125, "\u{F701}"),
            ("tab", 48, "\t"), ("shift-tab-ish tab", 48, "\t"),
        ]
        var i = 0
        func next() {
            if i < steps.count {
                let (name, code, ch) = steps[i]; i += 1
                if !(w.firstResponder is NSTextView) { w.makeFirstResponder(bpm) }
                print("bpmtest: >> \(name)  (field=“\(bpm.stringValue)”)")
                NSApp.postEvent(key(code, ch), atStart: false); NSApp.postEvent(key(code, ch, false), atStart: false)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { next() }
            } else if i == steps.count {
                i += 1
                w.makeFirstResponder(bpm)
                print("bpmtest: >> return  (field=“\(bpm.stringValue)”)")
                NSApp.postEvent(key(36, "\r"), atStart: false); NSApp.postEvent(key(36, "\r", false), atStart: false)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { next() }
            } else if i == steps.count + 1 {
                i += 1
                print("bpmtest: after return responder = \(String(describing: w.firstResponder))")
                let after: [(String, UInt16, String)] = [("digit after return", 23, "5"), ("space after return", 49, " "), ("esc after return", 53, "\u{1b}"), ("letter after return", 2, "d")]
                var j = 0
                func sendAfter() {
                    guard j < after.count else { return }
                    let (n, c, ch) = after[j]; j += 1
                    print("bpmtest: >> \(n)  [keyDown]"); NSApp.postEvent(key(c, ch), atStart: false)
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                        print("bpmtest: >> \(n)  [keyUp]"); NSApp.postEvent(key(c, ch, false), atStart: false)
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { sendAfter() }
                    }
                }
                sendAfter()
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { print("bpmtest: done, field=“\(bpm.stringValue)”; calling NSSound.beep() to prove the hook works"); NSSound.beep(); DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { exit(0) } }
            }
        }
        next()
    }
}

/// Compares the game's song-time formula with where the audio engine really is, at several playback speeds.
enum RateTest {
    static func run() {
        setvbuf(stdout, nil, _IONBF, 0)
        let a = AudioManager.shared
        guard let url = BuiltinSongs.arrangement(forKey: "neon-drive").map({ BuiltinSongs.audioURL(for: $0) }), a.load(url: url) else { print("ratetest: no audio"); exit(2) }
        let rates: [Double] = [1.0, 0.75, 1.25, 1.5, 1.0]
        var i = 0
        func next() {
            guard i < rates.count else { exit(0) }
            let r = rates[i]; i += 1
            a.stop()
            a.setPlayRate(r)
            a.play(from: 5, delay: 0.5)
            DispatchQueue.main.asyncAfter(deadline: .now() + 3.5) {
                guard let nt = a.music.lastRenderTime, nt.isSampleTimeValid, nt.isHostTimeValid, let pt = a.music.playerTime(forNodeTime: nt) else {
                    print("ratetest: rate \(r): no render time"); next(); return
                }
                let sr = pt.sampleRate
                let engineMedia = 5 + Double(pt.sampleTime) / sr                 // media seconds the player has consumed
                let formula = a.position(atHost: AVAudioTime.seconds(forHostTime: nt.hostTime))
                print(String(format: "ratetest: rate %.2f  formula %.4f s  engine %.4f s  -> formula is %+.1f ms (media) = %+.1f ms (wall)  varispeed latency %.1f ms",
                             r, formula, engineMedia, (formula - engineMedia) * 1000, (formula - engineMedia) * 1000 / r, a.varispeed.auAudioUnit.latency * 1000))
                next()
            }
        }
        next()
    }
}
