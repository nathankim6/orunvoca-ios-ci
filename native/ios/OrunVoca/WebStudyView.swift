import SwiftUI
import WebKit
import SafariServices
import UniformTypeIdentifiers

@MainActor final class WebSession: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {
    @Published var failure: String?
    @Published var loading = true
    @Published var externalURL: URL?
    let webView: WKWebView
    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.isInspectable = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        load()
    }
    func load() {
        failure = nil; loading = true
        webView.load(URLRequest(url: URL(string: "https://orunvoca.co.kr/")!))
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loading = false }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(error) }
    private func fail(_ error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        loading = false; failure = "학습 화면을 열지 못했어요. 인터넷 연결을 확인한 후 다시 시도해 주세요. 오프라인 단어장은 계속 사용할 수 있어요."
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        loading = false; failure = "학습 화면이 종료되었어요. 다시 열어 주세요."
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "https", url.host == "orunvoca.co.kr" { decisionHandler(.allow); return }
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
        if let url = action.request.url, ["https", "http"].contains(url.scheme ?? "") { externalURL = url }
        return nil
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
                Text("ORUN VOCA").font(.headline)
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
        .sheet(isPresented: Binding(get: { session.externalURL != nil }, set: { if !$0 { session.externalURL = nil } })) {
            if let url = session.externalURL { BrowserSheet(url: url).ignoresSafeArea() }
        }
    }
}
