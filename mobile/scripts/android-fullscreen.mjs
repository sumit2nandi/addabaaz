// Full-screen video the way the YouTube app does it, for the generated Android project.
//
// Why this exists: Capacitor's own WebChromeClient refuses Android's custom-view fullscreen (it
// calls callback.onCustomViewHidden() straight away), so the WebView falls back to its internal
// "inline" fullscreen - the video grows inside the page while the system bars stay up and the
// window shows through around it. That is the black video with white strips on both sides.
//
// This module patches the generated MainActivity to install a FullscreenClient (subclassing
// Capacitor's client, so dialogs/file-chooser/geolocation keep working) that accepts the fullscreen
// view instead: the video is added on top of everything, the WebView hides, the window is black
// edge to edge and BOTH system bars are hidden, so during full screen the video is the only thing
// on the screen. It also tells the page (window event `ab-video-fullscreen`) so the watch page's
// rotation rule (app/js/orientation.js) can turn the screen to match the video - the only place the
// app is allowed to rotate at all - and puts the app back into portrait when full screen ends.
//
// Generated in CI by `npm --prefix mobile run sync` (mobile/scripts/patch-android.mjs calls it), so
// mobile/android (git-ignored) always gets it; nothing here touches the committed web app.
import fs from 'node:fs';
import path from 'node:path';

/** Marker that says "this MainActivity already installs the fullscreen client". */
export const MAIN_ACTIVITY_MARKER = 'ab-fullscreen-video';

/** Marker for the explicit androidx.core dependency (the fullscreen client uses its inset APIs). */
export const CORE_DEPENDENCY_MARKER = 'ab-fullscreen-core';

/** The page event the client fires when full screen starts/ends (see app/js/orientation.js). */
export const PAGE_EVENT = 'ab-video-fullscreen';

// The client itself. Written next to MainActivity in the app's own package.
export function fullscreenClientJava(appId) {
  return `package ${appId};

import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;

/**
 * Full-screen video, the YouTube-app way: the video alone on a black screen.
 *
 * The player's own fullscreen button hands the video view here (${MAIN_ACTIVITY_MARKER}); we show it
 * on top of the whole window with both system bars hidden, and hide the WebView behind it. On the
 * way out everything is restored and the app goes back to portrait - outside this fullscreen the
 * app never rotates.
 */
public class FullscreenClient extends BridgeWebChromeClient {

    private final Bridge bridge;
    private View fullscreenView = null;
    private CustomViewCallback fullscreenCallback = null;

    public FullscreenClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
    }

    /** Back button in full screen: leave full screen (never the app). True when it consumed the press. */
    public boolean exitFullscreen() {
        if (fullscreenView == null || fullscreenCallback == null) {
            return false;
        }
        CustomViewCallback callback = fullscreenCallback;
        fullscreenCallback = null;
        callback.onCustomViewHidden();   // the WebView then calls onHideCustomView(), which restores everything
        return true;
    }

    @Override
    public void onShowCustomView(View view, CustomViewCallback callback) {
        Activity activity = bridge.getActivity();
        if (fullscreenView != null || activity == null) {
            callback.onCustomViewHidden();
            return;
        }
        fullscreenView = view;
        fullscreenCallback = callback;
        view.setBackgroundColor(Color.BLACK);

        Window window = activity.getWindow();
        window.getDecorView().setBackgroundColor(Color.BLACK);
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // Edge to edge: the video uses the whole display, notch and system-bar strips included.
        WindowCompat.setDecorFitsSystemWindows(window, false);

        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(window, window.getDecorView());
        bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        bars.hide(WindowInsetsCompat.Type.systemBars());   // no status bar, no navigation bar

        ((ViewGroup) window.getDecorView()).addView(
            view,
            new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        );

        WebView webView = bridge.getWebView();
        if (webView != null) {
            webView.setVisibility(View.INVISIBLE);
        }
        // Sensor rotation is allowed here - and only here. The page locks it to the video's own
        // aspect right after (see app/js/orientation.js).
        activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR);
        notifyPage(true);
    }

    @Override
    public void onHideCustomView() {
        Activity activity = bridge.getActivity();
        fullscreenCallback = null;
        if (fullscreenView != null) {
            if (activity != null) {
                Window window = activity.getWindow();
                ViewGroup decor = (ViewGroup) window.getDecorView();
                decor.removeView(fullscreenView);
                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(window, decor);
                bars.show(WindowInsetsCompat.Type.systemBars());
                WindowCompat.setDecorFitsSystemWindows(window, true);
            }
            fullscreenView = null;
        }
        WebView webView = bridge.getWebView();
        if (webView != null) {
            webView.setVisibility(View.VISIBLE);
        }
        if (activity != null) {
            activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        }
        super.onHideCustomView();
        notifyPage(false);
    }

    /** Tells the page that video fullscreen started/ended (the WebView does not always fire its own fullscreenchange). */
    private void notifyPage(boolean active) {
        WebView webView = bridge.getWebView();
        if (webView == null) {
            return;
        }
        webView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('${PAGE_EVENT}', { detail: { active: " + active + " } }))",
            null
        );
    }
}
`;
}

// Rewrites the generated MainActivity (Capacitor's stock `public class MainActivity extends
// BridgeActivity {}`) so the app installs the client above. Unknown shapes are returned untouched -
// the caller decides whether that is a build-stopping error.
export function patchMainActivity(java) {
  if (java.includes(MAIN_ACTIVITY_MARKER)) return java;                       // already patched
  const pkg = (java.match(/^\s*package\s+([\w.]+)\s*;/m) || [])[1];
  if (!pkg || !/class\s+MainActivity\s+extends\s+BridgeActivity\s*\{\s*\}/.test(java)) return java;
  return `package ${pkg};

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // ${MAIN_ACTIVITY_MARKER}: full screen video is the video alone on a black screen - both system bars
        // hidden, WebView behind it (see FullscreenClient.java / mobile/scripts/android-fullscreen.mjs).
        Bridge bridge = getBridge();
        if (bridge == null || bridge.getWebView() == null) {
            return;
        }
        final FullscreenClient fullscreen = new FullscreenClient(bridge);
        bridge.getWebView().setWebChromeClient(fullscreen);
        // In full screen, back leaves full screen instead of leaving the app (or going back in history).
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (fullscreen.exitFullscreen()) {
                    return;
                }
                // Not in full screen: hand the press to the next handler (Capacitor's webview history),
                // then listen again for the next full screen session.
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
    }
}
`;
}

export const mainActivityInstallsFullscreen = (java) => java.includes(MAIN_ACTIVITY_MARKER) && java.includes('setWebChromeClient(fullscreen)');

// The client compiles against androidx.core's WindowCompat/WindowInsetsControllerCompat and
// androidx.activity's OnBackPressedCallback. appcompat already exposes both to the app module, but
// saying it out loud keeps the build safe if a future appcompat drops that - the dependencies only
// ever exist once.
export function addCoreDependency(gradle) {
  if (gradle.includes(CORE_DEPENDENCY_MARKER)) return gradle;
  return gradle.replace(/(\ndependencies\s*\{)/, `$1\n    // ${CORE_DEPENDENCY_MARKER}\n    implementation "androidx.core:core:$androidxCoreVersion"\n    implementation "androidx.activity:activity:$androidxActivityVersion"`);
}

export const hasCoreDependency = (gradle) => gradle.includes(CORE_DEPENDENCY_MARKER);

/** Where the generated app keeps its sources (Capacitor's `cap add android` puts them under the appId path). */
export const javaSourceDir = (androidRoot, appId) => path.join(androidRoot, 'app', 'src', 'main', 'java', ...appId.split('.'));

/** Writes FullscreenClient.java next to MainActivity. Returns { file, changed } (file is null when the app has no sources yet). */
export function writeFullscreenClient(androidRoot, appId) {
  const dir = javaSourceDir(androidRoot, appId);
  if (!fs.existsSync(dir)) return { file: null, changed: false };
  const file = path.join(dir, 'FullscreenClient.java');
  const next = fullscreenClientJava(appId);
  const changed = !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== next;
  if (changed) fs.writeFileSync(file, next);
  return { file, changed };
}
