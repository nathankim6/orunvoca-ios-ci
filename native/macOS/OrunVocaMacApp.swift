import SwiftUI

/// Study display width. Desktop fills the window; tablet and phone narrow the SAME study view's real frame.
enum MacDisplayMode: String, CaseIterable, Hashable {
    case desktop, tablet, phone

    static let tabletWidth: CGFloat = 768
    static let phoneWidth: CGFloat = 390

    /// Maximum real view width; nil means "fill the available width".
    var maxWidth: CGFloat? {
        switch self {
        case .desktop: return nil
        case .tablet: return Self.tabletWidth
        case .phone: return Self.phoneWidth
        }
    }

    /// Actual view width: desktop = available, tablet = min(768, available), phone = min(390, available).
    func viewWidth(available: CGFloat) -> CGFloat {
        let width = max(0, available)
        guard let limit = maxWidth else { return width }
        return min(limit, width)
    }

    /// Launch flags: legacy --phone-mode keeps working (and wins), --tablet-mode is accepted; anything else is desktop.
    static func launchMode(_ arguments: [String]) -> MacDisplayMode {
        if arguments.contains("--phone-mode") { return .phone }
        if arguments.contains("--tablet-mode") { return .tablet }
        return .desktop
    }
}

@MainActor final class MacAppModel: ObservableObject {
    // Legacy --section arguments intentionally have no effect: every launch opens online study.
    @Published var displayMode = MacDisplayMode.launchMode(ProcessInfo.processInfo.arguments)
}

@main
struct OrunVocaMacApp: App {
    @StateObject private var model = MacAppModel()
    var body: some Scene {
        WindowGroup("옳은보카") {
            MacRootView()
                .environmentObject(model)
                .frame(minWidth: 760, minHeight: 560)
                .tint(Color(red: 27.0 / 255.0, green: 52.0 / 255.0, blue: 112.0 / 255.0))
        }
        .defaultSize(width: 1000, height: 760)
        .windowToolbarStyle(.unifiedCompact)
        .commands {
            CommandGroup(replacing: .newItem) {}
            CommandGroup(replacing: .help) {
                Link("옳은보카 고객 지원", destination: URL(string: "https://orunvoca.co.kr/support.html")!)
                Link("개인정보 처리방침", destination: URL(string: "https://orunvoca.co.kr/privacy.html")!)
                Link("온라인 계정 삭제 안내", destination: URL(string: "https://orunvoca.co.kr/delete-account.html")!)
            }
        }
    }
}

struct MacRootView: View {
    @EnvironmentObject var model: MacAppModel

    var body: some View {
        GeometryReader { geometry in
            // Change only the proposed size, never the view's structural identity.
            // The existing StateObject session, cookies and current page stay alive in every mode.
            MacWebStudyView()
                .frame(width: model.displayMode.viewWidth(available: geometry.size.width),
                       height: geometry.size.height)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .toolbar {
            ToolbarItem(placement: .principal) {
                Picker("화면 모드", selection: $model.displayMode) {
                    Text("데스크톱").tag(MacDisplayMode.desktop)
                    Text("태블릿").tag(MacDisplayMode.tablet)
                    Text("휴대폰").tag(MacDisplayMode.phone)
                }
                .pickerStyle(.segmented)
                .controlSize(.small)
                // Three equal segments wide enough for "데스크톱" without truncation.
                .frame(width: 252)
                .accessibilityIdentifier("study-display-mode")
                .help("데스크톱은 창 전체, 태블릿은 768포인트, 휴대폰은 390포인트 너비로 학습 화면을 보여 줍니다.")
            }
        }
    }
}
