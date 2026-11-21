package com.orunvoca.app;

import java.io.UnsupportedEncodingException;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;

/**
 * Staff Google sign-in hand-off. Google refuses embedded WebViews, so only the project's
 * Supabase authorize request is moved to a Custom Tab with an app-only callback, and the
 * result is loaded back into the trusted orunvoca.co.kr page. Pure Java for unit tests.
 */
public final class NativeAuth {
    public static final String SCHEME = "com.orunvoca.app";
    public static final String CALLBACK_HOST = "auth-callback";
    public static final String CALLBACK = SCHEME + "://" + CALLBACK_HOST;
    public static final String AUTH_HOST = "jpanpwbdlhsxnyaldddm.supabase.co";
    public static final long MAX_PENDING_MS = 15 * 60 * 1000L;

    private NativeAuth() { }

    /** True only for https://AUTH_HOST[:443]/auth/v1/authorize without credentials. */
    public static boolean isAuthorize(String url) {
        if (url == null) return false;
        try {
            URI u = new URI(url);
            return "https".equalsIgnoreCase(u.getScheme()) && AUTH_HOST.equalsIgnoreCase(u.getHost())
                    && (u.getPort() == -1 || u.getPort() == 443) && u.getUserInfo() == null
                    && "/auth/v1/authorize".equals(u.getPath());
        } catch (Exception e) {
            return false;
        }
    }

    /** Returns {authorizeUrlForApp, trustedReturnUrl} or null when the request is not acceptable. */
    public static String[] rewrite(String authorizeUrl) {
        if (!isAuthorize(authorizeUrl)) return null;
        int q = authorizeUrl.indexOf('?');
        String base = q < 0 ? authorizeUrl : authorizeUrl.substring(0, q);
        String query = q < 0 ? "" : authorizeUrl.substring(q + 1);
        int hash = query.indexOf('#');
        if (hash >= 0) query = query.substring(0, hash);
        StringBuilder kept = new StringBuilder();
        String requested = null;
        for (String part : query.split("&")) {
            if (part.isEmpty()) continue;
            String key = part.contains("=") ? part.substring(0, part.indexOf('=')) : part;
            if ("redirect_to".equals(key)) {
                requested = decode(part.substring(Math.min(part.length(), key.length() + 1)));
                continue;
            }
            if (kept.length() > 0) kept.append('&');
            kept.append(part);
        }
        String returnUrl = requested != null && UrlPolicy.isTrusted(requested) ? stripFragment(requested) : UrlPolicy.HOME;
        if (kept.length() > 0) kept.append('&');
        kept.append("redirect_to=").append(encode(CALLBACK));
        String rewritten = base + "?" + kept;
        return isAuthorize(rewritten) ? new String[] { rewritten, returnUrl } : null;
    }

    /** True for com.orunvoca.app://auth-callback[?...][#...] only. */
    public static boolean isCallback(String url) {
        if (url == null) return false;
        try {
            URI u = new URI(url);
            return SCHEME.equalsIgnoreCase(u.getScheme()) && CALLBACK_HOST.equalsIgnoreCase(u.getHost())
                    && u.getUserInfo() == null && (u.getPath() == null || u.getPath().isEmpty() || "/".equals(u.getPath()));
        } catch (Exception e) {
            return false;
        }
    }

    /** Builds the trusted page URL that lets the web client finish the session, or null. */
    public static String completion(String returnUrl, String callbackUrl) {
        if (!UrlPolicy.isTrusted(returnUrl) || !isCallback(callbackUrl)) return null;
        String fragment = "";
        String query = "";
        int hash = callbackUrl.indexOf('#');
        String head = hash >= 0 ? callbackUrl.substring(0, hash) : callbackUrl;
        if (hash >= 0) fragment = callbackUrl.substring(hash + 1);
        int q = head.indexOf('?');
        if (q >= 0) query = head.substring(q + 1);
        String target = stripFragment(returnUrl);
        String code = null;
        StringBuilder errors = new StringBuilder();
        for (String part : query.split("&")) {
            if (part.isEmpty()) continue;
            if (part.startsWith("code=")) code = part.substring(5);
            else if (part.startsWith("error")) { if (errors.length() > 0) errors.append('&'); errors.append(part); }
        }
        boolean carried = false;
        if (code != null && code.matches("[A-Za-z0-9._~-]{1,512}")) {
            target += (target.contains("?") ? "&" : "?") + "code=" + code;
            carried = true;
        }
        if (!fragment.isEmpty()) { target += "#" + fragment; carried = true; }
        else if (errors.length() > 0) { target += "#" + errors; carried = true; }
        if (!carried) return null;
        return UrlPolicy.isTrusted(target) ? target : null;
    }

    private static String stripFragment(String url) {
        int hash = url.indexOf('#');
        return hash >= 0 ? url.substring(0, hash) : url;
    }

    private static String decode(String s) {
        try { return URLDecoder.decode(s, "UTF-8"); } catch (UnsupportedEncodingException | IllegalArgumentException e) { return null; }
    }

    private static String encode(String s) {
        try { return URLEncoder.encode(s, "UTF-8"); } catch (UnsupportedEncodingException e) { throw new IllegalStateException(e); }
    }
}
