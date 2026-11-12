import Foundation
import Combine

struct MacVocabularyCard: Identifiable, Codable, Equatable {
    var id = UUID()
    var word: String
    var meaning: String
    var due = Date()
    var intervalDays = 0
    var reviews = 0
}

@MainActor final class MacNotebookStore: ObservableObject {
    @Published private(set) var cards: [MacVocabularyCard] = []
    @Published var error: String?
    private let file: URL
    init(storageURL: URL? = nil) {
        let directory = storageURL?.deletingLastPathComponent() ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        file = storageURL ?? directory.appendingPathComponent("offline-vocabulary-v1.json")
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            if FileManager.default.fileExists(atPath: file.path) {
                cards = try JSONDecoder().decode([MacVocabularyCard].self, from: Data(contentsOf: file))
            }
        } catch { self.error = "단어장을 읽지 못했어요. 기존 파일은 덮어쓰지 않았습니다. 앱을 다시 열어 주세요." }
    }
    var dueCards: [MacVocabularyCard] { cards.filter { $0.due <= Date() }.sorted { $0.due < $1.due } }
    func add(word: String, meaning: String) {
        let word = word.trimmingCharacters(in: .whitespacesAndNewlines)
        let meaning = meaning.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !word.isEmpty, !meaning.isEmpty else { return }
        commit(cards + [MacVocabularyCard(word: String(word.prefix(200)), meaning: String(meaning.prefix(1000)))])
    }
    func update(_ card: MacVocabularyCard, word: String, meaning: String) {
        var updated = cards
        guard let index = updated.firstIndex(where: { $0.id == card.id }) else { return }
        updated[index].word = String(word.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200))
        updated[index].meaning = String(meaning.trimmingCharacters(in: .whitespacesAndNewlines).prefix(1000))
        commit(updated)
    }
    func remove(_ card: MacVocabularyCard) { commit(cards.filter { $0.id != card.id }) }
    func removeAll() { commit([]) }
    func review(_ card: MacVocabularyCard, remembered: Bool) {
        var updated = cards
        guard let index = updated.firstIndex(where: { $0.id == card.id }) else { return }
        updated[index].reviews += 1
        let days = remembered ? min(max(1, updated[index].intervalDays * 2), 64) : 0
        updated[index].intervalDays = days
        updated[index].due = Date().addingTimeInterval(remembered ? Double(days) * 86400 : 600)
        commit(updated)
    }
    func importTSV(_ text: String) throws -> Int {
        let lines = text.components(separatedBy: .newlines).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        guard lines.count <= 10000 else { throw MacNotebookError.invalidFile }
        var imported = cards
        var count = 0
        for (index, line) in lines.enumerated() {
            let values = line.components(separatedBy: "\t")
            if index == 0, values.first?.lowercased() == "word", values.dropFirst().first?.lowercased() == "meaning" { continue }
            guard values.count == 2 else { throw MacNotebookError.invalidFile }
            let word = values[0].trimmingCharacters(in: .whitespacesAndNewlines)
            let meaning = values[1].trimmingCharacters(in: .whitespacesAndNewlines)
            guard !word.isEmpty, !meaning.isEmpty, word.count <= 200, meaning.count <= 1000 else { throw MacNotebookError.invalidFile }
            if !imported.contains(where: { $0.word.caseInsensitiveCompare(word) == .orderedSame && $0.meaning == meaning }) {
                imported.append(MacVocabularyCard(word: word, meaning: meaning)); count += 1
            }
        }
        guard count > 0 else { return 0 }
        guard commit(imported) else { throw MacNotebookError.saveFailed }
        return count
    }
    var exportTSV: String {
        func clean(_ value: String) -> String { value.replacingOccurrences(of: "\t", with: " ").replacingOccurrences(of: "\n", with: " ").replacingOccurrences(of: "\r", with: " ") }
        return "word\tmeaning\n" + cards.map { "\(clean($0.word))\t\(clean($0.meaning))" }.joined(separator: "\n")
    }
    @discardableResult private func commit(_ updated: [MacVocabularyCard]) -> Bool {
        do {
            // A read failure must not replace an unreadable user's original file.
            guard error == nil else { return false }
            let data = try JSONEncoder().encode(updated)
            try data.write(to: file, options: [.atomic])
            cards = updated
            return true
        } catch { self.error = "저장하지 못했어요. 변경 사항은 적용되지 않았습니다. 저장 공간을 확인하고 앱을 다시 열어 주세요."; return false }
    }
}
enum MacNotebookError: LocalizedError {
    case invalidFile, saveFailed
    var errorDescription: String? {
        switch self {
        case .invalidFile: "UTF-8 TSV 파일을 확인해 주세요. 각 줄은 단어와 뜻 두 열을 탭으로 구분하며 최대 10,000줄까지 가져올 수 있습니다."
        case .saveFailed: "단어장을 저장하지 못했어요. 저장 공간을 확인해 주세요."
        }
    }
}

// A running review owns an immutable snapshot. Store updates must not shrink or reorder it.
struct MacVocabularyReviewSession {
    let cards: [MacVocabularyCard]
    private(set) var completedCount = 0
    var totalCount: Int { cards.count }
    var currentCard: MacVocabularyCard? { completedCount < totalCount ? cards[completedCount] : nil }
    var isComplete: Bool { currentCard == nil }
    mutating func advance() {
        guard !isComplete else { return }
        completedCount += 1
    }
}
