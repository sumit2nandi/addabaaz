package in.addabaaz.app;

import android.os.Bundle;
import android.graphics.Color;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.widget.FrameLayout;
import androidx.activity.OnBackPressedCallback;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;

/** Capacitor shell with native fullscreen support for user-started video. */
public class MainActivity extends BridgeActivity {
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private OnBackPressedCallback fullscreenBack;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
        if (bridge == null) return; // Android's missing-WebView recovery screen.

        fullscreenBack = new OnBackPressedCallback(false) {
            @Override
            public void handleOnBackPressed() { leaveFullscreen(); }
        };
        getOnBackPressedDispatcher().addCallback(this, fullscreenBack);
        bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(bridge) {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (fullscreenView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                fullscreenView = view;
                fullscreenCallback = callback;
                view.setBackgroundColor(Color.BLACK);
                ((FrameLayout) getWindow().getDecorView()).addView(view,
                    new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                view.setKeepScreenOn(true);
                WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), view);
                bars.hide(WindowInsetsCompat.Type.systemBars());
                bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                fullscreenBack.setEnabled(true);
            }

            @Override
            public void onHideCustomView() { leaveFullscreen(); }
        });
        bridge.getWebView().setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Embedded YouTube redirects stay in their frame, never launch an
                // external app. Top-level external links still use Android intents.
                return request.isForMainFrame() && super.shouldOverrideUrlLoading(view, request);
            }
        });
    }

    private void leaveFullscreen() {
        if (fullscreenView == null) return;
        fullscreenView.setKeepScreenOn(false);
        ((FrameLayout) getWindow().getDecorView()).removeView(fullscreenView);
        fullscreenView = null;
        WindowCompat.getInsetsController(getWindow(), bridge.getWebView()).show(WindowInsetsCompat.Type.systemBars());
        fullscreenBack.setEnabled(false);
        WebChromeClient.CustomViewCallback callback = fullscreenCallback;
        fullscreenCallback = null;
        if (callback != null) callback.onCustomViewHidden();
    }

    @Override
    public void onDestroy() {
        leaveFullscreen();
        super.onDestroy();
    }
}
