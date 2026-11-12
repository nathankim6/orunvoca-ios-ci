import SwiftUI
import UniformTypeIdentifiers
import AVFoundation

struct MacVocabularyTSV: FileDocument {
    static var readableContentTypes: [UTType] { [.tabSeparatedText, .plainText] }
    var text: String
    init(text: String) { self.text = text }
    init(configuration: ReadConfiguration) throws { text = String(data: configuration.file.regularFileContents ?? Data(), encoding: .utf8) ?? "" }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: Data(text.utf8)) }
}

@MainActor final class MacPronunciation: ObservableObject {
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

struct MacNotebookView: View {
    @EnvironmentObject var notebook: MacNotebookStore
    @EnvironmentObject var model: MacAppModel
    @MacValueState<String> private var search = ""
    @MacValueState<Bool> private var reviewing = false
    @MacValueState<MacVocabularyCard?> private var editing: MacVocabularyCard?
    @MacValueState<MacVocabularyCard?> private var pendingDelete: MacVocabularyCard?
    @MacValueState<String?> private var message: String?
    @StateObject private var pronunciation = MacPronunciation()
    var filtered: [MacVocabularyCard] { notebook.cards.filter { search.isEmpty || $0.word.localizedCaseInsensitiveContains(search) || $0.meaning.localizedCaseInsensitiveContains(search) } }
    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    Label("내 Mac에 저장, 어디서나 복습", systemImage: "wifi.slash").font(.headline)
                    Text("단어 \(notebook.cards.count)개 · 지금 복습 \(notebook.dueCards.count)개").foregroundStyle(.secondary)
                    Button("오늘의 복습 시작") { reviewing = true }.buttonStyle(.borderedProminent).disabled(notebook.dueCards.isEmpty)
                }.padding(.vertical, 6)
            }
            if notebook.cards.isEmpty {
                Section {
                    ContentUnavailableView("나만의 단어장을 만들어 보세요", systemImage: "rectangle.stack.badge.plus", description: Text("⌘N으로 단어를 추가하거나 ⌘O로 TSV 파일을 가져오세요. 인터넷 없이 뜻을 가리고 복습할 수 있어요."))
                }
            }
            if let error = notebook.error { Section("저장 오류") { Text(error).foregroundStyle(.red) } }
            Section("단어") {
                ForEach(filtered) { card in
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(card.word).font(.headline)
                            Text(card.meaning).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button { pronunciation.speak(card.word) } label: { Image(systemName: "speaker.wave.2") }.buttonStyle(.borderless).help("발음 듣기")
                        Button { editing = card } label: { Image(systemName: "pencil") }.buttonStyle(.borderless).help("수정")
                        Button { pendingDelete = card } label: { Image(systemName: "trash") }.buttonStyle(.borderless).help("삭제")
                    }
                    .padding(.vertical, 3)
                    .contextMenu {
                        Button("수정") { editing = card }
                        Button("삭제", role: .destructive) { pendingDelete = card }
                    }
                }
            }
        }
        .navigationTitle("오프라인 단어장")
        .searchable(text: $search, prompt: "단어 또는 뜻 검색")
        .toolbar {
            ToolbarItemGroup {
                Button("TSV 가져오기", systemImage: "square.and.arrow.down") { model.importing = true }
                Button("TSV 내보내기", systemImage: "square.and.arrow.up") { model.exporting = true }.disabled(notebook.cards.isEmpty)
                Button("단어 추가", systemImage: "plus") { model.adding = true }
            }
        }
        .sheet(isPresented: $model.adding) { MacCardEditor(card: nil) }
        .sheet(item: $editing) { MacCardEditor(card: $0) }
        .sheet(isPresented: $reviewing) { MacReviewView(queue: notebook.dueCards) }
        .fileImporter(isPresented: $model.importing, allowedContentTypes: [.tabSeparatedText, .plainText], allowsMultipleSelection: false) { result in
            do {
                guard let url = try result.get().first else { return }
                let access = url.startAccessingSecurityScopedResource()
                defer { if access { url.stopAccessingSecurityScopedResource() } }
                let values = try url.resourceValues(forKeys: [.fileSizeKey])
                guard (values.fileSize ?? 0) < 5_000_000 else { throw MacNotebookError.invalidFile }
                let text = try String(contentsOf: url, encoding: .utf8).replacingOccurrences(of: "\u{FEFF}", with: "")
                let count = try notebook.importTSV(text)
                message = "\(count)개 단어를 가져왔어요. 같은 단어와 뜻은 중복 추가하지 않습니다."
            } catch { message = error.localizedDescription }
        }
        .fileExporter(isPresented: $model.exporting, document: MacVocabularyTSV(text: notebook.exportTSV), contentType: .tabSeparatedText, defaultFilename: "orun-vocabulary") { result in
            if case .failure(let error) = result { message = error.localizedDescription }
        }
        .confirmationDialog("이 단어를 삭제할까요?", isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }), titleVisibility: .visible, presenting: pendingDelete) { card in
            Button("‘\(card.word)’ 삭제", role: .destructive) { notebook.remove(card); pendingDelete = nil }
            Button("취소", role: .cancel) { pendingDelete = nil }
        }
        .alert("단어장 안내", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
            Button("확인") { message = nil }
        } message: { Text(message ?? "") }
        .onDisappear { pronunciation.stop() }
    }
}

struct MacCardEditor: View {
    @EnvironmentObject var notebook: MacNotebookStore
    @Environment(\.dismiss) var dismiss
    let card: MacVocabularyCard?
    @MacValueState<String> private var word = ""
    @MacValueState<String> private var meaning = ""
    private var invalid: Bool {
        word.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || meaning.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || word.count > 200 || meaning.count > 1000
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(card == nil ? "단어 추가" : "단어 수정").font(.title2.bold())
            Text("영어 단어").font(.headline)
            TextField("예: discover", text: $word).textFieldStyle(.roundedBorder).autocorrectionDisabled()
            Text("뜻 / 나만의 힌트").font(.headline)
            TextField("예: 발견하다", text: $meaning, axis: .vertical).lineLimit(3...8).textFieldStyle(.roundedBorder)
            Text("단어는 200자, 뜻은 1,000자까지 저장할 수 있어요. 복습에서 ‘기억나요’를 누르면 다음 복습 간격이 늘어납니다.").font(.callout).foregroundStyle(.secondary)
            if let error = notebook.error { Text(error).foregroundStyle(.red) }
            HStack {
                Spacer()
                Button("취소") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("저장") {
                    if let card { notebook.update(card, word: word, meaning: meaning) } else { notebook.add(word: word, meaning: meaning) }
                    if notebook.error == nil { dismiss() }
                }.keyboardShortcut(.defaultAction).disabled(invalid)
            }
        }
        .padding(24).frame(width: 460)
        .onAppear { word = card?.word ?? ""; meaning = card?.meaning ?? "" }
    }
}

struct MacReviewView: View {
    @EnvironmentObject var notebook: MacNotebookStore
    @Environment(\.dismiss) var dismiss
    @StateObject private var pronunciation = MacPronunciation()
    @MacValueState<MacVocabularyReviewSession> private var session: MacVocabularyReviewSession
    @MacValueState<Bool> private var revealed = false
    init(queue: [MacVocabularyCard]) { _session = MacValueState(wrappedValue: MacVocabularyReviewSession(cards: queue)) }
    var body: some View {
        VStack(spacing: 24) {
            HStack { Text("가리고 떠올리기").font(.headline); Spacer(); Button("닫기") { dismiss() }.keyboardShortcut(.cancelAction) }
            Spacer(minLength: 0)
            if let card = session.currentCard {
                ProgressView(value: Double(session.completedCount), total: Double(session.totalCount)).accessibilityLabel("복습 진행률")
                Text("\(session.completedCount + 1) / \(session.totalCount)").foregroundStyle(.secondary)
                Text(card.word).font(.largeTitle.bold()).multilineTextAlignment(.center).textSelection(.enabled)
                Button("발음 듣기", systemImage: "speaker.wave.2") { pronunciation.speak(card.word) }.buttonStyle(.bordered)
                if revealed {
                    Text(card.meaning).font(.title2).multilineTextAlignment(.center).textSelection(.enabled)
                    HStack {
                        Button("아직 어려워요 · 10분 후", systemImage: "arrow.counterclockwise") { advance(card, remembered: false) }.buttonStyle(.bordered)
                        Button("기억나요 · 다음 복습으로", systemImage: "checkmark") { advance(card, remembered: true) }.buttonStyle(.borderedProminent)
                    }
                } else {
                    Button("뜻 확인하기") { revealed = true }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                }
            } else {
                ContentUnavailableView {
                    Label("오늘의 복습을 마쳤어요", systemImage: "checkmark.seal")
                } description: {
                    Text("총 \(session.completedCount)개를 복습했어요. 어려운 단어는 10분 뒤, 기억한 단어는 1일 이후 다시 만나요.")
                }
                Button("단어장으로") { dismiss() }.buttonStyle(.borderedProminent)
            }
            if let error = notebook.error { Text(error).foregroundStyle(.red) }
            Spacer(minLength: 0)
        }
        .padding(24).frame(width: 560, height: 420)
        .onDisappear { pronunciation.stop() }
    }
    private func advance(_ card: MacVocabularyCard, remembered: Bool) {
        notebook.review(card, remembered: remembered)
        if notebook.error == nil { session.advance(); revealed = false; pronunciation.stop() }
    }
}
