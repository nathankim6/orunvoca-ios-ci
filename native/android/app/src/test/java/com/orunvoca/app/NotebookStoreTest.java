package com.orunvoca.app;

import static org.junit.Assert.*;

import java.io.File;
import java.nio.file.Files;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class NotebookStoreTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private long now = 1_000_000L;

    private NotebookStore open(File f) { return new NotebookStore(f, () -> now); }

    @Test public void addEditDeleteSearchPersist() throws Exception {
        File f = new File(tmp.getRoot(), "n.txt");
        NotebookStore s = open(f);
        assertTrue(s.add("apple", "사과"));
        assertTrue(s.add("tab\tword", "line1\nline2 \\ x"));
        assertFalse(s.add(" ", "x"));
        NotebookStore again = open(f);
        assertEquals(2, again.size());
        assertEquals("line1\nline2 \\ x", again.all().get(1).meaning);
        assertEquals(1, again.search("사").size());
        assertEquals(1, again.search("APP").size());
        String id = again.all().get(0).id;
        assertTrue(again.update(id, "apples", "사과들"));
        assertEquals("apples", open(f).all().get(0).word);
        assertTrue(again.remove(id));
        assertEquals(1, open(f).size());
    }

    @Test public void reviewSchedules() {
        NotebookStore s = open(new File(tmp.getRoot(), "n.txt"));
        s.add("a", "b");
        String id = s.all().get(0).id;
        assertEquals(1, s.dueCards().size());
        s.review(id, true);
        assertEquals(1, s.find(id).intervalDays);
        assertEquals(0, s.dueCards().size());
        s.review(id, true);
        assertEquals(2, s.find(id).intervalDays);
        s.review(id, false);
        assertEquals(0, s.find(id).intervalDays);
        assertEquals(now + NotebookStore.RETRY_MILLIS, s.find(id).dueMillis);
        assertEquals(3, s.find(id).reviews);
    }

    @Test public void tsvRoundTripAndValidation() throws Exception {
        NotebookStore s = open(new File(tmp.getRoot(), "n.txt"));
        assertEquals(2, s.importTsv("word\tmeaning\nfoo\t푸\nbar\t바\n"));
        assertEquals(0, s.importTsv("FOO\t푸"));
        assertEquals("word\tmeaning\nfoo\t푸\nbar\t바", s.exportTsv());
        try { s.importTsv("bad line no tab"); fail(); } catch (NotebookStore.InvalidFileException expected) { }
        assertEquals(2, s.size());
    }

    @Test public void corruptFileIsNotOverwritten() throws Exception {
        File f = new File(tmp.getRoot(), "n.txt");
        Files.write(f.toPath(), "garbage".getBytes("UTF-8"));
        NotebookStore s = open(f);
        assertNotNull(s.error());
        assertFalse(s.add("a", "b"));
        assertEquals("garbage", new String(Files.readAllBytes(f.toPath()), "UTF-8"));
    }
}
