package com.baize.writing;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SpeechInputPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
