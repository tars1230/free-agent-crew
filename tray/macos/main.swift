import AppKit

// CrewQuota: native macOS menu bar for `crew quota --json` (free-agent-crew). No third-party software; built with swiftc.

let home = FileManager.default.homeDirectoryForCurrentUser.path
let env0 = ProcessInfo.processInfo.environment
let crewHome = env0["CREW_HOME"] ?? "\(home)/.free-agent-crew"
// tray.json (written by `crew tray install`): {"node": "/abs/node", "entry": "/abs/crew.js"}
let trayCfg: [String: String] = {
    guard let d = FileManager.default.contents(atPath: "\(crewHome)/tray/tray.json"),
          let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return [:] }
    return o.compactMapValues { $0 as? String }
}()
let nodeBin = env0["CREW_NODE"] ?? trayCfg["node"] ?? "/usr/local/bin/node"
let crewEntry = env0["CREW_ENTRY"] ?? trayCfg["entry"] ?? "\(crewHome)/app/bin/crew.js"
let agentOrder = ["cline", "kilo", "opencode"]
let refreshSeconds: TimeInterval = 60
let timeoutSeconds: TimeInterval = 30

func s(_ v: Any?) -> String? {
    if let x = v as? String { return x }
    if let x = v as? NSNumber { return x.stringValue }
    return nil
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    var agents: [String: [String: Any]] = [:]
    var lastError: String? = "尚未读取"
    var generatedAt = ""
    var running = false
    let queue = DispatchQueue(label: "freequota.fetch", qos: .utility)

    func applicationDidFinishLaunching(_ n: Notification) {
        render()
        refresh()
        let t = Timer(timeInterval: refreshSeconds, repeats: true) { [weak self] _ in self?.refresh() }
        t.tolerance = 10
        RunLoop.main.add(t, forMode: .common)
    }

    @objc func refresh() {
        if running { return }
        running = true
        queue.async {
            let (data, err) = Self.fetch()
            var parsed: [String: [String: Any]] = [:]
            var gen = ""
            var error = err
            if error == nil, let data = data {
                if let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                   let list = obj["agents"] as? [[String: Any]] {
                    for a in list { if let name = a["agent"] as? String { parsed[name] = a } }
                    gen = s(obj["generated_at"]) ?? ""
                } else { error = "JSON 解析失败" }
            }
            DispatchQueue.main.async {
                self.running = false
                self.lastError = error
                self.agents = error == nil ? parsed : [:]
                self.generatedAt = gen
                self.render()
            }
        }
    }

    static func fetch() -> (Data?, String?) {
        guard FileManager.default.isExecutableFile(atPath: nodeBin) else { return (nil, "找不到 node: \(nodeBin)") }
        guard FileManager.default.fileExists(atPath: crewEntry) else { return (nil, "找不到 \(crewEntry)") }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: nodeBin)
        p.arguments = [crewEntry, "quota", "--json"]
        var env = ProcessInfo.processInfo.environment
        // launchd gives GUI apps a bare PATH; use the PATH recorded at install time so installed CLIs are found
        let nodeDir = (nodeBin as NSString).deletingLastPathComponent
        env["PATH"] = [nodeDir, trayCfg["path"] ?? "", env["PATH"] ?? "", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"].filter { !$0.isEmpty }.joined(separator: ":")
        p.environment = env
        let out = Pipe()
        p.standardOutput = out
        p.standardError = FileHandle.nullDevice
        p.standardInput = FileHandle.nullDevice
        do { try p.run() } catch { return (nil, "启动失败: \(error.localizedDescription)") }
        let killer = DispatchWorkItem { if p.isRunning { p.terminate() } }
        DispatchQueue.global().asyncAfter(deadline: .now() + timeoutSeconds, execute: killer)
        let data = out.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        killer.cancel()
        if p.terminationReason == .uncaughtSignal { return (nil, "超时/被终止") }
        if p.terminationStatus != 0 { return (nil, "退出码 \(p.terminationStatus)") }
        return (data, nil)
    }

    func color(_ status: String?) -> NSColor {
        switch status {
        case "green": return .systemGreen
        case "yellow": return .systemYellow
        case "red": return .systemRed
        default: return .systemGray
        }
    }

    func render() {
        let title = NSMutableAttributedString()
        let font = NSFont.menuBarFont(ofSize: 0)
        for (i, name) in agentOrder.enumerated() {
            if i > 0 { title.append(NSAttributedString(string: " ", attributes: [.font: font])) }
            let st = s(agents[name]?["status"])
            title.append(NSAttributedString(string: "●", attributes: [.font: font, .foregroundColor: color(st)]))
        }
        item.button?.attributedTitle = title
        item.button?.toolTip = "free-agent-crew 免费额度 cline / kilo / opencode"

        let menu = NSMenu()
        if let e = lastError { menu.addItem(disabled("⚠️ 读取失败: \(e)")) }
        for name in agentOrder {
            menu.addItem(.separator())
            guard let a = agents[name] else { menu.addItem(disabled("● \(name): 没有数据")); continue }
            let h = NSMenuItem(title: "● \(name)", action: nil, keyEquivalent: "")
            h.attributedTitle = NSAttributedString(string: "● \(name)", attributes: [.foregroundColor: color(s(a["status"])), .font: NSFont.boldSystemFont(ofSize: 13)])
            menu.addItem(h)
            let calls = s(a["calls_today"]) ?? "0"
            var rate = "—"
            if let r = a["success_rate"] as? NSNumber { let v = r.doubleValue; rate = String(format: "%.0f%%", v <= 1 ? v * 100 : v) }
            menu.addItem(disabled("  今日调用 \(calls) · 成功率 \(rate)"))
            if let m = s(a["preferred_model"]) { menu.addItem(disabled("  首选: \(m)")) }
            for r in (a["degraded_reasons"] as? [Any] ?? []) { if let r = s(r) { menu.addItem(disabled("  降级: \(r)")) } }
            for r in (a["notes"] as? [Any] ?? []) { if let r = s(r) { menu.addItem(disabled("  信息: \(r)")) } }
            let minS: String = { if let n = a["min_score"] as? NSNumber { return String(format: "%g", n.doubleValue) }; return "?" }()
            let gxN = s(a["gate_excluded_count"]) ?? String((a["gate_excluded"] as? [Any])?.count ?? 0)
            let pvN = s(a["provisional_count"]) ?? String((a["provisional"] as? [Any])?.count ?? 0)
            menu.addItem(disabled("  门槛: 最低分 \(minS) · 排除 \(gxN) · 试用期 \(pvN) · 无结束记录 \(s(a["unknown_today"]) ?? "0")"))
            for c in (a["cooling"] as? [[String: Any]] ?? []) {
                menu.addItem(disabled("  冷却: \(s(c["model"]) ?? "?") → \(s(c["reset_at"]) ?? "?") 恢复"))
            }
            if let note = s(a["hour_note"]) { menu.addItem(disabled("  \(note)")) }
            else if let used = s(a["hour_used"]) { menu.addItem(disabled("  本小时调用 \(used) 次（限额 \(s(a["hour_limit"]) ?? "?") 次请求/小时·IP）")) }
            if let f = a["last_failure"] as? [String: Any] {
                menu.addItem(disabled("  最近失败: \(s(f["time"]) ?? "") \(s(f["reason"]) ?? "") \(s(f["model"]) ?? "")"))
            }
            if let log = s(a["log"]) {
                let li = NSMenuItem(title: "  打开日志", action: #selector(openLog(_:)), keyEquivalent: "")
                li.target = self; li.representedObject = log
                menu.addItem(li)
            }
        }
        menu.addItem(.separator())
        if !generatedAt.isEmpty { menu.addItem(disabled("更新于 \(generatedAt)")) }
        let r = NSMenuItem(title: "立即刷新", action: #selector(refresh), keyEquivalent: "r"); r.target = self
        menu.addItem(r)
        let q = NSMenuItem(title: "退出", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(q)
        item.menu = menu
    }

    func disabled(_ t: String) -> NSMenuItem {
        let m = NSMenuItem(title: t, action: nil, keyEquivalent: ""); m.isEnabled = false; return m
    }

    @objc func openLog(_ sender: NSMenuItem) {
        guard let p = sender.representedObject as? String else { return }
        NSWorkspace.shared.open(URL(fileURLWithPath: p))
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
