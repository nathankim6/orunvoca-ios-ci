import SwiftUI
import UIKit
import Combine

// Kept for legacy source files still compiled by the project; no notebook is initialized.
// Explicit alias preserves the property-wrapper API with the Xcode 27 SDK.
typealias ValueState<Value> = SwiftUI.State<Value>

/// Brand palette shared by the native shell (launch screen, splash, offline state).
enum Brand {
    static let navy = UIColor(red: 24 / 255, green: 49 / 255, blue: 96 / 255, alpha: 1)       // icon tile #183160
    static let ink = UIColor(red: 18 / 255, green: 29 / 255, blue: 48 / 255, alpha: 1)        // web --ink #121D30
    static let paper = UIColor(red: 245 / 255, green: 247 / 255, blue: 250 / 255, alpha: 1)   // web --paper #F5F7FA
    static let action = UIColor(red: 27 / 255, green: 52 / 255, blue: 112 / 255, alpha: 1)    // web --brand #1B3470
    static let beam = UIColor(red: 246 / 255, green: 190 / 255, blue: 30 / 255, alpha: 1)     // lighthouse beam
}

// Scene-based UIKit host: a real UIWindow owns the status bar so the shell can match
// light/dark status icons to whatever colour the web page paints under it.
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Default", sessionRole: connectingSceneSession.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.backgroundColor = Brand.navy
        window.tintColor = Brand.action
        window.rootViewController = ShellViewController()
        window.makeKeyAndVisible()
        self.window = window
    }
}

final class ShellViewController: UIHostingController<ShellRoot> {
    private let session: WebSession
    private var observers = Set<AnyCancellable>()
    init() {
        let session = WebSession()
        self.session = session
        super.init(rootView: ShellRoot(session: session))
        session.$chromeIsDark.combineLatest(session.$showSplash)
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                UIView.animate(withDuration: 0.25) { self?.setNeedsStatusBarAppearanceUpdate() }
            }
            .store(in: &observers)
    }
    @available(*, unavailable) required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() { super.viewDidLoad(); view.backgroundColor = Brand.navy }
    override var preferredStatusBarStyle: UIStatusBarStyle {
        (session.showSplash || session.chromeIsDark) ? .lightContent : .darkContent
    }
    override var preferredStatusBarUpdateAnimation: UIStatusBarAnimation { .fade }
}

struct ShellRoot: View {
    @ObservedObject var session: WebSession
    var body: some View {
        ZStack {
            // Paints the status-bar strip (and landscape side insets) in the page's own top colour.
            Color(uiColor: session.chromeColor).ignoresSafeArea()
            WebStudyView(session: session)
            if session.showSplash {
                SplashView().transition(.opacity).zIndex(2)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: session.chromeColor)
        .animation(.easeOut(duration: 0.45), value: session.showSplash)
    }
}

/// Continues the system launch screen (same navy and centred mark), then adds the wordmark.
struct SplashView: View {
    @ValueState private var revealed = false
    var body: some View {
        GeometryReader { proxy in
            ZStack {
                Color(uiColor: Brand.navy)
                Image("LaunchLogo")
                    .resizable().scaledToFit()
                    .frame(width: 200, height: 200)
                    .position(x: proxy.size.width / 2, y: proxy.size.height / 2)
                    .scaleEffect(revealed ? 0.96 : 1)
                VStack(spacing: 6) {
                    Text("옳은보카")
                        .font(.system(size: 30, weight: .heavy))
                        .tracking(-0.6)
                    Text("옳은영어 어휘플랫폼")
                        .font(.system(size: 15, weight: .medium))
                        .opacity(0.78)
                }
                .foregroundStyle(.white)
                .position(x: proxy.size.width / 2, y: proxy.size.height / 2 + 142)
                .opacity(revealed ? 1 : 0)
                .offset(y: revealed ? 0 : 8)
                ProgressView()
                    .tint(.white.opacity(0.85))
                    .position(x: proxy.size.width / 2, y: proxy.size.height - max(proxy.safeAreaInsets.bottom, 16) - 44)
                    .opacity(revealed ? 1 : 0)
            }
        }
        .ignoresSafeArea()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("옳은보카 시작 중")
        .onAppear { withAnimation(.easeOut(duration: 0.5).delay(0.12)) { revealed = true } }
    }
}
