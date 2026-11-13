import SwiftUI

@MainActor final class MacAppModel: ObservableObject {
    // Legacy --section arguments intentionally have no effect: every launch opens online study.
    @Published var phoneMode = ProcessInfo.processInfo.arguments.contains("--phone-mode")
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
    private let phoneWidth: CGFloat = 390

    var body: some View {
        GeometryReader { geometry in
            // Change only the proposed size, never the view's structural identity.
            // The existing StateObject session, cookies and current page stay alive.
            MacWebStudyView()
                .frame(width: model.phoneMode ? min(phoneWidth, geometry.size.width) : geometry.size.width,
                       height: geometry.size.height)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .toolbar {
            ToolbarItem(placement: .principal) {
                Picker("화면 모드", selection: $model.phoneMode) {
                    Text("데스크톱").tag(false)
                    Text("휴대폰").tag(true)
                }
                .pickerStyle(.segmented)
                .controlSize(.small)
                .frame(width: 164)
                .accessibilityIdentifier("study-display-mode")
                .help("휴대폰 모드는 학습 화면을 390포인트 너비로 보여 줍니다.")
            }
        }
    }
}
