import SwiftUI
import WebKit
import AVFoundation
import SafariServices
import UniformTypeIdentifiers

// Export bridge deliberately accepts bytes, never paths or remote URLs.
private enum ExportPolicy {
    static let limit = 25 * 1024 * 1024
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
        let safe = String(stem.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) && !CharacterSet(charactersIn: "/\\:<>\"|?*\u{202A}\u{202B}\u{202D}\u{202E}\u{202C}\u{2066}\u{2067}\u{2068}\u{2069}").contains($0) }.prefix(100)).trimmingCharacters(in: CharacterSet(charactersIn: ". "))
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

private final class ExportMessageProxy: NSObject, WKScriptMessageHandlerWithReply {
    weak var owner: WebSession?
    @MainActor func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let owner else { replyHandler(nil, "Export unavailable"); return }
        owner.receiveExport(message, reply: replyHandler)
    }
}

struct WebExportFile: Identifiable { let id = UUID(); let url: URL }
struct WebExportSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: [url], applicationActivities: nil) }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

// UIKit owns pagination/print CSS and system print/PDF preview. No HTML or URLs
// are accepted by the bridge, only the already trusted WKWebView's formatter.
struct WebPrintSource: Identifiable { let id = UUID(); let webView: WKWebView }
struct WebPrintSheet: UIViewControllerRepresentable {
    let source: WebPrintSource
    let finished: () -> Void
    func makeUIViewController(context: Context) -> WebPrintHost {
        WebPrintHost(webView: source.webView, finished: finished)
    }
    func updateUIViewController(_ controller: WebPrintHost, context: Context) {}
    static func dismantleUIViewController(_ controller: WebPrintHost, coordinator: ()) { controller.cancelPrinting() }
}
final class WebPrintHost: UIViewController {
    private let webView: WKWebView
    private let finished: () -> Void
    private var started = false
    private let printer = UIPrintInteractionController()
    init(webView: WKWebView, finished: @escaping () -> Void) {
        self.webView = webView; self.finished = finished
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = .systemBackground
        let label = UILabel(); label.text = "인쇄 · PDF 미리보기 여는 중…"; label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(label)
        NSLayoutConstraint.activate([label.centerXAnchor.constraint(equalTo: view.centerXAnchor), label.centerYAnchor.constraint(equalTo: view.centerYAnchor)])
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !started else { return }; started = true
        let info = UIPrintInfo(dictionary: nil); info.jobName = String((webView.title ?? "옳은VOCA").prefix(100)); info.outputType = .general
        printer.printInfo = info; printer.printFormatter = webView.viewPrintFormatter()
        let completion: UIPrintInteractionController.CompletionHandler = { [weak self] _, _, error in
            guard let self else { return }
            if error != nil {
                let alert = UIAlertController(title: "인쇄를 열지 못했어요", message: "다시 시도해 주세요. PDF는 인쇄 미리보기의 공유 메뉴에서 파일에 저장할 수 있어요.", preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "확인", style: .default) { _ in self.finished() }); self.present(alert, animated: true)
            } else { self.finished() }
        }
        let presented: Bool
        if traitCollection.userInterfaceIdiom == .pad {
            presented = printer.present(from: CGRect(x: view.bounds.midX, y: view.safeAreaInsets.top + 1, width: 1, height: 1), in: view, animated: true, completionHandler: completion)
        } else { presented = printer.present(animated: true, completionHandler: completion) }
        if !presented {
            let alert = UIAlertController(title: "인쇄를 열지 못했어요", message: "잠시 후 다시 시도해 주세요.", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "확인", style: .default) { _ in self.finished() }); present(alert, animated: true)
        }
    }
    func cancelPrinting() { printer.dismiss(animated: false) }
}

private let exportScript = #"""
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
  // FileSaver consults window.saveAs first. This also avoids its macOS-style
  // iPad WebView fallback (window.open + FileReader navigation).
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
  // FileSaver dispatches a non-bubbling MouseEvent on a detached anchor.
  HTMLAnchorElement.prototype.dispatchEvent = function(e) { if (e.type === 'click' && intercept(this, e)) return false; return dispatch.call(this, e); };
  document.addEventListener('click', e => { const a = e.target instanceof Element ? e.target.closest('a') : null; intercept(a, e); }, true);
})();
"""#

#if QA_SMOKE
// TEST-ONLY fixture. Compiled solely with -D QA_SMOKE (CI runtime smoke) and only
// injected for the --qa-pronunciation launch argument into the trusted HTTPS main
// frame. It adds a local panel; it never reads, fills, submits or stores site data.
private let qaPronunciationScript = #"""
(() => {
  if (window !== window.top || location.origin !== 'https://orunvoca.co.kr' || document.getElementById('orun-qa-smoke')) return true;
  const bridge = window.webkit.messageHandlers.orunPronunciation;
  const box = document.createElement('div');
  box.id = 'orun-qa-smoke';
  box.style.cssText = 'position:fixed;left:8px;right:8px;bottom:32px;z-index:2147483647;background:#fff3b0;color:#000;border:2px solid #9a6700;border-radius:8px;padding:8px;font:14px -apple-system,sans-serif;';
  const line = (id, text) => { const p = document.createElement('p'); p.id = id; p.textContent = text; p.style.margin = '3px 0'; box.appendChild(p); return p; };
  line('orun-qa-title', 'QA SMOKE test build only');
  const gate = line('orun-qa-gate', 'QA gate pending');
  const speak = line('orun-qa-speak', 'QA speak idle');
  const invalid = line('orun-qa-invalid', 'QA invalid idle');
  const cancel = line('orun-qa-cancel', 'QA cancel idle');
  // Diagnostic only: which real input events reached the panel (never changes pass criteria).
  const events = line('orun-qa-events', 'QA events none');
  const seen = [];
  for (const type of ['touchstart', 'touchend', 'pointerdown', 'pointerup', 'mousedown', 'click']) box.addEventListener(type, e => {
    seen.push(type + (e.isTrusted ? '' : '(untrusted)')); events.textContent = 'QA events ' + seen.slice(-12).join(',');
  }, true);
  const reason = e => String((e && e.message) || e);
  const button = (label, run) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
    b.style.cssText = 'margin:4px;padding:10px 14px;font:15px -apple-system,sans-serif;';
    b.addEventListener('click', e => run(e.isTrusted)); box.appendChild(b);
  };
  button('QA speak hello', trusted => {
    const started = performance.now(); speak.textContent = 'QA speak pending';
    bridge.postMessage({text:'hello', lang:'en-US', rate:0.9}).then(r => {
      speak.textContent = r && r.status === 'finished'
        ? 'QA finished: finished in ' + Math.round(performance.now() - started) + 'ms, trusted click ' + trusted
        : 'QA speak unexpected result ' + JSON.stringify(r);
    }, e => { speak.textContent = 'QA speak failed: ' + reason(e); });
  });
  button('QA invalid language', () => {
    invalid.textContent = 'QA invalid pending';
    bridge.postMessage({text:'hello', lang:'fr-FR', rate:0.9}).then(
      r => { invalid.textContent = 'QA invalid unexpectedly accepted ' + JSON.stringify(r); },
      e => { invalid.textContent = 'QA invalid rejected: ' + reason(e); });
  });
  button('QA cancel speech', () => {
    cancel.textContent = 'QA cancel pending';
    const long = bridge.postMessage({text:'This deliberately long English sentence is cancelled by the native stop request before it can finish speaking.', lang:'en-US', rate:0.9});
    const stop = new Promise(resolve => setTimeout(resolve, 400)).then(() => bridge.postMessage({op:'stop'}));
    Promise.allSettled([long, stop]).then(([a, b]) => {
      const first = a.status === 'rejected' ? 'rejected ' + reason(a.reason) : 'resolved ' + JSON.stringify(a.value);
      const second = b.status === 'fulfilled' ? (b.value && b.value.status) : 'failed ' + reason(b.reason);
      cancel.textContent = 'QA cancel: speak ' + first + '; stop ' + second;
    });
  });
  document.body.appendChild(box);
  // Negative gate check: no user gesture has occurred in this fresh launch, so native must reject.
  bridge.postMessage({text:'hello', lang:'en-US', rate:0.9}).then(
    r => { gate.textContent = 'QA no-gesture unexpectedly accepted ' + JSON.stringify(r); },
    e => { gate.textContent = 'QA no-gesture rejected: ' + reason(e); });
  return true;
})();
"""#
#endif

// Local-only English pronunciation. The synthesizer is retained for the session;
// at most one utterance is pending and its reply is settled exactly once.
@MainActor private final class PronunciationSpeaker: NSObject, AVSpeechSynthesizerDelegate {
    private let synthesizer = AVSpeechSynthesizer()
    private var current: AVSpeechUtterance?
    private var pendingReply: ((Any?, String?) -> Void)?
    override init() { super.init(); synthesizer.delegate = self }
    private func settle(_ result: Any?, _ error: String?) {
        guard let reply = pendingReply else { return }
        pendingReply = nil; current = nil
        reply(result, error)
    }
    func speak(body: [String: Any], reply: @escaping (Any?, String?) -> Void) {
        guard let raw = body["text"] as? String, let lang = body["lang"] as? String, ["en-US", "en-GB"].contains(lang),
              let rate = (body["rate"] as? NSNumber)?.doubleValue, rate.isFinite, rate >= 0.5, rate <= 1.25 else { reply(nil, "Invalid pronunciation request"); return }
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= 300, text.utf8.count <= 1200 else { reply(nil, "Invalid pronunciation text"); return }
        // Reject before touching current playback when no installed English voice exists.
        guard let voice = AVSpeechSynthesisVoice(language: lang) else { reply(nil, "English voice unavailable"); return }
        stop()
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try? session.setActive(true)
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = voice
        utterance.rate = Float(min(max(Double(AVSpeechUtteranceDefaultSpeechRate) * rate, Double(AVSpeechUtteranceMinimumSpeechRate)), Double(AVSpeechUtteranceMaximumSpeechRate)))
        current = utterance; pendingReply = reply
        synthesizer.speak(utterance)
    }
    /// Settles the pending promise as cancelled, then stops audio. Safe to call repeatedly.
    func stop() {
        settle(nil, "Pronunciation cancelled")
        if synthesizer.isSpeaking || synthesizer.isPaused { synthesizer.stopSpeaking(at: .immediate) }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        #if QA_SMOKE
        NSLog("QA_SMOKE AVSpeechSynthesizer didFinish")
        #endif
        Task { @MainActor in
            guard self.current === utterance else { return }
            self.settle(["status": "finished"], nil)
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in if self.current === utterance { self.settle(nil, "Pronunciation cancelled") } }
    }
    #if QA_SMOKE
    // TEST-ONLY evidence that the real synthesizer delegate fired (not a mocked reply).
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) { NSLog("QA_SMOKE AVSpeechSynthesizer didStart") }
    #endif
}

private final class PronunciationProxy: NSObject, WKScriptMessageHandlerWithReply {
    weak var owner: WebSession?
    @MainActor func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let owner else { replyHandler(nil, "Pronunciation unavailable"); return }
        owner.receivePronunciation(message, reply: replyHandler)
    }
}

@MainActor final class WebSession: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    @Published var printSource: WebPrintSource?
    private var printPopup: WKWebView?
    private var lastTrustedGesture: Date?
    private var hasRecentTrustedGesture: Bool {
        guard let date = lastTrustedGesture else { return false }
        let age = Date().timeIntervalSince(date)
        return age >= 0 && age < 120
    }
    private var popupCreatedAt: Date?
    private var popupTimeout: Timer?
    @Published var exportFile: WebExportFile?
    @Published var exportError: String?
    @Published var exporting = false
    private let exportProxy = ExportMessageProxy()
    private let pronunciationProxy = PronunciationProxy()
    private let speaker = PronunciationSpeaker()
    private var exportDirectory: URL?
    private var exportDestination: URL?
    private var exportBytes = Data()
    private var expectedBytes = 0
    private var activeDownload: WKDownload?
    private var downloadProgress: NSKeyValueObservation?
    private var exportTimeout: Timer?
    @Published var failure: String?
    @Published var loading = true
    @Published var externalURL: URL?
    let webView: WKWebView
    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        // Async teacher exports may outlive WebKit activation. Every popup path
        // below still requires the exact mainframe creator and native gesture TTL.
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        exportProxy.owner = self
        pronunciationProxy.owner = self
        configuration.userContentController.addScriptMessageHandler(pronunciationProxy, contentWorld: .page, name: "orunPronunciation")
        configuration.userContentController.addScriptMessageHandler(exportProxy, contentWorld: .page, name: "orunExport")
        configuration.userContentController.addUserScript(WKUserScript(source: exportScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.isInspectable = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        load()
    }
    func load() {
        speaker.stop()
        cancelExport()
        failure = nil; loading = true
        webView.load(URLRequest(url: URL(string: "https://orunvoca.co.kr/")!))
    }
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { if webView === self.webView { speaker.stop() } }
    func stopPronunciation() { speaker.stop() }
    fileprivate func receivePronunciation(_ message: WKScriptMessage, reply: @escaping (Any?, String?) -> Void) {
        guard message.name == "orunPronunciation", message.webView === webView, trustedFrame(message.frameInfo), let body = message.body as? [String: Any] else { reply(nil, "Not allowed"); return }
        // Stopping needs no user gesture, only the trusted main frame checked above.
        if body["op"] as? String == "stop" { speaker.stop(); reply(["status": "stopped"], nil); return }
        guard hasRecentTrustedGesture else { reply(nil, "Not allowed"); return }
        speaker.speak(body: body, reply: reply)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loading = false
        #if QA_SMOKE
        if webView === self.webView, ProcessInfo.processInfo.arguments.contains("--qa-pronunciation"), ExportPolicy.trusted(webView.url) {
            webView.evaluateJavaScript(qaPronunciationScript, completionHandler: nil)
        }
        #endif
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(error) }
    private func fail(_ error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled, !((error as NSError).domain == "WebKitErrorDomain" && (error as NSError).code == 102) else { return }
        loading = false; failure = "학습 화면을 열지 못했어요. 인터넷 연결을 확인한 후 다시 시도해 주세요."
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        speaker.stop()
        cancelExport()
        loading = false; failure = "학습 화면이 종료되었어요. 다시 열어 주세요."
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if webView === printPopup {
            decisionHandler(url.absoluteString == "about:blank" ? .allow : .cancel)
            return
        }
        if action.targetFrame == nil {
            guard webView === self.webView, trustedFrame(action.sourceFrame), hasRecentTrustedGesture else { decisionHandler(.cancel); return }
        }
        if ExportPolicy.trusted(url) {
            if action.shouldPerformDownload {
                guard trustedFrame(action.sourceFrame) else { decisionHandler(.cancel); return }
                decisionHandler(.download)
            } else { decisionHandler(.allow) }
            return
        }
        if url.absoluteString == "about:blank" { decisionHandler(.allow); return }
        if action.targetFrame?.isMainFrame == false { decisionHandler(.allow); return }
        if ["https", "http"].contains(url.scheme?.lowercased() ?? "") {
            externalURL = url
        } else if ["mailto", "tel"].contains(url.scheme?.lowercased() ?? "") {
            UIApplication.shared.open(url)
        }
        decisionHandler(.cancel)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard webView === self.webView, trustedFrame(action.sourceFrame), hasRecentTrustedGesture else { return nil }
        if action.request.url?.absoluteString == "about:blank", trustedFrame(action.sourceFrame), printPopup == nil, printSource == nil, !exporting, exportFile == nil {
            // One ephemeral blank popup, inherited from the exact HTTPS creator.
            // Native code accepts only its existing formatter, never supplied HTML or URLs.
            let popupContent = WKUserContentController()
            popupContent.addScriptMessageHandler(exportProxy, contentWorld: .page, name: "orunExport")
            popupContent.addUserScript(WKUserScript(source: "window.print = function() { if (document.documentElement.outerHTML.length > 26214400) { window.webkit.messageHandlers.orunExport.postMessage({op:'error'}).catch(function() {}); return; } window.webkit.messageHandlers.orunExport.postMessage({op:'print'}).catch(function() {}); }; window.close = function() {};", injectionTime: .atDocumentStart, forMainFrameOnly: true))
            configuration.userContentController = popupContent
            let popup = WKWebView(frame: CGRect(x: 0, y: 0, width: 794, height: 1123), configuration: configuration)
            popup.navigationDelegate = self; popup.uiDelegate = self
            printPopup = popup; popupCreatedAt = Date()
            popupTimeout?.invalidate()
            popupTimeout = Timer.scheduledTimer(withTimeInterval: 120, repeats: false) { [weak self] _ in
                Task { @MainActor in guard let self, self.printSource == nil else { return }; self.finishPrinting() }
            }
            return popup
        }
        if let url = action.request.url, ExportPolicy.trusted(url), trustedFrame(action.sourceFrame) { webView.load(action.request) }
        else if let url = action.request.url, ["https", "http"].contains(url.scheme ?? "") { externalURL = url }
        return nil
    }
    private func trustedFrame(_ frame: WKFrameInfo) -> Bool {
        frame.isMainFrame && frame.securityOrigin.protocol == "https" && frame.securityOrigin.host == "orunvoca.co.kr" && [0,443].contains(frame.securityOrigin.port) && ExportPolicy.trusted(webView.url)
    }
    func finishPrinting() { popupTimeout?.invalidate(); popupTimeout = nil; printSource = nil; printPopup?.stopLoading(); printPopup = nil; popupCreatedAt = nil }
    func cancelExport() {
        finishPrinting()
        lastTrustedGesture = nil
        exportTimeout?.invalidate(); exportTimeout = nil
        downloadProgress = nil
        activeDownload?.cancel { _ in }; activeDownload = nil
        exportBytes = Data(); expectedBytes = 0; exporting = false
        if let directory = exportDirectory { try? FileManager.default.removeItem(at: directory) }
        exportDirectory = nil; exportDestination = nil; exportFile = nil
    }
    private func exportFailed() {
        cancelExport()
        exportError = "파일을 내보내지 못했어요. PDF, Excel, Word, PNG, ZIP, CSV 파일(최대 25MB)만 지원해요. 연결과 파일 크기를 확인하고 다시 시도해 주세요."
    }
    private func beginExport(name: String, mime: String) throws -> URL {
        guard !exporting, printSource == nil, exportFile == nil, externalURL == nil, let safeName = ExportPolicy.filename(name, mime: mime) else { throw CocoaError(.fileWriteInvalidFileName) }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("OrunExport-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        exportDirectory = directory
        let destination = directory.appendingPathComponent(safeName, isDirectory: false)
        exportDestination = destination; exporting = true
        exportTimeout = Timer.scheduledTimer(withTimeInterval: 120, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.exportFailed() }
        }
        return destination
    }
    private func completeExport() throws {
        guard let destination = exportDestination else { throw CocoaError(.fileNoSuchFile) }
        let attributes = try FileManager.default.attributesOfItem(atPath: destination.path)
        let count = (attributes[.size] as? NSNumber)?.intValue ?? 0
        guard count > 0, count <= ExportPolicy.limit else { throw CocoaError(.fileReadTooLarge) }
        let handle = try FileHandle(forReadingFrom: destination)
        defer { try? handle.close() }
        let ext = destination.pathExtension
        let header = try handle.read(upToCount: ext == "csv" ? ExportPolicy.limit : 8) ?? Data()
        guard ExportPolicy.validHeader(header, ext: ext) else { throw CocoaError(.fileReadCorruptFile) }
        exportTimeout?.invalidate(); exportTimeout = nil; downloadProgress = nil; activeDownload = nil
        exportBytes = Data(); expectedBytes = 0; exporting = false; loading = false
        exportFile = WebExportFile(url: destination)
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
                guard hasRecentTrustedGesture, !exporting, exportFile == nil, printSource == nil, externalURL == nil, let source = message.webView else { throw CocoaError(.fileWriteUnknown) }
                if source === printPopup {
                    guard let created = popupCreatedAt, Date().timeIntervalSince(created) < 120 else { throw CocoaError(.fileReadNoPermission) }
                } else if source !== webView { throw CocoaError(.fileReadNoPermission) }
                lastTrustedGesture = nil // One print per recorded user interaction.
                popupTimeout?.invalidate(); popupTimeout = nil
                printSource = WebPrintSource(webView: source)
            case "begin":
                guard let name = body["name"] as? String, name.utf8.count <= 1024, let mime = body["mime"] as? String, mime.count <= 200, let size = body["size"] as? Int, size > 0, size <= ExportPolicy.limit else { throw CocoaError(.fileReadTooLarge) }
                _ = try beginExport(name: name, mime: mime)
                expectedBytes = size; exportBytes = Data()
            case "chunk":
                guard exporting, activeDownload == nil, expectedBytes > 0, let encoded = body["data"] as? String, encoded.utf8.count <= 262144, let bytes = Data(base64Encoded: encoded), !bytes.isEmpty, exportBytes.count + bytes.count <= expectedBytes else { throw CocoaError(.fileReadCorruptFile) }
                exportBytes.append(bytes)
            case "end":
                guard exporting, activeDownload == nil, let destination = exportDestination, expectedBytes > 0, exportBytes.count == expectedBytes else { throw CocoaError(.fileReadCorruptFile) }
                try exportBytes.write(to: destination, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                try completeExport()
            default: throw CocoaError(.fileReadCorruptFile)
            }
            reply(["ok": true], nil)
        } catch { exportFailed(); reply(nil, "Export rejected") }
    }
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let attachment = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")?.lowercased().contains("attachment") == true
        if attachment || !response.canShowMIMEType {
            guard response.isForMainFrame, ExportPolicy.trusted(webView.url), ExportPolicy.trusted(response.response.url) else { decisionHandler(.cancel); return }
            decisionHandler(.download)
        } else { decisionHandler(.allow) }
    }
    private func attachDownload(_ download: WKDownload) {
        guard activeDownload == nil, !exporting, exportFile == nil, ExportPolicy.trusted(download.originalRequest?.url), ExportPolicy.trusted(webView.url) else { download.cancel { _ in }; exportError = "파일 내보내기를 시작하지 못했어요. 기존 내보내기를 닫고 다시 시도해 주세요."; return }
        activeDownload = download; download.delegate = self
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { attachDownload(download) }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { attachDownload(download) }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        guard download === activeDownload, ExportPolicy.trusted(response.url), response.expectedContentLength > 0, response.expectedContentLength <= ExportPolicy.limit,
              let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else { completionHandler(nil); exportFailed(); return }
        do {
            let destination = try beginExport(name: suggestedFilename, mime: response.mimeType ?? "")
            downloadProgress = download.progress.observe(\.completedUnitCount, options: [.new]) { [weak self, weak download] progress, _ in
                let exceeded = progress.completedUnitCount > ExportPolicy.limit
                if exceeded { Task { @MainActor in guard let self, self.activeDownload === download else { return }; self.exportFailed() } }
            }
            completionHandler(destination)
        } catch { completionHandler(nil); exportFailed() }
    }
    func download(_ download: WKDownload, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, decisionHandler: @escaping (WKDownload.RedirectPolicy) -> Void) {
        let allowed = ExportPolicy.trusted(request.url)
        decisionHandler(allowed ? .allow : .cancel)
        if !allowed { exportFailed() }
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

struct EmbeddedWebView: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
struct BrowserSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController { SFSafariViewController(url: url) }
    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}
struct WebStudyView: View {
    @StateObject private var session = WebSession()
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("옳은VOCA").font(.headline)
                Spacer()
                Button { session.webView.goBack() } label: { Image(systemName: "chevron.backward") }.accessibilityLabel("이전 화면")
                Button { session.load() } label: { Image(systemName: "arrow.clockwise") }.accessibilityLabel("학습 화면 다시 열기")
            }.padding(.horizontal).padding(.vertical, 10)
            Divider()
            if let failure = session.failure {
                ContentUnavailableView {
                    Label("학습 화면 연결 오류", systemImage: "wifi.exclamationmark")
                } description: { Text(failure) } actions: { Button("다시 시도") { session.load() }.buttonStyle(.borderedProminent) }
            } else {
                EmbeddedWebView(webView: session.webView)
                    .overlay { if session.loading { ProgressView("학습 화면 여는 중") } }
            }
        }
        .onDisappear { session.stopPronunciation() }
        .overlay(alignment: .bottom) { if session.exporting { ProgressView("파일 내보내는 중…").padding().background(.regularMaterial).clipShape(RoundedRectangle(cornerRadius: 12)) } }
        .alert("파일 내보내기", isPresented: Binding(get: { session.exportError != nil }, set: { if !$0 { session.exportError = nil } })) { Button("확인") { session.exportError = nil } } message: { Text(session.exportError ?? "") }
        .sheet(item: $session.printSource, onDismiss: { session.finishPrinting() }) { source in WebPrintSheet(source: source, finished: { session.printSource = nil }) }
        .sheet(item: $session.exportFile, onDismiss: { session.cancelExport() }) { file in WebExportSheet(url: file.url) }
        .sheet(isPresented: Binding(get: { session.externalURL != nil }, set: { if !$0 { session.externalURL = nil } })) {
            if let url = session.externalURL { BrowserSheet(url: url).ignoresSafeArea() }
        }
    }
}
