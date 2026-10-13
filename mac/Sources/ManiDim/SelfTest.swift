import Foundation

enum SelfTest {
    static func run() {
        var failed = 0
        func check(_ c: Bool, _ msg: String) {
            if c { print("  ok   \(msg)") } else { print("  FAIL \(msg)"); failed += 1 }
        }
        let songs = BuiltinSongs.makeSongs()
        for s in songs {
            for ch in s.charts {
                let eng = GameEngine(chart: ch, laneCount: s.keyCount)
                eng.bot = true
                var t = -1.0
                while t < ch.lastTime + 2 { eng.update(now: t); t += 1.0 / 240 }
                let slides = ch.notes.reduce(0) { $0 + $1.slides.count }
                print("\(s.title) [\(ch.name)] Lv\(ch.level): \(ch.notes.count) notes, \(slides) slides, objects \(eng.totalObjects)")
                check(eng.counts[Judgment.perfect.rawValue] == eng.totalObjects, "bot all-perfect (\(eng.counts))")
                check(eng.score == 1_000_000, "score \(eng.score)")
                check(eng.isFinished, "finished")
            }
        }
        // osu!mania import (uses a local beatmap when available).
        let osu = URL(fileURLWithPath: NSHomeDirectory() + "/Downloads/1660279 xi - FREEDOM DiVE/xi - FREEDOM DiVE (Kawawa) [EASY].osu")
        if FileManager.default.fileExists(atPath: osu.path) {
            let sem = DispatchSemaphore(value: 0)
            Task.detached {
                do {
                    let s = try await OsuImporter.importFile(at: osu)
                    check(s.keyCount == 7, "osu keys \(s.keyCount)")
                    print("  charts:", s.charts.map { "\($0.name) Lv\($0.level) \($0.notes.count)" })
                    check(s.charts.count >= 1 && s.charts[0].notes.count > 300, "osu notes \(s.charts.first?.notes.count ?? 0)")
                    check(s.charts[0].notes.contains { $0.isHold }, "osu has hold")
                    check(abs(s.bpm - 222.2) < 0.5 && abs(s.offset - 2.133) < 0.001, "osu bpm \(s.bpm) offset \(s.offset)")
                    check(s.duration > 200, "osu audio converted \(s.duration)s")
                    let eng = GameEngine(chart: s.charts[0], laneCount: s.keyCount)
                    eng.bot = true
                    var t = -1.0
                    while t < s.charts[0].lastTime + 2 { eng.update(now: t); t += 1.0 / 240 }
                    check(eng.score == 1_000_000, "osu bot score \(eng.score)")
                    try? FileManager.default.removeItem(at: AppPaths.songDir(s.id))
                    // Mixed key counts: add a 4K copy of the same map next to the 7K one.
                    let fm = FileManager.default
                    let tmp = fm.temporaryDirectory.appendingPathComponent("osumix-" + UUID().uuidString)
                    try fm.createDirectory(at: tmp, withIntermediateDirectories: true)
                    defer { try? fm.removeItem(at: tmp) }
                    let dir = osu.deletingLastPathComponent()
                    try fm.copyItem(at: dir.appendingPathComponent("audio.mp3"), to: tmp.appendingPathComponent("audio.mp3"))
                    let txt = try String(contentsOf: osu, encoding: .utf8)
                    try txt.write(to: tmp.appendingPathComponent("a7.osu"), atomically: true, encoding: .utf8)
                    try txt.replacingOccurrences(of: "CircleSize:7", with: "CircleSize:4").replacingOccurrences(of: "Version:EASY", with: "Version:EASY4")
                        .write(to: tmp.appendingPathComponent("a4.osu"), atomically: true, encoding: .utf8)
                    let m = try await OsuImporter.importFile(at: tmp.appendingPathComponent("a7.osu"))
                    check(m.charts.map { $0.keys ?? m.keyCount } == [4, 7] && m.keyCount == 7 && m.mixedKeys, "mixed keys \(m.charts.map { $0.keys ?? m.keyCount }) label \(m.keysLabel)")
                    check(m.charts[0].notes.allSatisfy { $0.lane < 4 }, "4K lanes in range")
                    let back = try ChartText.parse(ChartText.write(m))
                    check(back.charts.map { $0.keys ?? back.keyCount } == m.charts.map { $0.keys ?? m.keyCount }, "mixed keys survive .mdc round trip")
                    try? fm.removeItem(at: AppPaths.songDir(m.id))
                } catch { check(false, "osu import: \(error.localizedDescription)") }
                sem.signal()
            }
            sem.wait()
        }
        // Manual hold + slide + miss tests.
        var chart = Chart(name: "t", level: 1, notes: [
            Note(time: 1.0, lane: 1, duration: 2.0, slides: [SlideEvent(time: 2.0, dir: 1)]),
            Note(time: 4.0, lane: 0),
        ])
        chart.sortNotes()
        do {
            let e = GameEngine(chart: chart, laneCount: 4)
            e.press(lane: 1, at: 1.02)
            e.update(now: 1.5)
            e.slide(dir: 1, at: 2.03)
            e.update(now: 3.1)
            e.release(lane: 1, at: 3.05)
            check(e.counts[Judgment.perfect.rawValue] == 3, "hold+slide perfect-ish \(e.counts)")
            e.update(now: 4.3)
            check(e.counts[Judgment.miss.rawValue] == 1, "late tap = miss \(e.counts)")
        }
        do {
            let e = GameEngine(chart: chart, laneCount: 4)
            e.press(lane: 1, at: 1.0)
            e.update(now: 1.5)
            e.release(lane: 1, at: 1.8)       // early release
            check(e.counts[Judgment.miss.rawValue] == 2, "early release drops tail + slide \(e.counts)")
            check(e.combo == 0, "combo reset")
        }
        do {
            let e = GameEngine(chart: chart, laneCount: 4)
            e.press(lane: 1, at: 1.0)
            e.slide(dir: -1, at: 2.0)              // wrong direction
            e.update(now: 2.3)
            check(e.counts[Judgment.miss.rawValue] == 1, "wrong slide direction = miss \(e.counts)")
        }
        // Mods: converted charts must be valid and fully playable by the bot.
        do {
            func validate(_ song: Song, _ ch: Chart, _ label: String) {
                let n = song.keyCount
                var ok = true
                var busy = [[(Double, Double)]](repeating: [], count: n)
                for note in ch.notes {
                    if note.lane < 0 || note.lane >= n { ok = false }
                    var l = note.lane
                    for sl in note.slides {
                        let nl = l + sl.dir
                        if nl < 0 || nl >= n { ok = false }
                        if sl.time <= note.time || sl.time >= note.endTime { ok = false }
                        l = nl
                    }
                    for seg in note.segments(count: n) where seg.lane >= 0 && seg.lane < n {
                        if busy[seg.lane].contains(where: { $0.0 < seg.to + 0.05 && $0.1 > seg.from - 0.05 }) { ok = false }
                        busy[seg.lane].append((seg.from, seg.to))
                    }
                }
                let eng = GameEngine(chart: ch, laneCount: n)
                eng.bot = true
                var t = -1.0
                while t < ch.lastTime + 2 { eng.update(now: t); t += 1.0 / 240 }
                check(ok && eng.counts[Judgment.perfect.rawValue] == eng.totalObjects && !ch.notes.isEmpty, "\(label): \(ch.notes.count) notes, valid + bot all-perfect")
            }
            for base in ["neon-drive", "glass-sunrise", "eclipse"] {
                guard let song = songs.first(where: { $0.builtinKey == base }) else { continue }
                let ci = 2
                for k in 1...8 {
                    let out = ModApplier.apply(song: song, chartIndex: ci, mods: ModSet(mods: [Mod(rawValue: "k\(k)")!]))
                    validate(out, out.charts[ci], "\(song.title) \(k)K")
                }
                for m in [Mod.mirror, .random, .noSlides, .holdOff, .doubleNotes] {
                    let out = ModApplier.apply(song: song, chartIndex: ci, mods: ModSet(mods: [m]))
                    validate(out, out.charts[ci], "\(song.title) \(m.title)")
                }
                let combo = ModApplier.apply(song: song, chartIndex: ci, mods: ModSet(mods: [.k6, .random, .doubleNotes]))
                validate(combo, combo.charts[ci], "\(song.title) 6K+Random+DN")
            }
            var ms = ModSet()
            ms.toggle(.k3); ms.toggle(.k5)
            check(ms.keyCount == 5 && ms.mods.count == 1, "key mods are exclusive")
            ms.toggle(.halfTime); ms.toggle(.doubleTime)
            check(ms.speed == 1.5 && !ms.has(.halfTime), "speed mods are exclusive")
            let m1 = ModSet(mods: [.doubleTime, .blackout]).multiplier(origKeys: 4)
            check(abs(m1 - 1.3 * 1.4) < 1e-9, "multipliers multiply (\(m1))")
            check(ModSet.keyMultiplier(from: 4, to: 2) < 1 && ModSet.keyMultiplier(from: 4, to: 8) > 1, "fewer keys easier, more keys harder")
            check(GameRenderer.visAlpha(.blindSpot, 0.3) < 0.01 && GameRenderer.visAlpha(.blindSpot, 0.8) > 0.99, "blind spot hides near notes")
            check(GameRenderer.visAlpha(.blindSpot2, 0.9) < 0.01 && GameRenderer.visAlpha(.blindSpot2, 0.1) > 0.99, "blind spot 2 fades notes in")
            // Timing windows scale.
            let strictChart = Chart(name: "w", level: 1, notes: [Note(time: 1.0, lane: 0)])
            let st = GameEngine(chart: strictChart, laneCount: 4, windowScale: 0.6)
            st.press(lane: 0, at: 1.09)                     // 90 ms late: outside the strict window (81 ms)
            check(st.counts[Judgment.good.rawValue] + st.counts[Judgment.great.rawValue] + st.counts[Judgment.perfect.rawValue] == 0, "strict window rejects 90 ms")
            let wd = GameEngine(chart: strictChart, laneCount: 4, windowScale: 1.4)
            wd.press(lane: 0, at: 1.17)                     // 170 ms late: inside the wide window (189 ms)
            check(wd.counts[Judgment.miss.rawValue] == 0 && wd.judged == 1, "wide window accepts 170 ms")
            print("  varispeed latency: \(AudioManager.shared.varispeed.auAudioUnit.latency) s")
        }
        // Text chart format
        do {
            // The exact sketch from the request (fields on separate lines, trailing comments).
            let sketch = """
            B:120
            4,3 #keys and difficulty#
            4:4 #time signature#
            K2
            1,3.5 # measure and beat the note is in#
            1 #0 for no hold 1 for hold#
            1|L|2,2 #1 for slide note 0 for no slide note L for left and R for right slide#
            E:3,2 # end of hold in measures and beat#
            """
            if let song = try? ChartText.parse(sketch), let n = song.charts.first?.notes.first {
                check(song.keyCount == 4 && song.charts[0].level == 3, "sketch header (4 keys, level 3)")
                check(n.lane == 1 && abs(n.time - 1.25) < 1e-9, "sketch note lane 2 at 1,3.5 -> 1.25 s (\(n.time))")
                check(n.slides.count == 1 && n.slides[0].dir == -1 && abs(n.slides[0].time - 2.5) < 1e-9, "sketch slide left at 2,2 -> 2.5 s")
                check(abs(n.endTime - 4.5) < 1e-9, "sketch hold end 3,2 -> 4.5 s (\(n.endTime))")
            } else { check(false, "sketch parses") }
            // Round trip of every built-in song (notes, slides, effects, lessons).
            var allOK = true
            var bytesText = 0, bytesJSON = 0
            for song in songs {
                let txt = ChartText.write(song)
                guard let back = try? ChartText.parse(txt) else { print("  parse failed for \(song.title)"); allOK = false; continue }
                bytesText += txt.utf8.count
                bytesJSON += (try? JSONEncoder().encode(song).count) ?? 0
                for (a, b) in zip(song.charts, back.charts) {
                    let an = a.notes.sorted { ($0.time, $0.lane) < ($1.time, $1.lane) }, bn = b.notes
                    if an.count != bn.count || a.events.count != b.events.count || a.lessons.count != b.lessons.count { allOK = false; print("  count mismatch \(song.title) \(a.name)"); continue }
                    for (x, y) in zip(an, bn) {
                        if x.lane != y.lane || abs(x.time - y.time) > 0.001 || abs(x.duration - y.duration) > 0.001 || x.slides.count != y.slides.count
                            || zip(x.slides, y.slides).contains(where: { $0.dir != $1.dir || abs($0.time - $1.time) > 0.001 }) { allOK = false; print("  note mismatch \(song.title) \(a.name) @\(x.time)"); break }
                    }
                    for (x, y) in zip(a.events.sorted { $0.time < $1.time }, b.events) where x.kind != y.kind || abs(x.time - y.time) > 0.001 { allOK = false }
                }
                if back.keyCount != song.keyCount || abs(back.bpm - song.bpm) > 0.001 { allOK = false }
            }
            check(allOK, "text format round-trips every built-in song")
            print("  size: text \(bytesText / 1024) KB vs JSON \(bytesJSON / 1024) KB")
            // 3:4 and 6:8 time signatures
            if let s34 = try? ChartText.parse("B:120\n4,1\n3:4\nK1 2,1 0 0\nK2 1,3 0 0\n@3 6:8\nK3 3,4 0 0"), let ns = s34.charts.first?.notes {
                // 3:4 at 120 BPM: beat 3 of measure 1 = 2 quarters = 1.0 s; measure 2 beat 1 = 3 quarters = 1.5 s
                check(abs(ns[0].time - 1.0) < 1e-9 && abs(ns[1].time - 1.5) < 1e-9, "3:4 timing (\(ns.map(\.time)))")
                // measure 3 starts at 2 measures * 3 beats = 6 quarters; 6:8 beat 4 = +3 eighths = +1.5 quarters => 7.5 q = 3.75 s
                check(abs(ns[2].time - 3.75) < 1e-9, "6:8 after a signature change (\(ns[2].time))")
            } else { check(false, "time signatures parse") }
            // Helpful errors
            for (bad, expect) in [("4,3\n4:4\nK9 1,1 0 0", "K1"), ("4,3\nK1 1,1 1 0", "end"), ("4,3\nK1 1,1 1 1|X|2,1 E:3,1", "L or R"), ("4,3\nK1 1,1 1 1|L|5,1 E:3,1", "inside")] {
                do { _ = try ChartText.parse(bad); check(false, "error for “\(bad.replacingOccurrences(of: "\n", with: " / "))”") }
                catch { check(error.localizedDescription.contains(expect), "error mentions “\(expect)”: \(error.localizedDescription)") }
            }
        }
        // Anti-mash
        do {
            func eng(_ notes: [Note]) -> GameEngine { GameEngine(chart: Chart(name: "m", level: 1, notes: notes), laneCount: 4) }
            // Mashing every key for a single note: the right key is also a miss.
            var e = eng([Note(time: 1.0, lane: 1)])
            e.press(lane: 0, at: 1.000, pendingDown: 3)
            e.press(lane: 1, at: 1.002, pendingDown: 2)
            check(e.counts[Judgment.perfect.rawValue] == 0 && e.counts[Judgment.miss.rawValue] == 1, "mashed 4 keys for 1 note = miss \(e.counts)")
            // Staggered mash (no physical-state info): the third key within 50 ms is flagged.
            e = eng([Note(time: 1.0, lane: 3)])
            e.press(lane: 0, at: 1.000); e.press(lane: 1, at: 1.010); e.press(lane: 3, at: 1.020)
            check(e.counts[Judgment.miss.rawValue] == 1 && e.counts[Judgment.perfect.rawValue] == 0, "third key in 50 ms = miss \(e.counts)")
            // A real 2-note chord still scores.
            e = eng([Note(time: 2.0, lane: 0), Note(time: 2.0, lane: 3)])
            e.press(lane: 0, at: 2.000, pendingDown: 1); e.press(lane: 3, at: 2.003)
            check(e.counts[Judgment.perfect.rawValue] == 2, "2-note chord ok \(e.counts)")
            // A chart that really has a 3-note chord can be played.
            e = eng([Note(time: 2.0, lane: 0), Note(time: 2.0, lane: 1), Note(time: 2.0, lane: 3)])
            e.press(lane: 0, at: 2.000, pendingDown: 2); e.press(lane: 1, at: 2.002, pendingDown: 1); e.press(lane: 3, at: 2.004)
            check(e.counts[Judgment.perfect.rawValue] == 3, "3-note chord ok \(e.counts)")
            // Holding one key and hitting a 2-note chord with other fingers is fine.
            e = eng([Note(time: 1.0, lane: 0, duration: 3.0), Note(time: 2.0, lane: 2), Note(time: 2.0, lane: 3)])
            e.press(lane: 0, at: 1.0); e.update(now: 1.5)
            e.press(lane: 2, at: 2.0, pendingDown: 1); e.press(lane: 3, at: 2.002)
            check(e.counts[Judgment.perfect.rawValue] == 3, "hold + chord ok \(e.counts)")
            // Fast legit streams (95 ms apart) are not mashing.
            e = eng([Note(time: 3.0, lane: 0), Note(time: 3.095, lane: 1), Note(time: 3.19, lane: 2), Note(time: 3.285, lane: 3)])
            for (i, t) in [3.0, 3.095, 3.19, 3.285].enumerated() { e.press(lane: i, at: t) }
            check(e.counts[Judgment.perfect.rawValue] == 4, "fast stream ok \(e.counts)")
        }
        // Tutorial lessons must never stop (or slow) the song while a hold is being held.
        if let tut = songs.first(where: { $0.builtinKey == "first-steps" })?.charts.first {
            for L in tut.lessons {
                let from = L.time - 0.85, to = L.time + 0.05
                let clash = tut.notes.first { $0.isHold && $0.time <= to && $0.endTime >= from }
                check(clash == nil, "lesson '\(L.title)' @\(String(format: "%.2f", L.time)) clear of holds")
            }
            print("  tutorial: \(tut.lessons.count) lessons")
        }
        // Tempo detection against the rendered built-in tracks.
        for (key, bpm) in [("neon-drive", 128.0), ("hyperloop", 170.0), ("paper-lanterns", 88.0), ("glass-sunrise", 112.0)] {
            let url = BuiltinSongs.audioURL(for: BuiltinSongs.arrangement(forKey: key)!)
            if let an = try? Autocharter.analyze(url: url) {
                let notes = Autocharter.buildNotes(an, keyCount: 4, diff: .normal)
                print("  \(key): detected \(an.bpm) BPM (expected \(bpm)), offset \(String(format: "%.3f", an.offset)), \(an.onsets.count) onsets -> \(notes.count) notes")
                let ratio = an.bpm / bpm
                check(abs(ratio - 1) < 0.02 || abs(ratio - 2) < 0.04 || abs(ratio - 0.5) < 0.02, "\(key) tempo (or octave)")
            } else { print("  (no cached audio for \(key))") }
        }
        // .madim round trip
        let sem = DispatchSemaphore(value: 0)
        Task {
            defer { sem.signal() }
            guard let song = songs.first(where: { $0.builtinKey == "neon-drive" }), let audio = await BuiltinSongs.ensureAudio(key: "neon-drive") else { return }
            let dest = FileManager.default.temporaryDirectory.appendingPathComponent("selftest.madim")
            do {
                try await MadimPackage.export(song: song, audioSource: audio, to: dest)
                let back = try await MadimPackage.importPackage(at: dest)
                check(back.charts.count == song.charts.count && back.charts[1].notes.count == song.charts[1].notes.count, "madim round trip charts (\(back.charts.map { $0.notes.count }))")
                check(back.duration > 100 && back.title == song.title, "madim audio duration \(back.duration)")
                try? FileManager.default.removeItem(at: AppPaths.songDir(back.id))
            } catch { check(false, "madim round trip: \(error)") }
            let example = URL(fileURLWithPath: "/Users/user/Desktop/ManiDimExport-[chart name].Madim")
            if FileManager.default.fileExists(atPath: example.path) {
                do { _ = try await MadimPackage.importPackage(at: example); check(false, "empty template should not import") }
                catch { print("  ok   empty template rejected: \(error.localizedDescription)") }
            }
        }
        sem.wait()
        print(failed == 0 ? "ALL PASSED" : "\(failed) FAILED")
    }
}
