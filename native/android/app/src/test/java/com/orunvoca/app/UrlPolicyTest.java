package com.orunvoca.app;

import static org.junit.Assert.*;

import org.junit.Test;

public class UrlPolicyTest {
    @Test public void trustedHost() {
        assertTrue(UrlPolicy.isTrusted("https://orunvoca.co.kr/"));
        assertTrue(UrlPolicy.isTrusted("https://orunvoca.co.kr:443/x?y=1"));
        assertFalse(UrlPolicy.isTrusted("http://orunvoca.co.kr/"));
        assertFalse(UrlPolicy.isTrusted("https://orunvoca.co.kr.evil.com/"));
        assertFalse(UrlPolicy.isTrusted("https://user@orunvoca.co.kr/"));
        assertFalse(UrlPolicy.isTrusted("https://orunvoca.co.kr:8443/"));
        assertFalse(UrlPolicy.isTrusted("javascript:alert(1)"));
        assertFalse(UrlPolicy.isTrusted(null));
    }

    @Test public void externalSchemes() {
        assertTrue(UrlPolicy.isExternalAllowed("https://example.com"));
        assertTrue(UrlPolicy.isExternalAllowed("mailto:a@b.c"));
        assertFalse(UrlPolicy.isExternalAllowed("http://example.com"));
        assertFalse(UrlPolicy.isExternalAllowed("intent://x#Intent;end"));
        assertFalse(UrlPolicy.isExternalAllowed("file:///etc/hosts"));
    }
}
