package com.baize.writing;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 必须先生成 super.onCreate(初始化 Bridge),再注册插件,
        // 否则插件不会被 Capacitor 收集,前端 Capacitor.Plugins.SpeechInput 为 undefined。
        super.onCreate(savedInstanceState);
        registerPlugin(SpeechInputPlugin.class);
    }
}
