package com.daylight.highlightsproto;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Voice-note transcripts from Android's own speech recognition.
        registerPlugin(TranscriberPlugin.class);
        super.onCreate(savedInstanceState);

        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();
        // Lay the page out the same at every system font size, so what we test matches the mock-ups.
        settings.setTextZoom(100);
        // The prototype draws its own selection handles and menu; stop the WebView's own long-press selection.
        webView.setLongClickable(false);
        webView.setHapticFeedbackEnabled(false);

        // Back closes the open menu or note first, and only leaves the app when nothing is open.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                webView.evaluateJavascript(
                    "(window.protoHandleBack && window.protoHandleBack()) ? 'handled' : 'exit'",
                    value -> {
                        if (value == null || !value.contains("handled")) {
                            setEnabled(false);
                            getOnBackPressedDispatcher().onBackPressed();
                            setEnabled(true);
                        }
                    });
            }
        });
    }
}
