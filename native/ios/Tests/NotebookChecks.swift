import Foundation
@main struct NotebookChecks {
    @MainActor static func main() throws {
        let url = URL(fileURLWithPath: CommandLine.arguments[1]).appendingPathComponent("notebook-test.json")
        defer { try? FileManager.default.removeItem(at: url) }
        let store = NotebookStore(storageURL: url)
        store.add(word: " discover ", meaning: "발견하다")
        assert(store.cards.count == 1 && store.cards[0].word == "discover")
        assert(store.dueCards.count == 1)
        store.review(store.cards[0], remembered: true)
        assert(store.cards[0].intervalDays == 1 && store.dueCards.isEmpty)
        store.review(store.cards[0], remembered: true)
        assert(store.cards[0].intervalDays == 2)
        store.review(store.cards[0], remembered: false)
        assert(store.cards[0].intervalDays == 0 && store.cards[0].due > Date())
        let imported = try store.importTSV("word\tmeaning\nfocus\t집중하다\ndiscover\t발견하다\n")
        assert(imported == 1 && store.cards.count == 2)
        do { _ = try store.importTSV("good\t좋다\nbad-line"); assertionFailure("Expected invalid TSV") } catch {}
        assert(store.cards.count == 2, "Imports must be atomic")
        let reopened = NotebookStore(storageURL: url)
        assert(reopened.cards == store.cards)
        assert(store.exportTSV.contains("focus\t집중하다"))
        store.removeAll(); assert(store.cards.isEmpty)
        print("PASS: add/trim, due queue, review scheduling, duplicate import, atomic invalid import, persistence, export, delete")
    }
}
