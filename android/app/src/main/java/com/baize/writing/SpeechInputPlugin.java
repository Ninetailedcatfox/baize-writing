package com.baize.writing;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.speech.RecognizerIntent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;

/**
 * 语音输入插件:走系统 RecognizerIntent。
 * 国产 ROM(小米/华为/OPPO/vivo 等)底层识别引擎一般是讯飞,无需额外 SDK。
 * 预留:后续接入讯飞 SDK 时,可在 start() 里优先探测讯飞服务,失败再回落 RecognizerIntent。
 */
@CapacitorPlugin(name = "SpeechInput")
public class SpeechInputPlugin extends Plugin {

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
        // RecognizerIntent 无法程序化停止,由前端不再续听即可
        call.resolve();
    }
}
