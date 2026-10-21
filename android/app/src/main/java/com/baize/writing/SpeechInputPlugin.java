package com.baize.writing;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.view.View;
import android.view.inputmethod.InputMethodManager;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;

/**
 * 语音输入插件。
 *
 * 两种能力:
 *  1) showKeyboard() —— 强制弹出输入法软键盘。WebView 里 textarea.focus() 常常弹不出来,
 *     必须走 InputMethodManager.showSoftInput,否则"输入法语音"这条路根本走不通。
 *  2) start() —— 系统 RecognizerIntent。部分设备语音服务被停用时不可用,仅作备用。
 *  3) diagnose() —— 探测本机可用方案,便于前端给出准确提示而不是瞎猜。
 */
@CapacitorPlugin(name = "SpeechInput")
public class SpeechInputPlugin extends Plugin {

    /* ---------------- 输入法键盘 ---------------- */

    @PluginMethod
    public void showKeyboard(PluginCall call) {
        Activity act = getActivity();
        if (act == null) {
            call.reject("no activity");
            return;
        }
        act.runOnUiThread(() -> {
            try {
                InputMethodManager imm = (InputMethodManager)
                        act.getSystemService(Context.INPUT_METHOD_SERVICE);
                View target = act.getCurrentFocus();
                if (target == null) target = act.getWindow().getDecorView();
                if (imm != null) {
                    imm.showSoftInput(target, InputMethodManager.SHOW_FORCED);
                    // 某些 ROM 需要再 toggle 一次才真正显示
                    if (!imm.isAcceptingText()) {
                        imm.toggleSoftInput(InputMethodManager.SHOW_FORCED, 0);
                    }
                }
                call.resolve();
            } catch (Exception e) {
                call.reject("showKeyboard failed: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void hideKeyboard(PluginCall call) {
        Activity act = getActivity();
        if (act == null) { call.resolve(); return; }
        act.runOnUiThread(() -> {
            try {
                InputMethodManager imm = (InputMethodManager)
                        act.getSystemService(Context.INPUT_METHOD_SERVICE);
                View target = act.getCurrentFocus();
                if (target == null) target = act.getWindow().getDecorView();
                if (imm != null) imm.hideSoftInputFromWindow(target.getWindowToken(), 0);
            } catch (Exception ignored) {
            }
            call.resolve();
        });
    }

    /* ---------------- 诊断 ---------------- */

    @PluginMethod
    public void diagnose(PluginCall call) {
        JSObject ret = new JSObject();
        boolean recognition = false;
        try {
            recognition = SpeechRecognizer.isRecognitionAvailable(getContext());
        } catch (Throwable ignored) {
        }
        ret.put("systemRecognition", recognition);

        // 当前输入法包名(判断是不是搜狗/讯飞这种自带语音的)
        String ime = "";
        try {
            String id = android.provider.Settings.Secure.getString(
                    getContext().getContentResolver(),
                    android.provider.Settings.Secure.DEFAULT_INPUT_METHOD);
            if (id != null) ime = id;
        } catch (Throwable ignored) {
        }
        ret.put("inputMethod", ime);

        String lower = ime.toLowerCase();
        boolean thirdPartyVoice = lower.contains("sogou") || lower.contains("iflytek")
                || lower.contains("baidu") || lower.contains("sohu");
        ret.put("inputMethodHasOwnVoice", thirdPartyVoice);

        call.resolve(ret);
    }

    /* ---------------- 系统识别(备用) ---------------- */

    @ActivityCallback
    private void speechResult(PluginCall call, ActivityResult result) {
        if (call == null || call.isReleased()) return;
        int code = result.getResultCode();
        Intent data = result.getData();
        if (code == Activity.RESULT_OK && data != null) {
            ArrayList<String> texts = data.getStringArrayListExtra(
                    RecognizerIntent.EXTRA_RESULTS);
            if (texts != null && !texts.isEmpty()) {
                JSObject ret = new JSObject();
                ret.put("text", texts.get(0));
                notifyListeners("speechResult", ret);
            } else {
                JSObject err = new JSObject();
                err.put("code", "empty_result");
                notifyListeners("speechError", err);
            }
        } else {
            JSObject err = new JSObject();
            err.put("code", code == Activity.RESULT_CANCELED ? "canceled" : ("code_" + code));
            notifyListeners("speechError", err);
        }
        call.resolve();
    }

    @PluginMethod
    public void start(PluginCall call) {
        String lang = call.getString("lang", "zh-CN");

        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            JSObject err = new JSObject();
            err.put("code", "no_recognition_service");
            notifyListeners("speechError", err);
            call.reject("设备没有可用的语音识别服务");
            return;
        }

        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
        intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "请说话…");
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);

        try {
            startActivityForResult(call, intent, "speechResult");
        } catch (ActivityNotFoundException e) {
            JSObject err = new JSObject();
            err.put("code", "no_recognition_service");
            notifyListeners("speechError", err);
            call.reject("设备没有可用的语音识别服务");
        } catch (Exception e) {
            JSObject err = new JSObject();
            err.put("code", "start_failed");
            notifyListeners("speechError", err);
            call.reject("语音启动失败: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        call.resolve();
    }
}
