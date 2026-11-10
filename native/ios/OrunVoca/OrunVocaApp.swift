import SwiftUI

// Explicit alias preserves the property-wrapper API with the Xcode 27 SDK.
typealias ValueState<Value> = SwiftUI.State<Value>

@main
struct OrunVocaApp: App {
    @StateObject private var notebook = NotebookStore()
    var body: some Scene {
        WindowGroup {
            TabView {
                WebStudyView().tabItem { Label("온라인 학습", systemImage: "graduationcap") }
                NotebookView().tabItem { Label("오프라인 단어장", systemImage: "rectangle.stack") }
                NativeSettingsView().tabItem { Label("앱 정보", systemImage: "info.circle") }
            }
            .tint(Color(red: 0, green: 113.0 / 255.0, blue: 227.0 / 255.0))
            .environmentObject(notebook)
        }
    }
}

struct NativeSettingsView: View {
    @EnvironmentObject var notebook: NotebookStore
    @ValueState<Bool> private var confirmingReset = false
    var body: some View {
        NavigationStack {
            Form {
                Section("옳은보카") {
                    Label("매일 조금씩, 오래 기억하는 단어", systemImage: "leaf")
                    Text("버전 \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0")")
                }
                Section("오프라인 단어장 개인정보") {
                    Text("직접 추가하거나 가져온 단어와 복습 기록은 이 기기에 저장됩니다. 오프라인 단어장은 계정 없이 사용할 수 있으며 별도 추적이나 서버 전송을 하지 않습니다. 기기 백업에는 포함될 수 있습니다.")
                    Text("온라인 학습은 인터넷과 기존 학습 계정이 필요합니다. 온라인 로그인·학습 데이터는 서비스 서버에서 처리됩니다. 이 앱은 별도 광고 또는 분석 SDK를 포함하지 않습니다.")
                    Text("공유한 단어장 파일에는 단어와 뜻이 포함됩니다. 공유 대상과 파일 보관에 유의하세요.")
                }
                Section("개인정보 및 지원") {
                    Link("개인정보 처리방침", destination: URL(string: "https://orunvoca.co.kr/privacy.html")!)
                    Link("고객 지원", destination: URL(string: "https://orunvoca.co.kr/support.html")!)
                    Link("온라인 계정 삭제 안내", destination: URL(string: "https://orunvoca.co.kr/delete-account.html")!)
                    Text("아래 오프라인 단어장 삭제는 온라인 계정을 삭제하지 않습니다.").foregroundStyle(.secondary)
                }
                Section("데이터 관리") {
                    Text("기기 변경 또는 앱 삭제 전 단어장에서 TSV 파일을 공유해 보관하세요. TSV에는 복습 일정이 포함되지 않습니다.")
                    Button("오프라인 단어장 모두 삭제", role: .destructive) { confirmingReset = true }
                        .disabled(notebook.cards.isEmpty)
                }
            }
            .navigationTitle("앱 정보")
            .confirmationDialog("이 기기의 단어와 복습 기록을 모두 삭제할까요?", isPresented: $confirmingReset, titleVisibility: .visible) {
                Button("모두 삭제", role: .destructive) { notebook.removeAll() }
            }
        }
    }
}
