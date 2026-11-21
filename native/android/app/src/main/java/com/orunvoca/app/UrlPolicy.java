package com.orunvoca.app;

import java.net.URI;

/** Decides which URLs may load inside the app WebView. Everything else goes to the system browser. */
public final class UrlPolicy {
    public static final String HOST = "orunvoca.co.kr";
    public static final String HOME = "https://orunvoca.co.kr/";
    public static final String PRIVACY = "https://orunvoca.co.kr/privacy.html";
    public static final String SUPPORT = "https://orunvoca.co.kr/support.html";
    public static final String DELETE_ACCOUNT = "https://orunvoca.co.kr/delete-account.html";

    private UrlPolicy() { }

    /** True only for https://orunvoca.co.kr[:443]/... without credentials. */
    public static boolean isTrusted(String url) {
        if (url == null) return false;
        try {
            URI u = new URI(url);
            return "https".equalsIgnoreCase(u.getScheme())
                    && HOST.equalsIgnoreCase(u.getHost())
                    && (u.getPort() == -1 || u.getPort() == 443)
                    && u.getUserInfo() == null;
        } catch (Exception e) {
            return false;
        }
    }

    /** True for schemes that may be handed to an external app (browser, mail, phone dialer). */
    public static boolean isExternalAllowed(String url) {
        if (url == null) return false;
        try {
            String s = new URI(url).getScheme();
            if (s == null) return false;
            s = s.toLowerCase(java.util.Locale.ROOT);
            return s.equals("https") || s.equals("mailto") || s.equals("tel");
        } catch (Exception e) {
            return false;
        }
    }
}
