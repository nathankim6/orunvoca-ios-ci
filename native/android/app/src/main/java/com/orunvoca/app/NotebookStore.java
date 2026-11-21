package com.orunvoca.app;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * Offline vocabulary notebook persisted in a private app file. Pure Java so it is unit-testable.
 * Behavior mirrors the iOS NotebookStore (limits, review intervals, TSV rules).
 */
public final class NotebookStore {
    public static final int MAX_WORD = 200;
    public static final int MAX_MEANING = 1000;
    public static final int MAX_IMPORT_LINES = 10000;
    public static final long RETRY_MILLIS = 10 * 60 * 1000L;
    private static final long DAY = 86400000L;

    public static final class InvalidFileException extends Exception {
        public InvalidFileException() { super("invalid tsv"); }
    }

    public interface Clock { long now(); }

    private final File file;
    private final Clock clock;
    private final List<VocabularyCard> cards = new ArrayList<>();
    private String error;

    public NotebookStore(File file) { this(file, System::currentTimeMillis); }

    public NotebookStore(File file, Clock clock) {
        this.file = file;
        this.clock = clock;
        load();
    }

    /** Non-null when the file existed but could not be read; writes are then refused so it is never overwritten. */
    public String error() { return error; }

    public List<VocabularyCard> all() { return Collections.unmodifiableList(new ArrayList<>(cards)); }

    public int size() { return cards.size(); }

    public VocabularyCard find(String id) {
        for (VocabularyCard c : cards) if (c.id.equals(id)) return c;
        return null;
    }

    public List<VocabularyCard> search(String query) {
        String q = query == null ? "" : query.trim().toLowerCase(Locale.ROOT);
        List<VocabularyCard> out = new ArrayList<>();
        for (VocabularyCard c : cards) {
            if (q.isEmpty() || c.word.toLowerCase(Locale.ROOT).contains(q) || c.meaning.toLowerCase(Locale.ROOT).contains(q)) out.add(c);
        }
        return out;
    }

    public List<VocabularyCard> dueCards() {
        long now = clock.now();
        List<VocabularyCard> out = new ArrayList<>();
        for (VocabularyCard c : cards) if (c.dueMillis <= now) out.add(c);
        Collections.sort(out, (a, b) -> Long.compare(a.dueMillis, b.dueMillis));
        return out;
    }

    public boolean add(String word, String meaning) {
        word = word == null ? "" : word.trim();
        meaning = meaning == null ? "" : meaning.trim();
        if (word.isEmpty() || meaning.isEmpty()) return false;
        List<VocabularyCard> next = new ArrayList<>(cards);
        next.add(VocabularyCard.create(clip(word, MAX_WORD), clip(meaning, MAX_MEANING), clock.now()));
        return commit(next);
    }

    public boolean update(String id, String word, String meaning) {
        word = word == null ? "" : word.trim();
        meaning = meaning == null ? "" : meaning.trim();
        if (word.isEmpty() || meaning.isEmpty()) return false;
        List<VocabularyCard> next = new ArrayList<>(cards);
        for (int i = 0; i < next.size(); i++) {
            if (next.get(i).id.equals(id)) {
                next.set(i, next.get(i).withText(clip(word, MAX_WORD), clip(meaning, MAX_MEANING)));
                return commit(next);
            }
        }
        return false;
    }

    public boolean remove(String id) {
        List<VocabularyCard> next = new ArrayList<>();
        boolean found = false;
        for (VocabularyCard c : cards) { if (c.id.equals(id)) found = true; else next.add(c); }
        return found && commit(next);
    }

    public boolean removeAll() { return commit(new ArrayList<>()); }

    public boolean review(String id, boolean remembered) {
        List<VocabularyCard> next = new ArrayList<>(cards);
        for (int i = 0; i < next.size(); i++) {
            VocabularyCard c = next.get(i);
            if (c.id.equals(id)) {
                int days = remembered ? Math.min(Math.max(1, c.intervalDays * 2), 64) : 0;
                long due = clock.now() + (remembered ? days * DAY : RETRY_MILLIS);
                next.set(i, new VocabularyCard(c.id, c.word, c.meaning, due, days, c.reviews + 1));
                return commit(next);
            }
        }
        return false;
    }

    /** @return number of newly imported cards. Whole file is rejected if any line is malformed. */
    public int importTsv(String text) throws InvalidFileException {
        List<String> lines = new ArrayList<>();
        for (String line : text.split("\\r\\n|\\n|\\r", -1)) if (!line.trim().isEmpty()) lines.add(line);
        if (lines.size() > MAX_IMPORT_LINES) throw new InvalidFileException();
        List<VocabularyCard> next = new ArrayList<>(cards);
        int count = 0;
        long now = clock.now();
        for (int i = 0; i < lines.size(); i++) {
            String[] v = lines.get(i).split("\t", -1);
            if (i == 0 && v.length >= 2 && v[0].trim().equalsIgnoreCase("word") && v[1].trim().equalsIgnoreCase("meaning")) continue;
            if (v.length != 2) throw new InvalidFileException();
            String word = v[0].trim(), meaning = v[1].trim();
            if (word.isEmpty() || meaning.isEmpty() || word.length() > MAX_WORD || meaning.length() > MAX_MEANING) throw new InvalidFileException();
            boolean dup = false;
            for (VocabularyCard c : next) {
                if (c.word.equalsIgnoreCase(word) && c.meaning.equals(meaning)) { dup = true; break; }
            }
            if (!dup) { next.add(VocabularyCard.create(word, meaning, now)); count++; }
        }
        if (count == 0) return 0;
        if (!commit(next)) throw new InvalidFileException();
        return count;
    }

    public String exportTsv() {
        StringBuilder sb = new StringBuilder("word\tmeaning");
        for (VocabularyCard c : cards) sb.append('\n').append(clean(c.word)).append('\t').append(clean(c.meaning));
        return sb.toString();
    }

    private static String clean(String s) { return s.replace('\t', ' ').replace('\n', ' ').replace('\r', ' '); }

    private static String clip(String s, int max) { return s.length() <= max ? s : s.substring(0, max); }

    // ---- persistence: one card per line, tab separated, backslash-escaped text fields ----

    private static String esc(String s) {
        return s.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r");
    }

    private static String unesc(String s) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (ch == '\\' && i + 1 < s.length()) {
                char n = s.charAt(++i);
                sb.append(n == 't' ? '\t' : n == 'n' ? '\n' : n == 'r' ? '\r' : n);
            } else sb.append(ch);
        }
        return sb.toString();
    }

    private void load() {
        if (!file.exists()) return;
        try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
            List<VocabularyCard> loaded = new ArrayList<>();
            String line;
            while ((line = r.readLine()) != null) {
                if (line.isEmpty()) continue;
                String[] p = line.split("\t", -1);
                if (p.length != 6) throw new IOException("bad line");
                loaded.add(new VocabularyCard(p[0], unesc(p[1]), unesc(p[2]), Long.parseLong(p[3]), Integer.parseInt(p[4]), Integer.parseInt(p[5])));
            }
            cards.addAll(loaded);
        } catch (IOException | NumberFormatException e) {
            cards.clear();
            error = "단어장을 읽지 못했어요. 기존 파일은 덮어쓰지 않았습니다. 앱을 다시 열어 주세요.";
        }
    }

    private boolean commit(List<VocabularyCard> updated) {
        if (error != null) return false;
        File tmp = new File(file.getParentFile(), file.getName() + ".tmp");
        try {
            File dir = file.getParentFile();
            if (dir != null && !dir.exists() && !dir.mkdirs()) throw new IOException("mkdir");
            try (FileOutputStream out = new FileOutputStream(tmp);
                 Writer w = new OutputStreamWriter(out, StandardCharsets.UTF_8)) {
                for (VocabularyCard c : updated) {
                    w.write(c.id + "\t" + esc(c.word) + "\t" + esc(c.meaning) + "\t" + c.dueMillis + "\t" + c.intervalDays + "\t" + c.reviews + "\n");
                }
                w.flush();
                out.getFD().sync();
            }
            if (!tmp.renameTo(file)) {
                if (file.exists() && !file.delete()) throw new IOException("replace");
                if (!tmp.renameTo(file)) throw new IOException("rename");
            }
            cards.clear();
            cards.addAll(updated);
            return true;
        } catch (IOException e) {
            tmp.delete();
            return false;
        }
    }
}
