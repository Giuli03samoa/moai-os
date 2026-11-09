// MOAI OS — native macOS shell around the local web app (http://localhost:3000).
// Build: npm run desktop:build  (compiles with swiftc, installs ~/Applications/MOAI OS.app)
//
// The app is a single window with a WKWebView. It keeps the web app's own login (cookies live in
// the app's data store), opens external links in the default browser, saves downloads to
// ~/Downloads, supports file uploads, alert/confirm dialogs and printing (tech pack → PDF).
// If the local service is not answering it asks launchd to start it and waits.

import Cocoa
import WebKit

let APP_URL = URL(string: "http://localhost:3000/")!
let HEALTH_URL = URL(string: "http://localhost:3000/api/health")!
let SERVICE_LABEL = "it.moaiathletics.os.app"
let TITLEBAR_HEIGHT: CGFloat = 30

func isAppURL(_ url: URL?) -> Bool {
    guard let url = url, let host = url.host else { return false }
    return (host == "localhost" || host == "127.0.0.1") && url.port == 3000
}

/// Transparent strip over the top of the window: drags the window, double-click zooms.
final class DragStrip: NSView {
    override var mouseDownCanMoveWindow: Bool { true }
    override func mouseDown(with event: NSEvent) {
        if event.clickCount == 2 {
            let action = UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") ?? "Maximize"
            if action == "Minimize" { window?.miniaturize(nil) } else { window?.zoom(nil) }
            return
        }
        window?.performDrag(with: event)
    }
}

/// Native splash shown while the local service starts.
final class SplashView: NSView {
    let label = NSTextField(labelWithString: "Avvio di MOAI OS…")
    let detail = NSTextField(labelWithString: "")
    let spinner = NSProgressIndicator()
    let retry = NSButton(title: "Riprova", target: nil, action: nil)

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor(srgbRed: 34 / 255, green: 34 / 255, blue: 34 / 255, alpha: 1).cgColor
        let icon = NSImageView()
        if let url = Bundle.main.url(forResource: "monogram", withExtension: "png"), let img = NSImage(contentsOf: url) { icon.image = img }
        icon.imageScaling = .scaleProportionallyUpOrDown
        let cream = NSColor(srgbRed: 234 / 255, green: 231 / 255, blue: 231 / 255, alpha: 1)
        label.textColor = cream
        label.font = NSFont.systemFont(ofSize: 15, weight: .medium)
        detail.textColor = NSColor(srgbRed: 157 / 255, green: 162 / 255, blue: 179 / 255, alpha: 1)
        detail.font = NSFont.systemFont(ofSize: 12)
        detail.alignment = .center
        detail.maximumNumberOfLines = 3
        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.appearance = NSAppearance(named: .darkAqua)
        spinner.startAnimation(nil)
        retry.bezelStyle = .rounded
        retry.isHidden = true
        let stack = NSStackView(views: [icon, label, spinner, detail, retry])
        stack.orientation = .vertical
        stack.spacing = 14
        stack.alignment = .centerX
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            icon.widthAnchor.constraint(equalToConstant: 96),
            icon.heightAnchor.constraint(equalToConstant: 46),
            detail.widthAnchor.constraint(lessThanOrEqualToConstant: 380),
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
    }
    required init?(coder: NSCoder) { fatalError() }

    func showError(_ text: String) {
        spinner.stopAnimation(nil)
        spinner.isHidden = true
        label.stringValue = "MOAI OS non risponde"
        detail.stringValue = text
        retry.isHidden = false
    }
    func showWaiting(_ text: String) {
        spinner.isHidden = false
        spinner.startAnimation(nil)
        label.stringValue = "Avvio di MOAI OS…"
        detail.stringValue = text
        retry.isHidden = true
    }
}

final class MainWindowController: NSWindowController, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate {
    var webView: WKWebView!
    let splash = SplashView()
    var attempts = 0
    var loadedOnce = false
    var downloadPaths: [ObjectIdentifier: URL] = [:]

    convenience init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered, defer: false)
        window.title = "MOAI OS"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.minSize = NSSize(width: 960, height: 620)
        window.isReleasedWhenClosed = false
        window.backgroundColor = NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                ? NSColor(srgbRed: 25 / 255, green: 25 / 255, blue: 25 / 255, alpha: 1)
                : NSColor(srgbRed: 234 / 255, green: 231 / 255, blue: 231 / 255, alpha: 1)
        }
        self.init(window: window)
        window.delegate = self
        window.center()
        window.setFrameAutosaveName("MOAIOSMainWindow")
        build()
    }

    func build() {
        guard let content = window?.contentView else { return }
        let config = WKWebViewConfiguration()
        config.applicationNameForUserAgent = "Version/26.0 Safari/605.1.15 MOAIOSDesktop/1.0"
        config.websiteDataStore = .default()
        config.preferences.isElementFullscreenEnabled = true
        let printShim = WKUserScript(source: "window.print = function(){ window.webkit.messageHandlers.moai.postMessage({type:'print'}); };", injectionTime: .atDocumentStart, forMainFrameOnly: true)
        config.userContentController.addUserScript(printShim)
        config.userContentController.add(self, name: "moai")

        webView = WKWebView(frame: content.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.allowsMagnification = true
        webView.setValue(false, forKey: "drawsBackground")
        if #available(macOS 13.3, *) { webView.isInspectable = true }
        content.addSubview(webView)

        let strip = DragStrip(frame: NSRect(x: 0, y: content.bounds.height - TITLEBAR_HEIGHT, width: content.bounds.width, height: TITLEBAR_HEIGHT))
        strip.autoresizingMask = [.width, .minYMargin]
        content.addSubview(strip)

        splash.frame = content.bounds
        splash.autoresizingMask = [.width, .height]
        splash.retry.target = self
        splash.retry.action = #selector(retryNow)
        content.addSubview(splash, positioned: .below, relativeTo: strip)

        connect()
    }

    // MARK: service startup

    @objc func retryNow() {
        attempts = 0
        splash.showWaiting("")
        connect()
    }

    func connect() {
        var req = URLRequest(url: HEALTH_URL)
        req.timeoutInterval = 3
        URLSession.shared.dataTask(with: req) { [weak self] _, resp, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if let http = resp as? HTTPURLResponse, http.statusCode < 500 {
                    self.webView.load(URLRequest(url: APP_URL))
                } else {
                    self.attempts += 1
                    if self.attempts == 1 { self.kickstartService() }
                    if self.attempts > 90 {
                        self.splash.showError("Il servizio locale non si è avviato. Controlla che il Mac non sia in risparmio energetico e riprova; se persiste, dal Terminale: npm run service:status nella cartella di MOAI OS.")
                        return
                    }
                    self.splash.showWaiting(self.attempts > 3 ? "Il servizio si sta avviando (la prima volta dopo un aggiornamento può servire qualche minuto)." : "")
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.connect() }
                }
            }
        }.resume()
    }

    func kickstartService() {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        p.arguments = ["kickstart", "gui/\(getuid())/\(SERVICE_LABEL)"]
        try? p.run()
    }

    // MARK: navigation

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        if url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" { return decisionHandler(.allow) }
        if isAppURL(url) {
            return decisionHandler(action.shouldPerformDownload ? .download : .allow)
        }
        if action.targetFrame?.isMainFrame == false { return decisionHandler(.allow) }
        NSWorkspace.shared.open(url)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if let http = response.response as? HTTPURLResponse,
           let disp = http.value(forHTTPHeaderField: "Content-Disposition"), disp.lowercased().hasPrefix("attachment") {
            return decisionHandler(.download)
        }
        decisionHandler(response.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if !loadedOnce {
            loadedOnce = true
            NSAnimationContext.runAnimationGroup({ ctx in
                ctx.duration = 0.25
                splash.animator().alphaValue = 0
            }, completionHandler: { self.splash.isHidden = true })
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let code = (error as NSError).code
        if code == NSURLErrorCancelled || code == 102 /* frame load interrupted (download) */ { return }
        splash.isHidden = false
        splash.alphaValue = 1
        loadedOnce = false
        attempts = 0
        splash.showWaiting("Riconnessione al servizio locale…")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { self.connect() }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

    // target=_blank and window.open
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url {
            if isAppURL(url) { webView.load(action.request) } else { NSWorkspace.shared.open(url) }
        }
        return nil
    }

    // MARK: dialogs, uploads, printing

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert(); a.messageText = "MOAI OS"; a.informativeText = message; a.addButton(withTitle: "OK")
        a.beginSheetModal(for: window!) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert(); a.messageText = "MOAI OS"; a.informativeText = message
        a.addButton(withTitle: "Conferma"); a.addButton(withTitle: "Annulla")
        a.beginSheetModal(for: window!) { r in completionHandler(r == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        panel.beginSheetModal(for: window!) { r in completionHandler(r == .OK ? panel.urls : nil) }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], body["type"] as? String == "print" else { return }
        printPage()
    }

    @objc func printPage() {
        let info = NSPrintInfo.shared.copy() as! NSPrintInfo
        info.topMargin = 24; info.bottomMargin = 24; info.leftMargin = 24; info.rightMargin = 24
        info.horizontalPagination = .fit
        info.verticalPagination = .automatic
        let op = webView.printOperation(with: info)
        op.view?.frame = webView.bounds
        op.runModal(for: window!, delegate: nil, didRun: nil, contextInfo: nil)
    }

    // MARK: downloads → ~/Downloads

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let dir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first!
        var dest = dir.appendingPathComponent(suggestedFilename)
        let base = dest.deletingPathExtension().lastPathComponent, ext = dest.pathExtension
        var n = 1
        while FileManager.default.fileExists(atPath: dest.path) {
            dest = dir.appendingPathComponent(ext.isEmpty ? "\(base) (\(n))" : "\(base) (\(n)).\(ext)")
            n += 1
        }
        downloadPaths[ObjectIdentifier(download)] = dest
        completionHandler(dest)
    }

    func downloadDidFinish(_ download: WKDownload) {
        if let url = downloadPaths.removeValue(forKey: ObjectIdentifier(download)) {
            NSWorkspace.shared.activateFileViewerSelecting([url])
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloadPaths.removeValue(forKey: ObjectIdentifier(download))
        let a = NSAlert(); a.messageText = "Download non riuscito"; a.informativeText = error.localizedDescription
        a.beginSheetModal(for: window!, completionHandler: nil)
    }

    // MARK: window

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        sender.orderOut(nil) // keep the page alive; the Dock icon brings it back
        return false
    }

    @objc func reload() { if loadedOnce { webView.reload() } else { retryNow() } }
    @objc func goHome() { webView.load(URLRequest(url: APP_URL)) }
    @objc func goBack() { webView.goBack() }
    @objc func goForward() { webView.goForward() }
    @objc func zoomIn() { webView.pageZoom = min(webView.pageZoom + 0.1, 2.0) }
    @objc func zoomOut() { webView.pageZoom = max(webView.pageZoom - 0.1, 0.6) }
    @objc func zoomReset() { webView.pageZoom = 1.0 }
    @objc func openInBrowser() { NSWorkspace.shared.open(webView.url ?? APP_URL) }
    @objc func sendKey(_ sender: NSMenuItem) {
        // forwards ⌘K / ⌘J to the page's own shortcuts
        guard let key = sender.representedObject as? String else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new KeyboardEvent('keydown',{key:'\(key)',metaKey:true}))")
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    var controller: MainWindowController!

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()
        controller = MainWindowController()
        controller.showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        controller.window?.makeKeyAndOrderFront(nil)
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func buildMenu() {
        let main = NSMenu()
        func item(_ title: String, _ action: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = [.command], target: AnyObject? = nil) -> NSMenuItem {
            let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
            i.keyEquivalentModifierMask = mods
            i.target = target
            return i
        }
        func submenu(_ title: String, _ items: [NSMenuItem]) {
            let m = NSMenu(title: title)
            items.forEach { m.addItem($0) }
            let top = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            top.submenu = m
            main.addItem(top)
        }
        submenu("MOAI OS", [
            item("Informazioni su MOAI OS", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), ""),
            .separator(),
            item("Nascondi MOAI OS", #selector(NSApplication.hide(_:)), "h"),
            item("Nascondi altre", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            item("Mostra tutte", #selector(NSApplication.unhideAllApplications(_:)), ""),
            .separator(),
            item("Esci da MOAI OS", #selector(NSApplication.terminate(_:)), "q"),
        ])
        submenu("Archivio", [
            item("Stampa…", #selector(MainWindowController.printPage), "p", target: nil),
            item("Apri nel browser", #selector(MainWindowController.openInBrowser), "o", [.command, .shift], target: nil),
            .separator(),
            item("Chiudi finestra", #selector(NSWindow.performClose(_:)), "w"),
        ])
        submenu("Modifica", [
            item("Annulla", Selector(("undo:")), "z"),
            item("Ripeti", Selector(("redo:")), "z", [.command, .shift]),
            .separator(),
            item("Taglia", #selector(NSText.cut(_:)), "x"),
            item("Copia", #selector(NSText.copy(_:)), "c"),
            item("Incolla", #selector(NSText.paste(_:)), "v"),
            item("Seleziona tutto", #selector(NSText.selectAll(_:)), "a"),
        ])
        let search = item("Cerca o chiedi…", #selector(MainWindowController.sendKey(_:)), "k", target: nil); search.representedObject = "k"
        let assistant = item("Assistente", #selector(MainWindowController.sendKey(_:)), "j", target: nil); assistant.representedObject = "j"
        submenu("Vai", [
            item("Panoramica", #selector(MainWindowController.goHome), "h", [.command, .shift], target: nil),
            search,
            assistant,
            .separator(),
            item("Indietro", #selector(MainWindowController.goBack), "[", target: nil),
            item("Avanti", #selector(MainWindowController.goForward), "]", target: nil),
        ])
        submenu("Vista", [
            item("Ricarica", #selector(MainWindowController.reload), "r", target: nil),
            .separator(),
            item("Ingrandisci", #selector(MainWindowController.zoomIn), "+", target: nil),
            item("Riduci", #selector(MainWindowController.zoomOut), "-", target: nil),
            item("Dimensioni reali", #selector(MainWindowController.zoomReset), "0", target: nil),
            .separator(),
            item("Schermo intero", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
        ])
        submenu("Finestra", [
            item("Contrai", #selector(NSWindow.performMiniaturize(_:)), "m"),
            item("Ridimensiona", #selector(NSWindow.performZoom(_:)), ""),
        ])
        NSApp.mainMenu = main
    }
}

@main
struct MOAIOSApp {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }
}
