import SwiftUI
import UniformTypeIdentifiers
import AVFoundation

struct VocabularyTSV: FileDocument {
    static var readableContentTypes: [UTType] { [.tabSeparatedText, .plainText] }
    var text: String
    init(text: String) { self.text = text }
    init(configuration: ReadConfiguration) throws { text = String(data: configuration.file.regularFileContents ?? Data(), encoding: .utf8) ?? "" }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: Data(text.utf8)) }
}
@MainActor final class Pronunciation: ObservableObject {
    private let synthesizer = AVSpeechSynthesizer()
    func speak(_ word: String) {
        synthesizer.stopSpeaking(at: .immediate)
        let utterance = AVSpeechUtterance(string: word)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        utterance.rate = 0.43
        synthesizer.speak(utterance)
    }
    func stop() { synthesizer.stopSpeaking(at: .immediate) }
}
struct NotebookView: View {
    @EnvironmentObject var notebook: NotebookStore
    @ValueState<String> private var search = ""
    @ValueState<Bool> private var adding = false
    @ValueState<Bool> private var importing = false
    @ValueState<Bool> private var exporting = false
    @ValueState<Bool> private var reviewing = false
    @ValueState<String?> private var message: String?
    var filtered: [VocabularyCard] { notebook.cards.filter { search.isEmpty || $0.word.localizedCaseInsensitiveContains(search) || $0.meaning.localizedCaseInsensitiveContains(search) } }
    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 12) {
                        Label("내 기기에 저장, 어디서나 복습", systemImage: "wifi.slash").font(.headline)
                        Text("단어 \(notebook.cards.count)개 · 지금 복습 \(notebook.dueCards.count)개").foregroundStyle(.secondary)
                        Button("오늘의 복습 시작") { reviewing = true }
                            .buttonStyle(.borderedProminent).disabled(notebook.dueCards.isEmpty)
                    }.padding(.vertical, 8)
                }
                if notebook.cards.isEmpty {
                    Section {
                        ContentUnavailableView("나만의 단어장을 만들어 보세요", systemImage: "rectangle.stack.badge.plus", description: Text("+ 버튼으로 단어를 추가하거나 TSV 파일을 가져오세요. 인터넷 없이 뜻을 가리고 복습할 수 있어요."))
                    }
                }
                if let error = notebook.error {
                    Section("저장 오류") { Text(error).foregroundStyle(.red) }
                }
                Section("단어") {
                    ForEach(filtered) { card in
                        NavigationLink { CardEditor(card: card) } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(card.word).font(.headline)
                                Text(card.meaning).foregroundStyle(.secondary)
                            }.padding(.vertical, 4)
                        }
                        .swipeActions { Button("삭제", role: .destructive) { notebook.remove(card) } }
                    }
                }
            }
            .navigationTitle("오프라인 단어장")
            .searchable(text: $search, prompt: "단어 또는 뜻 검색")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        Button("TSV 가져오기", systemImage: "square.and.arrow.down") { importing = true }
                        Button("TSV 내보내기", systemImage: "square.and.arrow.up") { exporting = true }.disabled(notebook.cards.isEmpty)
                    } label: { Label("파일", systemImage: "ellipsis.circle") }
                }
                ToolbarItem(placement: .topBarTrailing) { Button("단어 추가", systemImage: "plus") { adding = true } }
            }
            .sheet(isPresented: $adding) { NavigationStack { CardEditor(card: nil) } }
            .sheet(isPresented: $reviewing) { NavigationStack { ReviewView(queue: notebook.dueCards) } }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.tabSeparatedText, .plainText], allowsMultipleSelection: false) { result in
                do {
                    guard let url = try result.get().first else { return }
                    let access = url.startAccessingSecurityScopedResource()
                    defer { if access { url.stopAccessingSecurityScopedResource() } }
                    let values = try url.resourceValues(forKeys: [.fileSizeKey])
                    guard (values.fileSize ?? 0) < 5_000_000 else { throw NotebookError.invalidFile }
                    let text = try String(contentsOf: url, encoding: .utf8).replacingOccurrences(of: "\u{FEFF}", with: "")
                    let count = try notebook.importTSV(text)
                    message = "\(count)개 단어를 가져왔어요. 같은 단어와 뜻은 중복 추가하지 않습니다."
                } catch { message = error.localizedDescription }
            }
            .fileExporter(isPresented: $exporting, document: VocabularyTSV(text: notebook.exportTSV), contentType: .tabSeparatedText, defaultFilename: "orun-vocabulary") { result in
                if case .failure(let error) = result { message = error.localizedDescription }
            }
            .alert("단어장 안내", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
                Button("확인") { message = nil }
            } message: { Text(message ?? "") }
        }
    }
}
struct CardEditor: View {
    @EnvironmentObject var notebook: NotebookStore
    @Environment(\.dismiss) var dismiss
    let card: VocabularyCard?
    @ValueState<String> private var word = ""
    @ValueState<String> private var meaning = ""
    var body: some View {
        Form {
            Section("영어 단어") { TextField("예: discover", text: $word).textInputAutocapitalization(.never).autocorrectionDisabled() }
            Section("뜻 / 나만의 힌트") { TextField("예: 발견하다", text: $meaning, axis: .vertical).lineLimit(3...8).accessibilityIdentifier("native-card-meaning") }
            Section { Text("단어는 200자, 뜻은 1,000자까지 저장할 수 있어요. 복습에서 ‘기억나요’를 누르면 다음 복습 간격이 늘어납니다.").foregroundStyle(.secondary) }
        }
        .navigationTitle(card == nil ? "단어 추가" : "단어 수정")
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("취소") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("저장") {
                    if let card { notebook.update(card, word: word, meaning: meaning) } else { notebook.add(word: word, meaning: meaning) }
                    if notebook.error == nil { dismiss() }
                }.disabled(word.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || meaning.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || word.count > 200 || meaning.count > 1000)
            }
        }
        .onAppear { word = card?.word ?? ""; meaning = card?.meaning ?? "" }
    }
}
struct ReviewView: View {
    @EnvironmentObject var notebook: NotebookStore
    @Environment(\.dismiss) var dismiss
    @StateObject private var pronunciation = Pronunciation()
    let queue: [VocabularyCard]
    @ValueState<Int> private var index = 0
    @ValueState<Bool> private var revealed = false
    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                if index < queue.count {
                    let card = queue[index]
                    ProgressView(value: Double(index), total: Double(queue.count)).accessibilityLabel("복습 진행률")
                    Text("\(index + 1) / \(queue.count)").foregroundStyle(.secondary)
                    Text(card.word).font(.largeTitle.bold()).multilineTextAlignment(.center).textSelection(.enabled)
                    Button("발음 듣기", systemImage: "speaker.wave.2") { pronunciation.speak(card.word) }.buttonStyle(.bordered)
                    if revealed {
                        Text(card.meaning).font(.title2).multilineTextAlignment(.center).accessibilityAddTraits(.updatesFrequently)
                        Button("아직 어려워요 · 10분 후", systemImage: "arrow.counterclockwise") { advance(card, remembered: false) }.buttonStyle(.bordered)
                        Button("기억나요 · 다음 복습으로", systemImage: "checkmark") { advance(card, remembered: true) }.buttonStyle(.borderedProminent)
                    } else {
                        Button("뜻 확인하기") { revealed = true }.buttonStyle(.borderedProminent)
                    }
                } else {
                    ContentUnavailableView("오늘의 복습을 마쳤어요", systemImage: "checkmark.seal", description: Text("총 \(queue.count)개를 복습했어요. 어려운 단어는 10분 뒤, 기억한 단어는 1일 이후 다시 만나요."))
                    Button("단어장으로") { dismiss() }.buttonStyle(.borderedProminent)
                }
            }.frame(maxWidth: 600).padding(28).frame(maxWidth: .infinity)
        }
        .navigationTitle("가리고 떠올리기")
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() } } }
        .onDisappear { pronunciation.stop() }
    }
    private func advance(_ card: VocabularyCard, remembered: Bool) {
        notebook.review(card, remembered: remembered)
        if notebook.error == nil { index += 1; revealed = false; pronunciation.stop() }
    }
}
