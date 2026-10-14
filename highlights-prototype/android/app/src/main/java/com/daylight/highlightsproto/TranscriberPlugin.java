package com.daylight.highlightsproto;

import android.Manifest;
import android.content.Intent;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Locale;

/**
 * Voice notes with a live transcript, using Android's own speech recognition.
 *
 * The plugin owns the microphone. In "shared" mode (Android 13+) it records 16 kHz PCM itself, keeps it for the
 * voice note, and pipes the same audio to the recogniser (RecognizerIntent.EXTRA_AUDIO_SOURCE), so the note has both
 * audio and a transcript. If the tablet's speech service can't read a piped stream, it falls back to "mic" mode:
 * the recogniser listens on its own and the note keeps the transcript but no audio.
 *
 * Events: "partial" {text} (everything heard so far), "level" {peak 0..1}, "mode" {mode}, "error" {message}.
 */
@CapacitorPlugin(name = "Transcriber", permissions = { @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }) })
public class TranscriberPlugin extends Plugin {

    private static final int RATE = 16000;
    private static final long MAX_PCM_BYTES = 10L * 60 * RATE * 2;   // 10 minutes

    private final Handler main = new Handler(Looper.getMainLooper());

    private SpeechRecognizer recognizer;
    private boolean onDevice;
    private String mode = "none";          // shared | mic | none
    private String language;
    private volatile boolean recording;
    private boolean anyResult;
    private boolean triedOnDevice;
    private long startedAt;

    private AudioRecord audio;
    private Thread reader;
    private final ByteArrayOutputStream pcm = new ByteArrayOutputStream();
    private volatile OutputStream pipeOut;
    private ParcelFileDescriptor pipeIn;

    private final StringBuilder finalText = new StringBuilder();
    private String partialText = "";
    private PluginCall stopCall;
    private Runnable stopTimeout;

    @PluginMethod
    public void available(PluginCall call) {
        JSObject ret = new JSObject();
        boolean any = SpeechRecognizer.isRecognitionAvailable(getContext());
        boolean device = Build.VERSION.SDK_INT >= 33 && SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext());
        ret.put("available", any || device);
        ret.put("onDevice", device);
        ret.put("shared", Build.VERSION.SDK_INT >= 33);
        call.resolve(ret);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "micPermission");
            return;
        }
        begin(call);
    }

    @PermissionCallback
    private void micPermission(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) begin(call);
        else call.reject("I need the microphone to record a voice note.", "denied");
    }

    private void begin(PluginCall call) {
        main.post(() -> {
            if (recording) { call.reject("Already recording.", "busy"); return; }
            reset();
            language = call.getString("lang", Locale.getDefault().toLanguageTag());
            recording = true;
            startedAt = System.currentTimeMillis();
            boolean shared = Build.VERSION.SDK_INT >= 33 && startAudio();
            if (shared) {
                mode = "shared";
                startSession();
            } else {
                mode = "mic";
                startSession();
            }
            JSObject ret = new JSObject();
            ret.put("mode", mode);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        main.post(() -> {
            if (!recording && stopCall == null) { call.reject("Not recording.", "idle"); return; }
            recording = false;
            stopCall = call;
            stopAudio();
            if (recognizer != null) {
                try { recognizer.stopListening(); } catch (Exception ignored) { }
                // Give the recogniser a moment to deliver what it heard last.
                stopTimeout = this::finish;
                main.postDelayed(stopTimeout, 2500);
            } else {
                finish();
            }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        main.post(() -> {
            recording = false;
            stopAudio();
            destroyRecognizer();
            reset();
            call.resolve();
        });
    }

    // ------------------------------------------------------------------ audio

    private boolean startAudio() {
        try {
            int min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            audio = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, RATE, AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT, Math.max(min, RATE));
            if (audio.getState() != AudioRecord.STATE_INITIALIZED) { audio.release(); audio = null; return false; }
            audio.startRecording();
        } catch (SecurityException | IllegalStateException e) {
            if (audio != null) { audio.release(); audio = null; }
            return false;
        }
        reader = new Thread(() -> {
            byte[] buf = new byte[RATE / 10 * 2];   // 100 ms
            while (recording && audio != null) {
                int n = audio.read(buf, 0, buf.length);
                if (n <= 0) continue;
                if (pcm.size() < MAX_PCM_BYTES) pcm.write(buf, 0, n);
                OutputStream out = pipeOut;
                if (out != null) {
                    try { out.write(buf, 0, n); } catch (IOException e) { pipeOut = null; }
                }
                int peak = 0;
                for (int i = 0; i + 1 < n; i += 2) {
                    int s = (short) ((buf[i] & 0xff) | (buf[i + 1] << 8));
                    peak = Math.max(peak, Math.abs(s));
                }
                JSObject ev = new JSObject();
                ev.put("peak", Math.min(1.0, peak / 20000.0));
                notifyListeners("level", ev);
            }
        }, "transcriber-audio");
        reader.start();
        return true;
    }

    private void stopAudio() {
        AudioRecord a = audio;
        audio = null;
        if (a != null) {
            try { a.stop(); } catch (Exception ignored) { }
            a.release();
        }
        if (reader != null) {
            try { reader.join(500); } catch (InterruptedException ignored) { }
            reader = null;
        }
        closePipe();
    }

    private void closePipe() {
        OutputStream out = pipeOut;
        pipeOut = null;
        if (out != null) try { out.close(); } catch (IOException ignored) { }
        if (pipeIn != null) try { pipeIn.close(); } catch (IOException ignored) { }
        pipeIn = null;
    }

    // ------------------------------------------------------------------ recognition

    private SpeechRecognizer makeRecognizer() {
        destroyRecognizer();
        // Prefer the tablet's speech service; use the on-device one if that's all there is (or the first failed).
        boolean any = SpeechRecognizer.isRecognitionAvailable(getContext());
        boolean device = Build.VERSION.SDK_INT >= 33 && SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext());
        if (any && !(triedOnDevice && device && onDevice)) {
            onDevice = false;
            recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
        } else if (device && Build.VERSION.SDK_INT >= 33) {
            onDevice = true;
            recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext());
        } else {
            recognizer = null;
            return null;
        }
        recognizer.setRecognitionListener(listener);
        return recognizer;
    }

    private void startSession() {
        if (makeRecognizer() == null) {
            mode = "shared".equals(mode) ? "audio-only" : "none";
            sendMode();
            sendError("Speech-to-text isn't available on this tablet; the recording still works.");
            return;
        }
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getContext().getPackageName());
        if ("shared".equals(mode) && Build.VERSION.SDK_INT >= 33) {
            try {
                ParcelFileDescriptor[] pipe = ParcelFileDescriptor.createPipe();
                pipeIn = pipe[0];
                pipeOut = new ParcelFileDescriptor.AutoCloseOutputStream(pipe[1]);
                intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, pipeIn);
                intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1);
                intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT);
                intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, RATE);
                // Keep recognising until the pipe closes, in segments, instead of stopping at the first pause.
                intent.putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_AUDIO_SOURCE);
            } catch (IOException e) {
                switchToMic();
                return;
            }
        }
        try {
            recognizer.startListening(intent);
        } catch (Exception e) {
            if ("shared".equals(mode)) switchToMic();
            else sendError("Speech-to-text couldn't start.");
        }
    }

    // The speech service can't read our stream: let it use the mic itself (transcript, no audio).
    private void switchToMic() {
        if (!recording) return;
        stopAudio();
        pcm.reset();
        recording = true;
        onDevice = false;
        triedOnDevice = false;
        mode = "mic";
        sendMode();
        startSession();
    }

    private void restartSession() {
        if (!recording) return;
        closePipe();
        startSession();
    }

    private void addFinal(Bundle results) {
        ArrayList<String> list = results == null ? null : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (list != null && !list.isEmpty() && list.get(0) != null && !list.get(0).trim().isEmpty()) {
            if (finalText.length() > 0) finalText.append(' ');
            finalText.append(list.get(0).trim());
            anyResult = true;
        }
        partialText = "";
        sendPartial();
    }

    private final RecognitionListener listener = new RecognitionListener() {
        @Override public void onReadyForSpeech(Bundle params) { }
        @Override public void onBeginningOfSpeech() { }
        @Override public void onRmsChanged(float rmsdB) {
            if ("mic".equals(mode)) {
                JSObject ev = new JSObject();
                ev.put("peak", Math.max(0, Math.min(1.0, (rmsdB + 2) / 12.0)));
                notifyListeners("level", ev);
            }
        }
        @Override public void onBufferReceived(byte[] buffer) { }
        @Override public void onEndOfSpeech() { }

        @Override public void onPartialResults(Bundle partial) {
            ArrayList<String> list = partial == null ? null : partial.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            partialText = list != null && !list.isEmpty() && list.get(0) != null ? list.get(0) : "";
            if (!partialText.isEmpty()) anyResult = true;
            sendPartial();
        }

        @Override public void onResults(Bundle results) {
            addFinal(results);
            if (recording) restartSession(); else finish();
        }

        @Override public void onSegmentResults(Bundle segment) {
            addFinal(segment);
        }

        @Override public void onEndOfSegmentedSession() {
            if (recording) restartSession(); else finish();
        }

        @Override public void onError(int error) {
            boolean quiet = error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT;
            if (!recording) { finish(); return; }
            if (quiet) { restartSession(); return; }
            if ("shared".equals(mode) && !anyResult) {
                // Try the on-device service with the piped audio once, then fall back to the mic.
                boolean device = Build.VERSION.SDK_INT >= 33 && SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext());
                if (!triedOnDevice && device && !onDevice) {
                    triedOnDevice = true;
                    onDevice = true;
                    closePipe();
                    startSessionOnDevice();
                    return;
                }
                switchToMic();
                return;
            }
            if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY || error == SpeechRecognizer.ERROR_CLIENT) {
                main.postDelayed(TranscriberPlugin.this::restartSession, 300);
                return;
            }
            sendError("Speech-to-text stopped (" + error + "); the recording still works.");
        }

        @Override public void onEvent(int eventType, Bundle params) { }
    };

    private void startSessionOnDevice() {
        if (Build.VERSION.SDK_INT < 33) { switchToMic(); return; }
        destroyRecognizer();
        recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext());
        recognizer.setRecognitionListener(listener);
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        try {
            ParcelFileDescriptor[] pipe = ParcelFileDescriptor.createPipe();
            pipeIn = pipe[0];
            pipeOut = new ParcelFileDescriptor.AutoCloseOutputStream(pipe[1]);
            intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, pipeIn);
            intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1);
            intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT);
            intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, RATE);
            intent.putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_AUDIO_SOURCE);
            recognizer.startListening(intent);
        } catch (Exception e) {
            switchToMic();
        }
    }

    // ------------------------------------------------------------------ results

    private void finish() {
        if (stopTimeout != null) { main.removeCallbacks(stopTimeout); stopTimeout = null; }
        PluginCall call = stopCall;
        if (call == null) return;
        stopCall = null;
        destroyRecognizer();
        String text = finalText.toString().trim();
        if (!partialText.trim().isEmpty()) text = (text + " " + partialText.trim()).trim();
        JSObject ret = new JSObject();
        ret.put("transcript", text);
        ret.put("mode", mode);
        ret.put("durationMs", System.currentTimeMillis() - startedAt);
        ret.put("audio", pcm.size() > 0 ? Base64.encodeToString(wav(pcm.toByteArray()), Base64.NO_WRAP) : null);
        call.resolve(ret);
        reset();
    }

    private void destroyRecognizer() {
        if (recognizer != null) {
            try { recognizer.destroy(); } catch (Exception ignored) { }
            recognizer = null;
        }
    }

    private void reset() {
        pcm.reset();
        finalText.setLength(0);
        partialText = "";
        anyResult = false;
        triedOnDevice = false;
        mode = "none";
    }

    private void sendPartial() {
        JSObject ev = new JSObject();
        ev.put("text", (finalText.toString() + " " + partialText).trim());
        notifyListeners("partial", ev);
    }

    private void sendMode() {
        JSObject ev = new JSObject();
        ev.put("mode", mode);
        notifyListeners("mode", ev);
    }

    private void sendError(String message) {
        JSObject ev = new JSObject();
        ev.put("message", message);
        notifyListeners("error", ev);
    }

    private static byte[] wav(byte[] data) {
        int byteRate = RATE * 2;
        byte[] h = new byte[44];
        put(h, 0, "RIFF"); le32(h, 4, 36 + data.length); put(h, 8, "WAVE");
        put(h, 12, "fmt "); le32(h, 16, 16); le16(h, 20, 1); le16(h, 22, 1);
        le32(h, 24, RATE); le32(h, 28, byteRate); le16(h, 32, 2); le16(h, 34, 16);
        put(h, 36, "data"); le32(h, 40, data.length);
        byte[] out = new byte[44 + data.length];
        System.arraycopy(h, 0, out, 0, 44);
        System.arraycopy(data, 0, out, 44, data.length);
        return out;
    }

    private static void put(byte[] b, int at, String s) { for (int i = 0; i < 4; i++) b[at + i] = (byte) s.charAt(i); }
    private static void le32(byte[] b, int at, int v) { for (int i = 0; i < 4; i++) b[at + i] = (byte) (v >> (8 * i)); }
    private static void le16(byte[] b, int at, int v) { b[at] = (byte) v; b[at + 1] = (byte) (v >> 8); }
}
