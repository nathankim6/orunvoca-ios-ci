package com.orunvoca.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.Window;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.widget.ImageView;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** Full-screen online study WebView. Existing offline notebook data remains on device. */
public class MainActivity extends Activity implements TextToSpeech.OnInitListener {
    private static final int REQ_FILE_CHOOSER = 1;
    private static final int REQ_IMPORT = 2;
    private static final int REQ_EXPORT = 3;
    private static final int MAX_IMPORT_BYTES = 5 * 1024 * 1024;

    private WebView web;
    private ProgressBar progress;
    private View webError;
    private LinearLayout webPane;
    private LinearLayout notebookPane;
    private ScrollView infoPane;
    private ValueCallback<Uri[]> fileCallback;

    private NotebookStore store;
    private TextView summary;
    private TextView storeError;
    private EditText searchBox;
    private ListView list;
    private ArrayAdapter<VocabularyCard> adapter;
    private final List<VocabularyCard> shown = new ArrayList<>();

    // Native shell: brand palette, page-matched system-bar strips, splash, Google sign-in hand-off.
    private static final int NAVY = 0xFF183160;
    private static final int PAPER = 0xFFF5F7FA;
    private static final int INK = 0xFF121D30;
    private static final int ACTION = 0xFF1B3470;
    private static final int BEAM = 0xFFF6BE1E;
    private View topBar;
    private View bottomBar;
    private FrameLayout splash;
    private boolean splashHidden;
    private boolean topDark;
    private boolean bottomDark;
    private boolean authInFlight;
    private String shellScript;
    private SharedPreferences authPrefs;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private android.net.ConnectivityManager.NetworkCallback networkCallback;

    private TextToSpeech tts;
    private boolean ttsReady;
    private final Map<String, JavaScriptReplyProxy> speechReplies = new HashMap<>();
    private String speechScript;
    private int dp;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        dp = Math.round(getResources().getDisplayMetrics().density);
        store = new NotebookStore(new File(getFilesDir(), "offline-vocabulary-v1.tsv"));
        tts = new TextToSpeech(getApplicationContext(), this);
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String id) { }
            @Override public void onDone(String id) {
                runOnUiThread(() -> finishSpeech(id, "finished"));
            }
            @Override public void onError(String id) {
                runOnUiThread(() -> finishSpeech(id, "failed"));
            }
            @Override public void onStop(String id, boolean interrupted) {
                runOnUiThread(() -> finishSpeech(id, "stopped"));
            }
        });

        authPrefs = getSharedPreferences("native-auth", MODE_PRIVATE);
        configureWindow();
        FrameLayout shell = new FrameLayout(this);
        shell.setBackgroundColor(PAPER);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        topBar = new View(this);
        topBar.setBackgroundColor(PAPER);
        bottomBar = new View(this);
        bottomBar.setBackgroundColor(PAPER);
        root.addView(topBar, new LinearLayout.LayoutParams(-1, 0));
        // Edge-to-edge: the strips under the status and navigation bars take the page's own
        // edge colours, so the web content reads as the app's own screen.
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int top, bottom, left, right;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                top = bars.top; bottom = Math.max(bars.bottom, ime.bottom); left = bars.left; right = bars.right;
            } else {
                top = insets.getSystemWindowInsetTop(); bottom = insets.getSystemWindowInsetBottom();
                left = insets.getSystemWindowInsetLeft(); right = insets.getSystemWindowInsetRight();
            }
            setHeight(topBar, top);
            setHeight(bottomBar, bottom);
            v.setPadding(left, 0, right, 0);
            return insets;
        });

        FrameLayout content = new FrameLayout(this);
        root.addView(content, new LinearLayout.LayoutParams(-1, 0, 1f));
        root.addView(bottomBar, new LinearLayout.LayoutParams(-1, 0));
        shell.addView(root, new FrameLayout.LayoutParams(-1, -1));
        buildWebPane();
        buildNotebookPane();
        buildInfoPane();
        content.addView(webPane, new FrameLayout.LayoutParams(-1, -1));
        content.addView(notebookPane, new FrameLayout.LayoutParams(-1, -1));
        content.addView(infoPane, new FrameLayout.LayoutParams(-1, -1));

        splash = buildSplash();
        shell.addView(splash, new FrameLayout.LayoutParams(-1, -1));
        setContentView(shell);
        setBarIcons(true, true);
        select(0);
        refreshNotebook();
        if (state != null) { web.restoreState(state); hideSplash(false); } else web.loadUrl(UrlPolicy.HOME);
        handleAuthIntent(getIntent());
        mainHandler.postDelayed(() -> hideSplash(true), 12000);
        watchNetwork();
    }

    /** When the connection comes back while the offline screen is up, reopen automatically. */
    private void watchNetwork() {
        android.net.ConnectivityManager cm = getSystemService(android.net.ConnectivityManager.class);
        if (cm == null) return;
        networkCallback = new android.net.ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(android.net.Network network) {
                mainHandler.postDelayed(() -> {
                    if (webError == null || webError.getVisibility() != View.VISIBLE || isFinishing()) return;
                    webError.setVisibility(View.GONE);
                    String current = web.getUrl();
                    web.loadUrl(UrlPolicy.isTrusted(current) ? current : UrlPolicy.HOME);
                }, 1500);
            }
        };
        try { cm.registerDefaultNetworkCallback(networkCallback); } catch (RuntimeException e) { networkCallback = null; }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleAuthIntent(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (authInFlight) {
            // Returned from the sign-in tab without a callback: cancelled. Reset the login page.
            authInFlight = false;
            clearPendingAuth();
            String current = web.getUrl();
            if (UrlPolicy.isTrusted(current)) web.reload(); else web.loadUrl(UrlPolicy.HOME);
        }
    }

    // ---------------- Shell ----------------

    private void configureWindow() {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
        } else {
            w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 29) {
            w.setStatusBarContrastEnforced(false);
            w.setNavigationBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = w.getAttributes();
            lp.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30
                    ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                    : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            w.setAttributes(lp);
        }
    }

    private static void setHeight(View v, int h) {
        ViewGroup.LayoutParams lp = v.getLayoutParams();
        if (lp != null && lp.height != h) { lp.height = h; v.setLayoutParams(lp); }
    }

    /** Dark backgrounds get light icons and vice versa. */
    @SuppressWarnings("deprecation")
    private void setBarIcons(boolean darkTop, boolean darkBottom) {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c == null) return;
            c.setSystemBarsAppearance(darkTop ? 0 : WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS,
                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS);
            c.setSystemBarsAppearance(darkBottom ? 0 : WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                    WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        } else {
            View decor = getWindow().getDecorView();
            int f = decor.getSystemUiVisibility();
            if (Build.VERSION.SDK_INT >= 23) f = darkTop ? f & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR : f | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= 26) f = darkBottom ? f & ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR : f | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            decor.setSystemUiVisibility(f);
        }
    }

    private static boolean isDark(int color) {
        return (0.299 * Color.red(color) + 0.587 * Color.green(color) + 0.114 * Color.blue(color)) / 255.0 < 0.6;
    }

    private void applyChrome(int top, int bottom) {
        topBar.setBackgroundColor(top);
        bottomBar.setBackgroundColor(bottom);
        topDark = isDark(top);
        bottomDark = isDark(bottom);
        if (splashHidden) setBarIcons(topDark, bottomDark);
    }

    /** Continues the system splash (same navy and centred mark), then adds the wordmark. */
    private FrameLayout buildSplash() {
        FrameLayout s = new FrameLayout(this);
        s.setBackgroundColor(NAVY);
        s.setClickable(true);
        s.setContentDescription("옳은보카 시작 중");
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.launch_logo);
        logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        logo.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        s.addView(logo, new FrameLayout.LayoutParams(150 * dp, 150 * dp, Gravity.CENTER));
        LinearLayout words = new LinearLayout(this);
        words.setOrientation(LinearLayout.VERTICAL);
        words.setGravity(Gravity.CENTER_HORIZONTAL);
        TextView name = new TextView(this);
        name.setText("옳은보카");
        name.setTextColor(Color.WHITE);
        name.setTextSize(28);
        name.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        name.setLetterSpacing(-0.02f);
        TextView sub = new TextView(this);
        sub.setText("옳은영어 어휘플랫폼");
        sub.setTextColor(0xC7FFFFFF);
        sub.setTextSize(14);
        sub.setPadding(0, 4 * dp, 0, 0);
        words.addView(name);
        words.addView(sub);
        s.addView(words, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));
        words.setTranslationY(124 * dp);
        words.setAlpha(0f);
        words.animate().alpha(1f).translationY(116 * dp).setStartDelay(150).setDuration(450).start();
        ProgressBar spinner = new ProgressBar(this);
        spinner.setIndeterminateTintList(ColorStateList.valueOf(0xD9FFFFFF));
        FrameLayout.LayoutParams sp = new FrameLayout.LayoutParams(26 * dp, 26 * dp, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        sp.bottomMargin = 72 * dp;
        s.addView(spinner, sp);
        return s;
    }

    private void hideSplash(boolean animated) {
        if (splashHidden || splash == null) return;
        splashHidden = true;
        setBarIcons(topDark, bottomDark);
        if (!animated) { splash.setVisibility(View.GONE); return; }
        splash.animate().alpha(0f).setDuration(420).withEndAction(() -> splash.setVisibility(View.GONE)).start();
    }

    private void configureShellBridge(WebView view) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        try (InputStream input = getAssets().open("orun-voca-shell.js")) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] chunk = new byte[4096];
            int read;
            while ((read = input.read(chunk)) != -1) bytes.write(chunk, 0, read);
            shellScript = new String(bytes.toByteArray(), StandardCharsets.UTF_8);
            Set<String> trustedOrigin = Collections.singleton("https://" + UrlPolicy.HOST);
            WebViewCompat.addWebMessageListener(view, "__orunVocaShell", trustedOrigin,
                    (source, message, origin, mainFrame, reply) -> {
                        if (!mainFrame || source != web || !UrlPolicy.isTrusted(origin.toString())
                                || message.getType() != WebMessageCompat.TYPE_STRING) return;
                        String payload = message.getData();
                        if (payload == null || payload.length() > 200) return;
                        runOnUiThread(() -> handleShellMessage(payload));
                    });
            if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                WebViewCompat.addDocumentStartJavaScript(view, shellScript, trustedOrigin);
            }
        } catch (IOException | UnsupportedOperationException error) {
            shellScript = null;
        }
    }

    private void handleShellMessage(String payload) {
        try {
            JSONObject o = new JSONObject(payload);
            int top = rgb(o.getJSONArray("top"));
            int bottom = rgb(o.getJSONArray("bottom"));
            applyChrome(top, bottom);
        } catch (Exception ignored) {
            // Malformed colour report: keep the current strips.
        }
    }

    private static int rgb(org.json.JSONArray a) throws org.json.JSONException {
        if (a.length() != 3) throw new org.json.JSONException("rgb");
        int r = a.getInt(0), g = a.getInt(1), b = a.getInt(2);
        if (r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) throw new org.json.JSONException("range");
        return Color.rgb(r, g, b);
    }

    // ---------------- Google sign-in ----------------

    private void beginNativeSignIn(String url) {
        String[] request = NativeAuth.rewrite(url);
        if (request == null) return;
        authPrefs.edit().putString("return", request[1]).putLong("at", System.currentTimeMillis()).apply();
        Intent tab = new Intent(Intent.ACTION_VIEW, Uri.parse(request[0]));
        Bundle extras = new Bundle();
        extras.putBinder("android.support.customtabs.extra.SESSION", null);   // Custom Tab, no service binding
        tab.putExtras(extras);
        tab.putExtra("android.support.customtabs.extra.TOOLBAR_COLOR", NAVY);
        tab.putExtra("android.support.customtabs.extra.TITLE_VISIBILITY", 1);
        tab.putExtra("androidx.browser.customtabs.extra.SHARE_STATE", 2);
        tab.addCategory(Intent.CATEGORY_BROWSABLE);
        try {
            startActivity(tab);
            authInFlight = true;
        } catch (ActivityNotFoundException e) {
            clearPendingAuth();
            toast("Google 로그인을 열 수 있는 브라우저가 없어요.");
            web.reload();
        }
    }

    private void clearPendingAuth() {
        authPrefs.edit().remove("return").remove("at").apply();
    }

    private void handleAuthIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction()) || intent.getData() == null) return;
        String callback = intent.getDataString();
        setIntent(new Intent(this, MainActivity.class));   // consume once
        if (!NativeAuth.isCallback(callback)) return;
        authInFlight = false;
        String returnUrl = authPrefs.getString("return", null);
        long at = authPrefs.getLong("at", 0);
        long age = System.currentTimeMillis() - at;
        clearPendingAuth();
        // Only a callback for a sign-in this app started (and recently) is accepted.
        if (returnUrl == null || at <= 0 || age < 0 || age > NativeAuth.MAX_PENDING_MS) return;
        String target = NativeAuth.completion(returnUrl, callback);
        webError.setVisibility(View.GONE);
        hideSplash(false);
        if (target != null) web.loadUrl(target); else web.loadUrl(returnUrl);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putInt("tab", currentTab);
        web.saveState(out);
    }

    private int currentTab;

    private void select(int tab) {
        // Keep older saved tab state from exposing the removed native navigation.
        currentTab = 0;
        webPane.setVisibility(View.VISIBLE);
        notebookPane.setVisibility(View.GONE);
        infoPane.setVisibility(View.GONE);
        hideKeyboard();
    }

    private void hideKeyboard() {
        android.view.inputmethod.InputMethodManager imm = getSystemService(android.view.inputmethod.InputMethodManager.class);
        View f = getCurrentFocus();
        if (imm != null && f != null) imm.hideSoftInputFromWindow(f.getWindowToken(), 0);
    }

    // ---------------- Web ----------------

    private void buildWebPane() {
        webPane = new LinearLayout(this);
        webPane.setOrientation(LinearLayout.VERTICAL);
        FrameLayout frame = new FrameLayout(this);
        web = new WebView(this);
        configureWebView(web);
        frame.addView(web, new FrameLayout.LayoutParams(-1, -1));
        // Slim beam-yellow load line over the page (visible on light and navy screens).
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setProgressTintList(ColorStateList.valueOf(BEAM));
        progress.setProgressBackgroundTintList(ColorStateList.valueOf(Color.TRANSPARENT));
        progress.setVisibility(View.GONE);
        frame.addView(progress, new FrameLayout.LayoutParams(-1, 3 * dp, Gravity.TOP));

        LinearLayout err = new LinearLayout(this);
        err.setOrientation(LinearLayout.VERTICAL);
        err.setGravity(Gravity.CENTER);
        err.setBackgroundColor(PAPER);
        err.setPadding(32 * dp, 24 * dp, 32 * dp, 24 * dp);
        err.setClickable(true);
        FrameLayout badge = new FrameLayout(this);
        GradientDrawable circle = new GradientDrawable();
        circle.setShape(GradientDrawable.OVAL);
        circle.setColor(NAVY);
        badge.setBackground(circle);
        ImageView mark = new ImageView(this);
        mark.setImageResource(R.drawable.launch_logo);
        mark.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        badge.addView(mark, new FrameLayout.LayoutParams(74 * dp, 74 * dp, Gravity.CENTER));
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(96 * dp, 96 * dp);
        bp.bottomMargin = 28 * dp;
        err.addView(badge, bp);
        TextView title = new TextView(this);
        title.setText("연결할 수 없어요");
        title.setTextColor(INK);
        title.setTextSize(22);
        title.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        title.setGravity(Gravity.CENTER);
        err.addView(title);
        TextView msg = new TextView(this);
        msg.setText("인터넷 연결을 확인한 뒤 다시 시도해 주세요.");
        msg.setGravity(Gravity.CENTER);
        msg.setTextColor(0x9E121D30);
        msg.setTextSize(15);
        msg.setPadding(0, 10 * dp, 0, 0);
        err.addView(msg);
        TextView retry = new TextView(this);
        retry.setText("다시 시도");
        retry.setTextColor(Color.WHITE);
        retry.setTextSize(16);
        retry.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        retry.setGravity(Gravity.CENTER);
        retry.setMinWidth(180 * dp);
        retry.setPadding(28 * dp, 0, 28 * dp, 0);
        GradientDrawable pill = new GradientDrawable();
        pill.setColor(ACTION);
        pill.setCornerRadius(26 * dp);
        retry.setBackground(pill);
        retry.setElevation(4 * dp);
        retry.setClickable(true);
        retry.setFocusable(true);
        retry.setContentDescription("학습 화면 다시 열기");
        retry.setOnClickListener(v -> {
            webError.setVisibility(View.GONE);
            String current = web.getUrl();
            web.loadUrl(UrlPolicy.isTrusted(current) ? current : UrlPolicy.HOME);
        });
        LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(-2, 52 * dp);
        rp.topMargin = 30 * dp;
        err.addView(retry, rp);
        err.setVisibility(View.GONE);
        webError = err;
        frame.addView(err, new FrameLayout.LayoutParams(-1, -1));
        webPane.addView(frame, new LinearLayout.LayoutParams(-1, 0, 1f));
    }

    private void configureWebView(WebView w) {
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSafeBrowsingEnabled(true);
        s.setGeolocationEnabled(false);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSaveFormData(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUserAgentString(s.getUserAgentString() + " OrunVocaApp/" + BuildConfig.VERSION_NAME);
        w.setBackgroundColor(PAPER);
        w.setOverScrollMode(View.OVER_SCROLL_NEVER);
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(w, false);
        configureSpeechBridge(w);
        configureShellBridge(w);

        w.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                String url = r.getUrl().toString();
                if (NativeAuth.isAuthorize(url)) {
                    // Google refuses embedded WebViews: hand only this request to a Custom Tab.
                    if (r.isForMainFrame() && UrlPolicy.isTrusted(v.getUrl())) beginNativeSignIn(url);
                    return true;
                }
                if (UrlPolicy.isTrusted(url)) return false;
                openExternal(url);
                return true;
            }
            @Override public void onPageStarted(WebView v, String url, Bitmap icon) {
                stopSpeech();
                progress.setVisibility(View.VISIBLE);
                progress.setProgress(8);
            }
            @Override public void onPageFinished(WebView v, String url) {
                progress.setVisibility(View.GONE);
                if (!splashHidden) mainHandler.postDelayed(() -> hideSplash(true), 350);
                if (shellScript != null && UrlPolicy.isTrusted(url)
                        && !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                    v.evaluateJavascript(shellScript, null);
                }
                // Older WebView versions may lack document-start scripts. The message
                // listener itself is still origin and main-frame restricted.
                if (speechScript != null && UrlPolicy.isTrusted(url)) {
                    v.evaluateJavascript(speechScript, null);
                }
            }
            @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) showWebError();
            }
            @Override public void onReceivedSslError(WebView v, android.webkit.SslErrorHandler h, android.net.http.SslError e) {
                h.cancel();
                showWebError();
            }
        });
        w.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView v, int p) { progress.setProgress(Math.max(8, p)); }
            @Override public void onPermissionRequest(PermissionRequest r) { r.deny(); }
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE_CHOOSER);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });
        w.setDownloadListener((url, ua, cd, mime, len) -> {
            if (url != null && url.startsWith("https://")) openExternal(url);
        });
    }

    private void showWebError() {
        webError.setVisibility(View.VISIBLE);
        progress.setVisibility(View.GONE);
        applyChrome(PAPER, PAPER);
        hideSplash(true);
    }

    private void openExternal(String url) {
        if (!UrlPolicy.isExternalAllowed(url)) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "열 수 있는 앱이 없어요.", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    public void onBackPressed() {
        if (currentTab != 0) { select(0); return; }
        if (web.canGoBack()) { web.goBack(); return; }
        super.onBackPressed();
    }

    // ---------------- Notebook ----------------

    private void buildNotebookPane() {
        notebookPane = new LinearLayout(this);
        notebookPane.setOrientation(LinearLayout.VERTICAL);
        notebookPane.setPadding(16 * dp, 12 * dp, 16 * dp, 0);

        TextView title = new TextView(this);
        title.setText("오프라인 단어장");
        title.setTextSize(22);
        title.setTextColor(Color.BLACK);
        notebookPane.addView(title);

        summary = new TextView(this);
        summary.setTextSize(14);
        summary.setPadding(0, 4 * dp, 0, 8 * dp);
        notebookPane.addView(summary);

        storeError = new TextView(this);
        storeError.setTextColor(Color.RED);
        storeError.setVisibility(View.GONE);
        notebookPane.addView(storeError);

        LinearLayout row1 = new LinearLayout(this);
        Button add = smallButton("단어 추가");
        Button review = smallButton("오늘의 복습");
        Button more = smallButton("더보기");
        add.setOnClickListener(v -> editDialog(null));
        review.setOnClickListener(v -> startReview());
        more.setOnClickListener(v -> moreMenu());
        row1.addView(add, new LinearLayout.LayoutParams(0, -2, 1f));
        row1.addView(review, new LinearLayout.LayoutParams(0, -2, 1f));
        row1.addView(more, new LinearLayout.LayoutParams(0, -2, 1f));
        notebookPane.addView(row1);

        searchBox = new EditText(this);
        searchBox.setHint("단어 또는 뜻 검색");
        searchBox.setSingleLine(true);
        searchBox.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int a, int b, int c) { }
            public void onTextChanged(CharSequence s, int a, int b, int c) { }
            public void afterTextChanged(Editable e) { refreshNotebook(); }
        });
        notebookPane.addView(searchBox);

        list = new ListView(this);
        adapter = new ArrayAdapter<VocabularyCard>(this, android.R.layout.simple_list_item_2, android.R.id.text1, shown) {
            @Override public View getView(int position, View convert, ViewGroup parent) {
                View v = super.getView(position, convert, parent);
                VocabularyCard c = getItem(position);
                ((TextView) v.findViewById(android.R.id.text1)).setText(c.word);
                ((TextView) v.findViewById(android.R.id.text2)).setText(c.meaning);
                return v;
            }
        };
        list.setAdapter(adapter);
        list.setEmptyView(null);
        list.setOnItemClickListener((p, v, pos, id) -> cardActions(shown.get(pos)));
        notebookPane.addView(list, new LinearLayout.LayoutParams(-1, 0, 1f));
    }

    private Button smallButton(String text) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextSize(13);
        return b;
    }

    private void refreshNotebook() {
        shown.clear();
        shown.addAll(store.search(searchBox == null ? "" : searchBox.getText().toString()));
        adapter.notifyDataSetChanged();
        int due = store.dueCards().size();
        String text = "단어 " + store.size() + "개 · 지금 복습 " + due + "개";
        if (store.size() == 0) text += "\n+ '단어 추가'로 나만의 단어장을 만들어 보세요. 인터넷 없이도 복습할 수 있어요.";
        summary.setText(text);
        String err = store.error();
        storeError.setVisibility(err == null ? View.GONE : View.VISIBLE);
        storeError.setText(err);
    }

    private void toast(String m) { Toast.makeText(this, m, Toast.LENGTH_SHORT).show(); }

    private void editDialog(VocabularyCard card) {
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(24 * dp, 8 * dp, 24 * dp, 0);
        EditText word = new EditText(this);
        word.setHint("단어");
        word.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        EditText meaning = new EditText(this);
        meaning.setHint("뜻");
        meaning.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        if (card != null) { word.setText(card.word); meaning.setText(card.meaning); }
        form.addView(word);
        form.addView(meaning);
        AlertDialog d = new AlertDialog.Builder(this)
                .setTitle(card == null ? "단어 추가" : "단어 수정")
                .setView(form)
                .setPositiveButton("저장", null)
                .setNegativeButton("취소", null)
                .create();
        d.setOnShowListener(x -> d.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String w = word.getText().toString().trim(), m = meaning.getText().toString().trim();
            if (w.isEmpty() || m.isEmpty()) { toast("단어와 뜻을 모두 입력해 주세요."); return; }
            boolean ok = card == null ? store.add(w, m) : store.update(card.id, w, m);
            if (!ok) { toast("저장하지 못했어요. 저장 공간을 확인해 주세요."); return; }
            refreshNotebook();
            d.dismiss();
        }));
        d.show();
    }

    private void cardActions(VocabularyCard card) {
        new AlertDialog.Builder(this)
                .setTitle(card.word)
                .setMessage(card.meaning)
                .setPositiveButton("수정", (d, w) -> editDialog(card))
                .setNeutralButton("발음 듣기", (d, w) -> speak(card.word))
                .setNegativeButton("삭제", (d, w) -> confirmDelete(card))
                .show();
    }

    private void confirmDelete(VocabularyCard card) {
        new AlertDialog.Builder(this)
                .setTitle("'" + card.word + "' 삭제")
                .setMessage("이 단어를 단어장에서 삭제할까요?")
                .setPositiveButton("삭제", (d, w) -> {
                    if (!store.remove(card.id)) toast("삭제하지 못했어요.");
                    refreshNotebook();
                })
                .setNegativeButton("취소", null)
                .show();
    }

    private void moreMenu() {
        String[] items = {"TSV 가져오기", "TSV 내보내기", "단어장 전체 삭제"};
        new AlertDialog.Builder(this).setItems(items, (d, which) -> {
            if (which == 0) {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"text/tab-separated-values", "text/plain", "text/*"});
                startActivityForResult(i, REQ_IMPORT);
            } else if (which == 1) {
                if (store.size() == 0) { toast("내보낼 단어가 없어요."); return; }
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                        .setType("text/tab-separated-values").putExtra(Intent.EXTRA_TITLE, "orunvoca-vocabulary.tsv");
                startActivityForResult(i, REQ_EXPORT);
            } else {
                new AlertDialog.Builder(this).setTitle("단어장 전체 삭제")
                        .setMessage("이 기기에 저장된 모든 단어와 복습 기록이 삭제됩니다. 되돌릴 수 없어요.")
                        .setPositiveButton("전체 삭제", (dd, ww) -> {
                            if (!store.removeAll()) toast("삭제하지 못했어요.");
                            refreshNotebook();
                        })
                        .setNegativeButton("취소", null).show();
            }
        }).show();
    }

    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        if (req == REQ_FILE_CHOOSER) {
            if (fileCallback != null) {
                Uri[] r = null;
                if (result == RESULT_OK && data != null) r = WebChromeClient.FileChooserParams.parseResult(result, data);
                fileCallback.onReceiveValue(r);
                fileCallback = null;
            }
            return;
        }
        if (result != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        if (req == REQ_IMPORT) {
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                if (in == null) throw new java.io.IOException();
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                byte[] chunk = new byte[8192];
                int n;
                while ((n = in.read(chunk)) > 0) {
                    buf.write(chunk, 0, n);
                    if (buf.size() > MAX_IMPORT_BYTES) throw new NotebookStore.InvalidFileException();
                }
                String text = new String(buf.toByteArray(), StandardCharsets.UTF_8);
                if (text.startsWith("\uFEFF")) text = text.substring(1);
                int count = store.importTsv(text);
                refreshNotebook();
                toast(count + "개 단어를 가져왔어요.");
            } catch (NotebookStore.InvalidFileException e) {
                toast("UTF-8 TSV 파일을 확인해 주세요. 각 줄은 단어와 뜻을 탭으로 구분하며 최대 10,000줄까지 가져올 수 있어요.");
            } catch (Exception e) {
                toast("파일을 읽지 못했어요.");
            }
        } else if (req == REQ_EXPORT) {
            try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                if (out == null) throw new java.io.IOException();
                out.write(store.exportTsv().getBytes(StandardCharsets.UTF_8));
                toast("단어장을 내보냈어요.");
            } catch (Exception e) {
                toast("파일을 저장하지 못했어요.");
            }
        }
    }

    // ---------------- Review ----------------

    private void startReview() {
        List<VocabularyCard> queue = store.dueCards(); // immutable snapshot for this session
        if (queue.isEmpty()) { toast("지금 복습할 단어가 없어요."); return; }
        reviewStep(queue, 0, 0);
    }

    private void reviewStep(List<VocabularyCard> queue, int index, int remembered) {
        if (isFinishing()) return;
        if (index >= queue.size()) {
            refreshNotebook();
            new AlertDialog.Builder(this).setTitle("복습 완료")
                    .setMessage(queue.size() + "개 중 " + remembered + "개를 기억했어요.")
                    .setPositiveButton("확인", null).show();
            return;
        }
        VocabularyCard c = queue.get(index);
        speak(c.word);
        AlertDialog.Builder b = new AlertDialog.Builder(this)
                .setTitle((index + 1) + " / " + queue.size())
                .setMessage(c.word)
                .setCancelable(false)
                .setPositiveButton("뜻 보기", null)
                .setNeutralButton("발음 듣기", null)
                .setNegativeButton("그만하기", (d, w) -> refreshNotebook());
        AlertDialog d = b.create();
        d.setOnShowListener(x -> {
            d.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v -> speak(c.word));
            d.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
                d.dismiss();
                answerStep(queue, index, remembered, c);
            });
        });
        d.show();
    }

    private void answerStep(List<VocabularyCard> queue, int index, int remembered, VocabularyCard c) {
        new AlertDialog.Builder(this)
                .setTitle(c.word)
                .setMessage(c.meaning)
                .setCancelable(false)
                .setPositiveButton("기억했어요", (d, w) -> {
                    store.review(c.id, true);
                    reviewStep(queue, index + 1, remembered + 1);
                })
                .setNegativeButton("다시 볼래요", (d, w) -> {
                    store.review(c.id, false);
                    reviewStep(queue, index + 1, remembered);
                })
                .show();
    }

    // ---------------- Trusted WebView speech ----------------

    private void configureSpeechBridge(WebView view) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        try (InputStream input = getAssets().open("orun-voca-speech.js")) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] chunk = new byte[4096];
            int read;
            while ((read = input.read(chunk)) != -1) bytes.write(chunk, 0, read);
            speechScript = new String(bytes.toByteArray(), StandardCharsets.UTF_8);
            Set<String> trustedOrigin = Collections.singleton("https://" + UrlPolicy.HOST);
            WebViewCompat.addWebMessageListener(view, "__orunVocaSpeechBridge", trustedOrigin,
                    (source, message, origin, mainFrame, reply) -> {
                        if (!mainFrame || source != web || !UrlPolicy.isTrusted(origin.toString())
                                || message.getType() != WebMessageCompat.TYPE_STRING) return;
                        String payload = message.getData();
                        if (payload == null || payload.length() > 1024) return;
                        runOnUiThread(() -> handleSpeechMessage(payload, reply));
                    });
            if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                WebViewCompat.addDocumentStartJavaScript(view, speechScript, trustedOrigin);
            }
        } catch (IOException | UnsupportedOperationException error) {
            // Do not fall back to addJavascriptInterface: it exposes native methods to frames.
            speechScript = null;
        }
    }

    private void handleSpeechMessage(String payload, JavaScriptReplyProxy reply) {
        String id = "";
        try {
            JSONObject request = new JSONObject(payload);
            String type = request.optString("type", "");
            id = request.optString("id", "");
            if (!id.matches("[sc][0-9]{1,16}")) return;
            if ("stop".equals(type)) {
                stopSpeech();
                sendSpeechReply(reply, id, "stopped");
                return;
            }
            if (!"speak".equals(type)) return;
            Object rawText = request.opt("text");
            Object rawLang = request.opt("lang");
            Object rawRate = request.opt("rate");
            if (!(rawText instanceof String) || !(rawLang instanceof String)
                    || !(rawRate instanceof Number)) {
                sendSpeechReply(reply, id, "failed");
                return;
            }
            String text = (String) rawText;
            String lang = (String) rawLang;
            double rate = ((Number) rawRate).doubleValue();
            if (text.trim().isEmpty() || text.length() > 300
                    || !("en-US".equals(lang) || "en-GB".equals(lang))
                    || !Double.isFinite(rate) || rate < 0.5 || rate > 1.25
                    || !ttsReady || tts == null) {
                sendSpeechReply(reply, id, "failed");
                return;
            }
            stopSpeech();
            int language = tts.setLanguage(Locale.forLanguageTag(lang));
            if (language == TextToSpeech.LANG_MISSING_DATA
                    || language == TextToSpeech.LANG_NOT_SUPPORTED
                    || tts.setSpeechRate((float) rate) != TextToSpeech.SUCCESS) {
                sendSpeechReply(reply, id, "failed");
                return;
            }
            speechReplies.put(id, reply);
            if (tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, id) != TextToSpeech.SUCCESS) {
                finishSpeech(id, "failed");
            }
        } catch (Exception error) {
            // Malformed messages cannot invoke native functionality.
            if (!id.isEmpty()) sendSpeechReply(reply, id, "failed");
        }
    }

    private void sendSpeechReply(JavaScriptReplyProxy reply, String id, String status) {
        try {
            reply.postMessage(new JSONObject().put("id", id).put("status", status).toString());
        } catch (Exception ignored) {
            // The originating page may have navigated away.
        }
    }

    private void finishSpeech(String id, String status) {
        JavaScriptReplyProxy reply = speechReplies.remove(id);
        if (reply != null) sendSpeechReply(reply, id, status);
    }

    private void stopSpeech() {
        if (tts != null) tts.stop();
        for (Map.Entry<String, JavaScriptReplyProxy> request : speechReplies.entrySet()) {
            sendSpeechReply(request.getValue(), request.getKey(), "stopped");
        }
        speechReplies.clear();
    }

    // ---------------- TTS ----------------

    @Override
    public void onInit(int status) {
        if (status == TextToSpeech.SUCCESS && tts != null) {
            int r = tts.setLanguage(Locale.US);
            ttsReady = r != TextToSpeech.LANG_MISSING_DATA && r != TextToSpeech.LANG_NOT_SUPPORTED;
            tts.setSpeechRate(0.85f);
        }
    }

    private void speak(String text) {
        if (!ttsReady || tts == null) { toast("이 기기에서 영어 음성을 사용할 수 없어요."); return; }
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "word");
    }

    // ---------------- Info ----------------

    private void buildInfoPane() {
        infoPane = new ScrollView(this);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(20 * dp, 16 * dp, 20 * dp, 16 * dp);
        TextView t = new TextView(this);
        t.setText("옳은VOCA 1.0.0");
        t.setTextSize(22);
        t.setTextColor(Color.BLACK);
        col.addView(t);
        TextView p = new TextView(this);
        p.setText("오프라인 단어장은 이 기기에만 저장되며 서버로 전송되지 않습니다. 광고·추적 SDK를 사용하지 않습니다.");
        p.setPadding(0, 8 * dp, 0, 16 * dp);
        col.addView(p);
        col.addView(linkButton("개인정보 처리방침", UrlPolicy.PRIVACY));
        col.addView(linkButton("고객 지원", UrlPolicy.SUPPORT));
        col.addView(linkButton("온라인 계정 삭제 안내", UrlPolicy.DELETE_ACCOUNT));
        infoPane.addView(col);
    }

    private Button linkButton(String label, String url) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setOnClickListener(v -> openExternal(url));
        return b;
    }

    @Override
    protected void onDestroy() {
        stopSpeech();
        mainHandler.removeCallbacksAndMessages(null);
        if (networkCallback != null) {
            try { getSystemService(android.net.ConnectivityManager.class).unregisterNetworkCallback(networkCallback); } catch (RuntimeException ignored) { }
            networkCallback = null;
        }
        if (tts != null) { tts.shutdown(); tts = null; }
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        if (web != null) { ((ViewGroup) web.getParent()).removeView(web); web.destroy(); }
        super.onDestroy();
    }
}
