package com.baize.writing;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * 大模型调用插件(OpenAI 兼容接口)。
 *
 * 为什么必须走原生而不是 WebView 里 fetch:
 *  1) CORS —— Capacitor 的页面 Origin 是 https://localhost,直接 fetch 第三方接口会先发
 *     OPTIONS 预检,多数服务商不放行,报跨域错误。原生 HTTP 没有这个限制。
 *  2) 流式 —— 原生能边读边推给 JS,不用等整段生成完。
 *
 * 支持 stream=true(SSE),通过 notifyListeners("chunk") 增量推字。
 */
@CapacitorPlugin(name = "Llm")
public class LlmPlugin extends Plugin {

    @PluginMethod
    public void chat(PluginCall call) {
        final String url = call.getString("url", "");
        final String apiKey = call.getString("apiKey", "");
        final String body = call.getString("body", "");
        final boolean stream = Boolean.TRUE.equals(call.getBoolean("stream", false));

        if (url == null || url.isEmpty()) {
            call.reject("接口地址为空,请先在设置里填 Base URL");
            return;
        }
        if (body == null || body.isEmpty()) {
            call.reject("请求体为空");
            return;
        }
        call.setKeepAlive(true);

        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(20000);
                conn.setReadTimeout(180000);
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                conn.setRequestProperty("Accept", stream ? "text/event-stream" : "application/json");
                if (apiKey != null && !apiKey.isEmpty()) {
                    conn.setRequestProperty("Authorization", "Bearer " + apiKey);
                }

                byte[] payload = body.getBytes(StandardCharsets.UTF_8);
                conn.setFixedLengthStreamingMode(payload.length);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(payload);
                }

                int code = conn.getResponseCode();
                InputStream is = (code >= 400) ? conn.getErrorStream() : conn.getInputStream();
                if (is == null) {
                    call.reject("服务端没有返回内容 (HTTP " + code + ")", String.valueOf(code));
                    return;
                }

                if (code >= 400) {
                    String err = readAll(is);
                    call.reject(shortError(err, code), String.valueOf(code));
                    return;
                }

                String text;
                if (stream) {
                    text = readSse(is, call);
                } else {
                    text = extractContent(readAll(is));
                }

                JSObject ret = new JSObject();
                ret.put("text", text == null ? "" : text);
                ret.put("status", code);
                call.resolve(ret);

            } catch (Exception e) {
                call.reject("请求失败: " + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage()));
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    /* ---------------- 工具 ---------------- */

    private static String readAll(InputStream is) throws Exception {
        StringBuilder sb = new StringBuilder();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
            char[] buf = new char[4096];
            int n;
            while ((n = br.read(buf)) > 0) sb.append(buf, 0, n);
        }
        return sb.toString();
    }

    /** 非流式:从标准 chat.completions 响应里取正文 */
    private static String extractContent(String raw) {
        try {
            JSONObject o = new JSONObject(raw);
            JSONArray choices = o.optJSONArray("choices");
            if (choices == null || choices.length() == 0) return raw;
            JSONObject c0 = choices.getJSONObject(0);
            JSONObject msg = c0.optJSONObject("message");
            if (msg != null && msg.has("content")) return msg.optString("content", "");
            if (c0.has("text")) return c0.optString("text", "");
            return raw;
        } catch (Exception e) {
            return raw;
        }
    }

    /** 流式:逐行解析 SSE,边读边推 chunk,最后返回完整文本 */
    private String readSse(InputStream is, PluginCall call) throws Exception {
        StringBuilder full = new StringBuilder();
        StringBuilder raw = new StringBuilder();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
            String line;
            while ((line = br.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty() || line.startsWith(":")) continue;
                if (!line.startsWith("data:")) {
                    // 有些服务商无视 stream 参数,直接返回整段 JSON —— 先攒着做兜底
                    raw.append(line).append('\n');
                    continue;
                }
                String data = line.substring(5).trim();
                if ("[DONE]".equals(data)) break;

                String piece = null;
                try {
                    JSONObject o = new JSONObject(data);
                    JSONArray choices = o.optJSONArray("choices");
                    if (choices != null && choices.length() > 0) {
                        JSONObject c0 = choices.getJSONObject(0);
                        JSONObject delta = c0.optJSONObject("delta");
                        if (delta != null && delta.has("content")) {
                            piece = delta.optString("content", "");
                        } else if (c0.has("text")) {
                            piece = c0.optString("text", "");
                        }
                    }
                } catch (Exception ignore) {
                    // 单行解析失败不影响整体,继续读
                }

                if (piece != null && !piece.isEmpty()) {
                    full.append(piece);
                    pushChunk(piece);
                }
            }
        }
        // 一条 data: 都没解析出来 → 按普通 JSON 响应再解一次
        if (full.length() == 0 && raw.length() > 0) {
            String t = extractContent(raw.toString());
            if (t != null && !t.isEmpty() && !t.equals(raw.toString())) return t;
        }
        if (full.length() == 0) return null;
        return full.toString();
    }

    /** 后台线程读流,回 UI 线程再推事件,避免跨线程碰 WebView */
    private void pushChunk(String piece) {
        final JSObject chunk = new JSObject();
        chunk.put("text", piece);
        final Runnable job = () -> notifyListeners("chunk", chunk);
        try {
            if (getActivity() != null) getActivity().runOnUiThread(job);
            else job.run();
        } catch (Exception e) {
            job.run();
        }
    }

    /** 把服务端错误压成一句人话,别把整坨 HTML 甩给用户 */
    private static String shortError(String raw, int code) {
        if (raw == null || raw.isEmpty()) return "HTTP " + code;
        String msg = raw;
        try {
            JSONObject o = new JSONObject(raw);
            JSONObject err = o.optJSONObject("error");
            if (err != null) {
                msg = err.optString("message", raw);
            } else if (o.has("message")) {
                msg = o.optString("message", raw);
            }
        } catch (Exception ignore) { }
        if (msg.length() > 300) msg = msg.substring(0, 300) + "…";
        return "HTTP " + code + " · " + msg;
    }
}
