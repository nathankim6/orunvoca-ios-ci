package com.orunvoca.app;

import static org.junit.Assert.*;

import org.junit.Test;

public class NativeAuthTest {
    private static final String AUTH = "https://jpanpwbdlhsxnyaldddm.supabase.co/auth/v1/authorize?provider=google&redirect_to=https%3A%2F%2Forunvoca.co.kr%2F&query_params=x&prompt=select_account";

    @Test public void recognisesOnlyTheProjectAuthorizeEndpoint() {
        assertTrue(NativeAuth.isAuthorize(AUTH));
        assertFalse(NativeAuth.isAuthorize("http://jpanpwbdlhsxnyaldddm.supabase.co/auth/v1/authorize"));
        assertFalse(NativeAuth.isAuthorize("https://evil.supabase.co/auth/v1/authorize"));
        assertFalse(NativeAuth.isAuthorize("https://jpanpwbdlhsxnyaldddm.supabase.co/auth/v1/token"));
        assertFalse(NativeAuth.isAuthorize("https://u@jpanpwbdlhsxnyaldddm.supabase.co/auth/v1/authorize"));
        assertFalse(NativeAuth.isAuthorize("https://accounts.google.com/o/oauth2/v2/auth"));
        assertFalse(NativeAuth.isAuthorize(null));
    }

    @Test public void rewritesRedirectToTheAppCallbackAndKeepsTrustedReturn() {
        String[] r = NativeAuth.rewrite(AUTH);
        assertNotNull(r);
        assertTrue(r[0].contains("redirect_to=com.orunvoca.app%3A%2F%2Fauth-callback"));
        assertFalse(r[0].contains("orunvoca.co.kr"));
        assertTrue(r[0].contains("provider=google"));
        assertTrue(r[0].contains("prompt=select_account"));
        assertEquals("https://orunvoca.co.kr/", r[1]);
    }

    @Test public void untrustedRequestedReturnFallsBackHome() {
        String[] r = NativeAuth.rewrite("https://jpanpwbdlhsxnyaldddm.supabase.co/auth/v1/authorize?provider=google&redirect_to=https%3A%2F%2Fevil.example%2F");
        assertNotNull(r);
        assertEquals(UrlPolicy.HOME, r[1]);
    }

    @Test public void callbackShape() {
        assertTrue(NativeAuth.isCallback("com.orunvoca.app://auth-callback#access_token=a"));
        assertTrue(NativeAuth.isCallback("com.orunvoca.app://auth-callback?code=abc"));
        assertFalse(NativeAuth.isCallback("com.orunvoca.app://other#access_token=a"));
        assertFalse(NativeAuth.isCallback("https://auth-callback/#x"));
        assertFalse(NativeAuth.isCallback(null));
    }

    @Test public void completionCarriesTokensOnlyIntoTrustedPage() {
        assertEquals("https://orunvoca.co.kr/#access_token=a&refresh_token=b&type=bearer",
                NativeAuth.completion("https://orunvoca.co.kr/", "com.orunvoca.app://auth-callback#access_token=a&refresh_token=b&type=bearer"));
        assertEquals("https://orunvoca.co.kr/teacher?code=abc-123",
                NativeAuth.completion("https://orunvoca.co.kr/teacher", "com.orunvoca.app://auth-callback?code=abc-123"));
        assertEquals("https://orunvoca.co.kr/#error=access_denied&error_description=x",
                NativeAuth.completion("https://orunvoca.co.kr/", "com.orunvoca.app://auth-callback?error=access_denied&error_description=x"));
        assertNull(NativeAuth.completion("https://evil.example/", "com.orunvoca.app://auth-callback#access_token=a"));
        assertNull(NativeAuth.completion("https://orunvoca.co.kr/", "com.orunvoca.app://other#access_token=a"));
        assertNull(NativeAuth.completion("https://orunvoca.co.kr/", "com.orunvoca.app://auth-callback"));
        assertNull(NativeAuth.completion("https://orunvoca.co.kr/", "com.orunvoca.app://auth-callback?code=a%22%3E%3Cscript"));
    }
}
