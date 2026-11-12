import SwiftUI
import AppKit
import WebKit
import UniformTypeIdentifiers

// macOS port of the iOS WebStudyView bridge. Self-contained: all types are Mac-prefixed.
// Sandbox note (owned by app target, not this file): needs network.client and
// files.user-selected.read-write entitlements for NSSavePanel/NSOpenPanel.

private enum MacExportPolicy {
    static let limit = 25 * 1024 * 1024
    static let home = URL(string: "https://orunvoca.co.kr/")!
    static func trusted(_ url: URL?) -> Bool {
        guard let url else { return false }
        return url.scheme == "https" && url.host == "orunvoca.co.kr" && (url.port == nil || url.port == 443) && url.user == nil && url.password == nil
    }
    static let types: [String: Set<String>] = [
        "pdf": ["application/pdf"],
        "xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
        "docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
        "png": ["image/png"], "zip": ["application/zip", "application/x-zip-compressed"],
        "csv": ["text/csv", "application/csv"],
        "xls": ["application/vnd.ms-excel"]
    ]
    static func filename(_ raw: String, mime: String) -> String? {
        let mime = mime.lowercased().split(separator: ";").first.map(String.init) ?? ""
        let basename = raw.replacingOccurrences(of: "\\", with: "/").components(separatedBy: "/").last ?? "export"
        let ext = (basename as NSString).pathExtension.lowercased()
        guard let accepted = types[ext], accepted.contains(mime) || mime == "application/octet-stream" || mime.isEmpty else { return nil }
        let stem = (basename as NSString).deletingPathExtension
        let bad = CharacterSet(charactersIn: "/\\:<>\"|?*\u{202A}\u{202B}\u{202D}\u{202E}\u{202C}\u{2066}\u{2067}\u{2068}\u{2069}")
        let safe = String(String.UnicodeScalarView(stem.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) && !bad.contains($0) }.prefix(100))).trimmingCharacters(in: CharacterSet(charactersIn: ". "))
        return (safe.isEmpty ? "export" : safe) + "." + ext
    }
    static func validHeader(_ data: Data, ext: String) -> Bool {
        let b = [UInt8](data.prefix(8))
        switch ext {
        case "pdf": return b.starts(with: [0x25,0x50,0x44,0x46,0x2D])
        case "docx", "xlsx", "zip": return b.starts(with: [0x50,0x4B,0x03,0x04]) || b.starts(with: [0x50,0x4B,0x05,0x06])
        case "png": return b == [137,80,78,71,13,10,26,10]
        case "xls": return b == [208,207,17,224,161,177,26,225] || b.starts(with: [0x50,0x4B,0x03,0x04])
        case "csv": return String(data: data, encoding: .utf8) != nil && !data.contains(0)
        default: return false
        }
    }
}

private final class MacExportMessageProxy: NSObject, WKScriptMessageHandlerWithReply {
    weak var owner: MacWebSession?
    @MainActor func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let owner else { replyHandler(nil, "Export unavailable"); return }
        owner.receiveExport(message, reply: replyHandler)
    }
}

private let macExportScript = #"""
(() => {
  if (window !== window.top || location.origin !== 'https://orunvoca.co.kr') return;
  const handler = window.webkit.messageHandlers.orunExport;
  const max = 25 * 1024 * 1024;
  const blobs = new Map();
  const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = function(blob) { const u = create(blob); if (blob instanceof Blob) blobs.set(u, blob); return u; };
  URL.revokeObjectURL = function(u) { blobs.delete(u); return revoke(u); };
  let gesture = 0, busy = false;
  for (const type of ['pointerdown', 'keydown', 'click']) document.addEventListener(type, e => {
    if (!e.isTrusted) return;
    gesture = Date.now();
    handler.postMessage({op:'gesture'}).catch(() => {});
  }, true);
  const report = () => handler.postMessage({op:'error'}).catch(() => {});
  window.print = function() {
    if (Date.now() - gesture > 120000 || document.documentElement.outerHTML.length > max) { report(); return; }
    handler.postMessage({op:'print'}).catch(report);
  };
  async function send(href, name, heldBlob) {
    if (busy) { report(); return; }
    busy = true;
    try {
      if (Date.now() - gesture > 120000) throw Error('User action required');
      // No native or JS arbitrary URL fetch. Only this document's blob URLs and bounded data URLs.
      if (href.startsWith('blob:') && !href.startsWith('blob:https://orunvoca.co.kr/')) throw Error('Origin');
      if (href.startsWith('data:') && href.length > Math.ceil(max * 4 / 3) + 1024) throw Error('Size');
      const blob = heldBlob || await (await fetch(href)).blob();
      if (!blob.size || blob.size > max) throw Error('Size');
      await handler.postMessage({op:'begin', name, mime:blob.type, size:blob.size});
      for (let offset = 0; offset < blob.size; offset += 196608) {
        const bytes = new Uint8Array(await blob.slice(offset, offset + 196608).arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        await handler.postMessage({op:'chunk', data:btoa(binary)});
      }
      await handler.postMessage({op:'end'});
    } catch (_) { report(); }
    finally { busy = false; }
  }
  window.saveAs = function(blob, name) {
    if (blob instanceof Blob) { void send('', name || blob.name || 'export', blob); return; }
    if (typeof blob === 'string') {
      const a = document.createElement('a'); a.href = blob; a.download = name || 'export'; a.click();
    }
  };
  function intercept(a, event) {
    if (!(a instanceof HTMLAnchorElement) || !a.hasAttribute('download')) return false;
    const href = a.href;
    if (!href.startsWith('blob:') && !href.startsWith('data:')) return false;
    if (event) { event.preventDefault(); event.stopImmediatePropagation(); }
    // Capture synchronously before callers revokeObjectURL immediately after click().
    void send(href, a.download || 'export', blobs.get(href));
    return true;
  }
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function() { if (!intercept(this)) return click.call(this); };
  const dispatch = HTMLAnchorElement.prototype.dispatchEvent;
  HTMLAnchorElement.prototype.dispatchEvent = function(e) { if (e.type === 'click' && intercept(this, e)) return false; return dispatch.call(this, e); };
  document.addEventListener('click', e => { const a = e.target instanceof Element ? e.target.closest('a') : null; intercept(a, e); }, true);
})();
"""#

private let macPopupPrintScript = "window.print = function() { if (document.documentElement.outerHTML.length > 26214400) { window.webkit.messageHandlers.orunExport.postMessage({op:'error'}).catch(function() {}); return; } window.webkit.messageHandlers.orunExport.postMessage({op:'print'}).catch(function() {}); }; window.close = function() {};"

@MainActor final class MacWebSession: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    @Published var failure: String?
    @Published var loading = true
    @Published var progress: Double = 0
    @Published var canGoBack = false
    @Published var canGoForward = false
    @Published var exporting = false
    @Published var exportError: String?
    @Published var notice: String?

    let webView: WKWebView
    private let proxy = MacExportMessageProxy()
    private var observers: [NSKeyValueObservation] = []

    private var lastTrustedGesture: Date?
    private var hasRecentTrustedGesture: Bool {
        guard let d = lastTrustedGesture else { return false }
        let age = Date().timeIntervalSince(d); return age >= 0 && age < 120
    }
    private var printPopup: WKWebView?
    private var popupCreatedAt: Date?
    private var popupTimeout: Timer?
    private var printing = false

    private var exportDirectory: URL?
    private var exportDestination: URL?
    private var exportBytes = Data()
    private var expectedBytes = 0
    private var saving = false
    private var activeDownload: WKDownload?
    private var downloadProgress: NSKeyValueObservation?
    private var exportTimeout: Timer?

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        proxy.owner = self
        configuration.userContentController.addScriptMessageHandler(proxy, contentWorld: .page, name: "orunExport")
        configuration.userContentController.addUserScript(WKUserScript(source: macExportScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.isInspectable = false
        observers = [
            webView.observe(\.estimatedProgress, options: [.new]) { [weak self] w, _ in let v = w.estimatedProgress; Task { @MainActor in self?.progress = v } },
            webView.observe(\.canGoBack, options: [.new]) { [weak self] w, _ in let v = w.canGoBack; Task { @MainActor in self?.canGoBack = v } },
            webView.observe(\.canGoForward, options: [.new]) { [weak self] w, _ in let v = w.canGoForward; Task { @MainActor in self?.canGoForward = v } }
        ]
        load()
    }

    // MARK: toolbar actions
    func load() {
        cancelExport()
        failure = nil; loading = true; progress = 0
        webView.load(URLRequest(url: MacExportPolicy.home))
    }
    func reload() {
        if failure != nil || !MacExportPolicy.trusted(webView.url) { load(); return }
        cancelExport(); failure = nil; loading = true
        webView.reload()
    }
    func goBack() { if webView.canGoBack { webView.goBack() } }
    func goForward() { if webView.canGoForward { webView.goForward() } }
    func openInBrowser() {
        let url = MacExportPolicy.trusted(webView.url) ? webView.url! : MacExportPolicy.home
        NSWorkspace.shared.open(url)
    }
    /// Cmd-P: user-initiated menu/keyboard command, prints only the trusted main web view.
    func printCurrentPage() {
        guard MacExportPolicy.trusted(webView.url), failure == nil else { NSSound.beep(); return }
        startPrint(webView)
    }

    // MARK: navigation
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { if webView === self.webView { loading = false } }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { if webView === self.webView { fail(error) } }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { if webView === self.webView { fail(error) } }
    private func fail(_ error: Error) {
        let e = error as NSError
        guard e.code != NSURLErrorCancelled, !(e.domain == "WebKitErrorDomain" && e.code == 102) else { return }
        loading = false
        failure = "학습 화면을 열지 못했어요. 인터넷 연결을 확인한 후 다시 시도해 주세요. 오프라인 단어장은 계속 사용할 수 있어요."
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        cancelExport(); loading = false
        failure = "학습 화면이 종료되었어요. 다시 열어 주세요."
    }
    private func trustedFrame(_ frame: WKFrameInfo) -> Bool {
        frame.isMainFrame && frame.securityOrigin.protocol == "https" && frame.securityOrigin.host == "orunvoca.co.kr" && [0, 443].contains(frame.securityOrigin.port) && MacExportPolicy.trusted(webView.url)
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if webView === printPopup {
            decisionHandler(url.absoluteString == "about:blank" ? .allow : .cancel); return
        }
        if action.targetFrame == nil {
            guard webView === self.webView, trustedFrame(action.sourceFrame), hasRecentTrustedGesture else { decisionHandler(.cancel); return }
        }
        if MacExportPolicy.trusted(url) {
            if action.shouldPerformDownload {
                guard trustedFrame(action.sourceFrame) else { decisionHandler(.cancel); return }
                decisionHandler(.download)
            } else { decisionHandler(.allow) }
            return
        }
        if url.absoluteString == "about:blank" { decisionHandler(.allow); return }
        if action.targetFrame?.isMainFrame == false { decisionHandler(.allow); return }
        // Off-site links leave the app only for a real user click, via the default browser.
        if action.navigationType == .linkActivated || hasRecentTrustedGesture {
            openExternally(url)
        }
        decisionHandler(.cancel)
    }
    private func openExternally(_ url: URL) {
        switch url.scheme?.lowercased() ?? "" {
        case "https", "http", "mailto", "tel": NSWorkspace.shared.open(url)
        default: break
        }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard webView === self.webView, trustedFrame(action.sourceFrame), hasRecentTrustedGesture else { return nil }
        if action.request.url?.absoluteString == "about:blank", printPopup == nil, !printing, !exporting, !saving {
            let content = WKUserContentController()
            content.addScriptMessageHandler(proxy, contentWorld: .page, name: "orunExport")
            content.addUserScript(WKUserScript(source: macPopupPrintScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
            configuration.userContentController = content
            let popup = WKWebView(frame: CGRect(x: 0, y: 0, width: 794, height: 1123), configuration: configuration)
            popup.navigationDelegate = self; popup.uiDelegate = self
            printPopup = popup; popupCreatedAt = Date()
            popupTimeout?.invalidate()
            popupTimeout = Timer.scheduledTimer(withTimeInterval: 120, repeats: false) { [weak self] _ in
                Task { @MainActor in guard let self, !self.printing else { return }; self.finishPrinting() }
            }
            return popup
        }
        if let url = action.request.url, MacExportPolicy.trusted(url) { webView.load(action.request) }
        else if let url = action.request.url { openExternally(url) }
        return nil
    }
    func webViewDidClose(_ webView: WKWebView) {}

    // MARK: JS dialogs / file input (trusted main frame only)
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        guard webView === self.webView, trustedFrame(frame) else { completionHandler(); return }
        let alert = NSAlert(); alert.messageText = String(message.prefix(1000)); alert.addButton(withTitle: "확인")
        alert.runModal(); completionHandler()
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard webView === self.webView, trustedFrame(frame) else { completionHandler(false); return }
        let alert = NSAlert(); alert.messageText = String(message.prefix(1000))
        alert.addButton(withTitle: "확인"); alert.addButton(withTitle: "취소")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        guard webView === self.webView, trustedFrame(frame), hasRecentTrustedGesture else { completionHandler(nil); return }
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = false; panel.canChooseFiles = true
        panel.begin { response in completionHandler(response == .OK ? panel.urls : nil) }
    }

    // MARK: printing
    func finishPrinting() {
        popupTimeout?.invalidate(); popupTimeout = nil
        printPopup?.stopLoading(); printPopup = nil; popupCreatedAt = nil
        printing = false
    }
    private func startPrint(_ source: WKWebView) {
        guard !printing, !exporting, !saving else { return }
        guard let window = webView.window ?? NSApp.keyWindow else { exportError = "인쇄 창을 열지 못했어요. 잠시 후 다시 시도해 주세요."; finishPrinting(); return }
        let info = NSPrintInfo.shared.copy() as! NSPrintInfo
        info.horizontalPagination = .fit; info.verticalPagination = .automatic
        info.isHorizontallyCentered = true; info.isVerticallyCentered = false
        let operation = source.printOperation(with: info)
        operation.jobTitle = String((source.title ?? "옳은VOCA").prefix(100))
        operation.showsPrintPanel = true; operation.showsProgressPanel = true
        if source !== webView { operation.view?.frame = NSRect(x: 0, y: 0, width: 794, height: 1123) }
        printing = true
        operation.runModal(for: window, delegate: self, didRun: #selector(printOperationDidRun(_:success:contextInfo:)), contextInfo: nil)
    }
    @objc func printOperationDidRun(_ operation: NSPrintOperation, success: Bool, contextInfo: UnsafeMutableRawPointer?) {
        let wasPopup = printPopup != nil
        printing = false
        if wasPopup { finishPrinting() }
    }

    // MARK: export
    func cancelExport() {
        finishPrinting()
        lastTrustedGesture = nil
        exportTimeout?.invalidate(); exportTimeout = nil
        downloadProgress = nil
        activeDownload?.cancel { _ in }; activeDownload = nil
        exportBytes = Data(); expectedBytes = 0; exporting = false
        if let d = exportDirectory { try? FileManager.default.removeItem(at: d) }
        exportDirectory = nil; exportDestination = nil
    }
    private func exportFailed() {
        guard !saving else { return }
        cancelExport()
        exportError = "파일을 내보내지 못했어요. PDF, Excel, Word, PNG, ZIP, CSV 파일(최대 25MB)만 지원해요. 연결과 파일 크기를 확인하고 다시 시도해 주세요."
    }
    private func beginExport(name: String, mime: String) throws -> URL {
        guard !exporting, !saving, !printing, let safeName = MacExportPolicy.filename(name, mime: mime) else { throw CocoaError(.fileWriteInvalidFileName) }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("OrunExport-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        exportDirectory = dir
        let dest = dir.appendingPathComponent(safeName, isDirectory: false)
        exportDestination = dest; exporting = true
        exportTimeout = Timer.scheduledTimer(withTimeInterval: 120, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.exportFailed() }
        }
        return dest
    }
    /// Validates size + magic bytes of the staged temp file, then asks the user where to save it.
    private func completeExport() throws {
        guard let dest = exportDestination else { throw CocoaError(.fileNoSuchFile) }
        let attrs = try FileManager.default.attributesOfItem(atPath: dest.path)
        guard (attrs[.type] as? FileAttributeType) == .typeRegular else { throw CocoaError(.fileReadCorruptFile) }
        let count = (attrs[.size] as? NSNumber)?.intValue ?? 0
        guard count > 0, count <= MacExportPolicy.limit else { throw CocoaError(.fileReadTooLarge) }
        let handle = try FileHandle(forReadingFrom: dest)
        defer { try? handle.close() }
        let ext = dest.pathExtension
        let header = try handle.read(upToCount: ext == "csv" ? MacExportPolicy.limit : 8) ?? Data()
        guard MacExportPolicy.validHeader(header, ext: ext) else { throw CocoaError(.fileReadCorruptFile) }
        exportTimeout?.invalidate(); exportTimeout = nil; downloadProgress = nil; activeDownload = nil
        exportBytes = Data(); expectedBytes = 0; exporting = false; loading = false
        presentSavePanel(staged: dest)
    }
    private func presentSavePanel(staged: URL) {
        saving = true
        let panel = NSSavePanel()
        panel.nameFieldStringValue = staged.lastPathComponent
        if let type = UTType(filenameExtension: staged.pathExtension) { panel.allowedContentTypes = [type] }
        panel.allowsOtherFileTypes = false
        panel.canCreateDirectories = true
        panel.isExtensionHidden = false
        let handler: (NSApplication.ModalResponse) -> Void = { [weak self] response in
            guard let self else { return }
            var failed = false
            if response == .OK, let target = panel.url {
                // NSSavePanel already asked the user to confirm any overwrite.
                do {
                    guard target.pathExtension.lowercased() == staged.pathExtension.lowercased() else { throw CocoaError(.fileWriteInvalidFileName) }
                    if FileManager.default.fileExists(atPath: target.path) {
                        _ = try FileManager.default.replaceItemAt(target, withItemAt: staged)
                    } else { try FileManager.default.copyItem(at: staged, to: target) }
                    self.notice = "\(target.lastPathComponent) 저장 완료"
                } catch { failed = true }
            }
            self.saving = false
            self.cancelExport()
            if failed { self.exportError = "파일을 저장하지 못했어요. 저장 위치를 확인하고 다시 시도해 주세요." }
        }
        if let window = webView.window ?? NSApp.keyWindow { panel.beginSheetModal(for: window, completionHandler: handler) }
        else { handler(panel.runModal()) }
    }

    fileprivate func receiveExport(_ message: WKScriptMessage, reply: @escaping (Any?, String?) -> Void) {
        guard message.name == "orunExport", trustedFrame(message.frameInfo), let body = message.body as? [String: Any], let op = body["op"] as? String else { reply(nil, "Not allowed"); return }
        guard message.webView === webView || (["print", "error"].contains(op) && message.webView === printPopup) else { reply(nil, "Not allowed"); return }
        do {
            switch op {
            case "gesture":
                guard message.webView === webView else { throw CocoaError(.fileReadNoPermission) }
                lastTrustedGesture = Date()
            case "print":
                guard hasRecentTrustedGesture, !exporting, !saving, !printing, let source = message.webView else { throw CocoaError(.fileWriteUnknown) }
                if source === printPopup {
                    guard let created = popupCreatedAt, Date().timeIntervalSince(created) < 120 else { throw CocoaError(.fileReadNoPermission) }
                } else if source !== webView { throw CocoaError(.fileReadNoPermission) }
                lastTrustedGesture = nil // One print per recorded user interaction.
                popupTimeout?.invalidate(); popupTimeout = nil
                startPrint(source)
            case "begin":
                guard hasRecentTrustedGesture, message.webView === webView,
                      let name = body["name"] as? String, name.utf8.count <= 1024, let mime = body["mime"] as? String, mime.count <= 200,
                      let size = body["size"] as? Int, size > 0, size <= MacExportPolicy.limit else { throw CocoaError(.fileReadTooLarge) }
                _ = try beginExport(name: name, mime: mime)
                expectedBytes = size; exportBytes = Data()
            case "chunk":
                guard exporting, activeDownload == nil, expectedBytes > 0, let encoded = body["data"] as? String, encoded.utf8.count <= 262144, let bytes = Data(base64Encoded: encoded), !bytes.isEmpty, exportBytes.count + bytes.count <= expectedBytes else { throw CocoaError(.fileReadCorruptFile) }
                exportBytes.append(bytes)
            case "end":
                guard exporting, activeDownload == nil, let dest = exportDestination, expectedBytes > 0, exportBytes.count == expectedBytes else { throw CocoaError(.fileReadCorruptFile) }
                try exportBytes.write(to: dest, options: [.atomic])
                try completeExport()
            case "error":
                if !exporting && !saving && !printing { exportError = "파일을 내보내지 못했어요. 다시 시도해 주세요." }
            default: throw CocoaError(.fileReadCorruptFile)
            }
            reply(["ok": true], nil)
        } catch { exportFailed(); reply(nil, "Export rejected") }
    }

    // MARK: WKDownload (server attachments from the trusted host)
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let attachment = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")?.lowercased().contains("attachment") == true
        if attachment || !response.canShowMIMEType {
            guard webView === self.webView, response.isForMainFrame, MacExportPolicy.trusted(webView.url), MacExportPolicy.trusted(response.response.url) else { decisionHandler(.cancel); return }
            decisionHandler(.download)
        } else { decisionHandler(.allow) }
    }
    private func attachDownload(_ download: WKDownload) {
        guard activeDownload == nil, !exporting, !saving, MacExportPolicy.trusted(download.originalRequest?.url), MacExportPolicy.trusted(webView.url) else {
            download.cancel { _ in }; exportError = "파일 내보내기를 시작하지 못했어요. 기존 내보내기를 닫고 다시 시도해 주세요."; return
        }
        activeDownload = download; download.delegate = self
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { attachDownload(download) }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { attachDownload(download) }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        guard download === activeDownload, MacExportPolicy.trusted(response.url), response.expectedContentLength > 0, response.expectedContentLength <= Int64(MacExportPolicy.limit),
              let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else { completionHandler(nil); exportFailed(); return }
        do {
            let dest = try beginExport(name: suggestedFilename, mime: response.mimeType ?? "")
            downloadProgress = download.progress.observe(\.completedUnitCount, options: [.new]) { [weak self, weak download] progress, _ in
                if progress.completedUnitCount > Int64(MacExportPolicy.limit) {
                    Task { @MainActor in guard let self, self.activeDownload === download else { return }; self.exportFailed() }
                }
            }
            completionHandler(dest)
        } catch { completionHandler(nil); exportFailed() }
    }
    func download(_ download: WKDownload, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, decisionHandler: @escaping (WKDownload.RedirectPolicy) -> Void) {
        let ok = MacExportPolicy.trusted(request.url)
        decisionHandler(ok ? .allow : .cancel)
        if !ok { exportFailed() }
    }
    func downloadDidFinish(_ download: WKDownload) {
        guard download === activeDownload else { return }
        do { try completeExport() } catch { exportFailed() }
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        guard download === activeDownload else { return }
        exportFailed()
    }
}

private struct MacEmbeddedWebView: NSViewRepresentable {
    let webView: WKWebView
    func makeNSView(context: Context) -> WKWebView { webView }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}

struct MacWebStudyView: View {
    @StateObject private var session = MacWebSession()
    var body: some View {
        ZStack {
            MacEmbeddedWebView(webView: session.webView)
            if let failure = session.failure {
                ContentUnavailableView {
                    Label("학습 화면 연결 오류", systemImage: "wifi.exclamationmark")
                } description: { Text(failure) } actions: {
                    Button("다시 시도") { session.load() }.buttonStyle(.borderedProminent)
                }
                .background(Color(nsColor: .windowBackgroundColor))
            }
        }
        .overlay(alignment: .top) {
            if session.loading && session.failure == nil {
                ProgressView(value: max(0.05, min(session.progress, 1))).progressViewStyle(.linear)
            }
        }
        .overlay(alignment: .bottom) {
            if session.exporting {
                ProgressView("파일 내보내는 중…").padding().background(.regularMaterial).clipShape(RoundedRectangle(cornerRadius: 12)).padding()
            } else if let notice = session.notice {
                Text(notice).padding(10).background(.regularMaterial).clipShape(RoundedRectangle(cornerRadius: 10)).padding()
                    .task(id: notice) { try? await Task.sleep(nanoseconds: 3_000_000_000); if session.notice == notice { session.notice = nil } }
            }
        }
        .toolbar {
            ToolbarItemGroup(placement: .navigation) {
                Button { session.goBack() } label: { Label("이전 화면", systemImage: "chevron.backward") }
                    .disabled(!session.canGoBack).keyboardShortcut("[", modifiers: .command).help("이전 화면")
                Button { session.goForward() } label: { Label("다음 화면", systemImage: "chevron.forward") }
                    .disabled(!session.canGoForward).keyboardShortcut("]", modifiers: .command).help("다음 화면")
            }
            ToolbarItemGroup(placement: .primaryAction) {
                Button { session.reload() } label: { Label("다시 불러오기", systemImage: "arrow.clockwise") }
                    .keyboardShortcut("r", modifiers: .command).help("다시 불러오기 (⌘R)")
                Button { session.printCurrentPage() } label: { Label("인쇄", systemImage: "printer") }
                    .keyboardShortcut("p", modifiers: .command).help("인쇄 (⌘P)")
                Button { session.openInBrowser() } label: { Label("브라우저에서 열기", systemImage: "safari") }
                    .help("기본 브라우저에서 열기")
            }
        }
        .alert("파일 내보내기", isPresented: Binding(get: { session.exportError != nil }, set: { if !$0 { session.exportError = nil } })) {
            Button("확인") { session.exportError = nil }
        } message: { Text(session.exportError ?? "") }
        .frame(minWidth: 480, minHeight: 360)
    }
}
