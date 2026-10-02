package com.shieldguard.app

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.os.Bundle
import android.os.Message
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.webkit.*
import android.widget.Button
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream

class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private lateinit var urlBar: EditText
    private lateinit var stats: TextView
    private lateinit var shieldBtn: Button
    private lateinit var progress: ProgressBar

    private val blockedHosts = HashSet<String>()
    private var annoyancesJson = "null"
    private var overlayJs = ""
    private var shieldOn = true
    private var blockedRequests = 0
    private var blockedPopups = 0
    private var blockedRedirects = 0

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        web = findViewById(R.id.web); urlBar = findViewById(R.id.url)
        stats = findViewById(R.id.stats); shieldBtn = findViewById(R.id.shield)
        progress = findViewById(R.id.progress)

        loadRules()
        shieldOn = getSharedPreferences("sg", MODE_PRIVATE).getBoolean("shield", true)
        updateShieldButton()

        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.javaScriptCanOpenWindowsAutomatically = false
        web.settings.setSupportMultipleWindows(true)
        web.settings.allowFileAccess = false
        web.settings.allowContentAccess = false
        web.webViewClient = Client()
        web.webChromeClient = Chrome()

        findViewById<Button>(R.id.back).setOnClickListener { if (web.canGoBack()) web.goBack() }
        shieldBtn.setOnClickListener {
            shieldOn = !shieldOn
            getSharedPreferences("sg", MODE_PRIVATE).edit().putBoolean("shield", shieldOn).apply()
            updateShieldButton(); web.reload()
        }
        urlBar.setOnEditorActionListener { _, id, ev ->
            if (id == EditorInfo.IME_ACTION_GO || ev?.keyCode == KeyEvent.KEYCODE_ENTER) { go(urlBar.text.toString()); true } else false
        }
        go(intent?.dataString ?: "https://example.com")
    }

    private fun loadRules() {
        for (f in assets.list("rules").orEmpty()) {
            val text = assets.open("rules/$f").bufferedReader().use { it.readText() }
            if (f == "annoyances.json") { annoyancesJson = text; continue }
            val arr = try { JSONArray(text) } catch (e: Exception) { continue }
            for (i in 0 until arr.length()) {
                val filter = arr.getJSONObject(i).optJSONObject("condition")?.optString("urlFilter") ?: continue
                if (filter.startsWith("||") && filter.endsWith("^")) blockedHosts.add(filter.substring(2, filter.length - 1).lowercase())
            }
        }
        overlayJs = assets.open("overlay-filter.js").bufferedReader().use { it.readText() }
    }

    private fun isBlocked(host: String?): Boolean {
        var h = host?.lowercase() ?: return false
        while (h.isNotEmpty()) {
            if (blockedHosts.contains(h)) return true
            val dot = h.indexOf('.')
            if (dot < 0) return false
            h = h.substring(dot + 1)
        }
        return false
    }

    private fun go(input: String) {
        val t = input.trim()
        val url = when {
            t.startsWith("http://") || t.startsWith("https://") -> t
            t.contains(".") && !t.contains(" ") -> "https://$t"
            else -> "https://duckduckgo.com/?q=" + java.net.URLEncoder.encode(t, "UTF-8")
        }
        web.loadUrl(url)
    }

    private fun updateShieldButton() { shieldBtn.text = if (shieldOn) "Shield ON" else "Shield OFF" }
    private fun updateStats() {
        runOnUiThread { stats.text = "Blocked: $blockedRequests requests · $blockedPopups popups · $blockedRedirects redirects" }
    }

    private inner class Client : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, req: WebResourceRequest): WebResourceResponse? {
            if (shieldOn && isBlocked(req.url.host)) {
                blockedRequests++; updateStats()
                return WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(ByteArray(0)))
            }
            return null
        }

        override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
            if (!shieldOn || !req.isForMainFrame) return false
            val scheme = req.url.scheme ?: ""
            val badHost = isBlocked(req.url.host)
            // Block ad-network hosts and non-web schemes that load without a user tap.
            if (badHost || (!req.hasGesture() && scheme != "http" && scheme != "https")) {
                blockedRedirects++; updateStats(); return true
            }
            return false
        }

        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) { urlBar.setText(url); progress.visibility = View.VISIBLE }
        override fun onPageFinished(view: WebView, url: String) {
            progress.visibility = View.GONE
            if (shieldOn) view.evaluateJavascript("window.__SG_ANNOY=$annoyancesJson;\n$overlayJs", null)
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onProgressChanged(view: WebView, p: Int) { progress.progress = p }
        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
            if (shieldOn && !isUserGesture) { blockedPopups++; updateStats(); return false }
            // User-initiated new window: open it in this same view.
            val transport = resultMsg.obj as WebView.WebViewTransport
            val tmp = WebView(this@MainActivity)
            tmp.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean {
                    if (!isBlocked(r.url.host) || !shieldOn) web.loadUrl(r.url.toString()) else { blockedPopups++; updateStats() }
                    v.destroy(); return true
                }
            }
            transport.webView = tmp; resultMsg.sendToTarget(); return true
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { if (web.canGoBack()) web.goBack() else super.onBackPressed() }
}
