package site.amoeba.shoptalk.internal

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.graphics.ColorUtils

/**
 * The "never a white screen" fallback (FR-M08): message, Retry and an optional
 * hotline, drawn natively because the WebView it replaces is the thing that failed.
 * Opaque white with dark text to match the forced-light WebView.
 */
internal class ShopTalkErrorView(
    context: Context,
    title: String,
    message: String,
    retryLabel: String,
    hotlineLabel: String?,
    onRetry: () -> Unit,
    onHotline: () -> Unit,
) : LinearLayout(context) {

    init {
        orientation = VERTICAL
        gravity = Gravity.CENTER
        setBackgroundColor(Color.WHITE)
        val pad = dp(24)
        setPadding(pad, pad, pad, pad)
        // Swallow touches so nothing leaks through to the hidden WebView below.
        isClickable = true

        addView(text("⚠", 40f, Color.parseColor("#B45309"), bold = false))
        addView(text(title, 18f, Color.parseColor("#111827"), bold = true).also { setTopMargin(it, 12) })
        addView(text(message, 14f, Color.parseColor("#4B5563"), bold = false).also { setTopMargin(it, 8) })

        addView(
            Button(context).apply {
                text = retryLabel
                minimumHeight = dp(48)
                setOnClickListener { onRetry() }
                styleWithHostAccent(this)
            }.also { setTopMargin(it, 20) },
        )

        if (hotlineLabel != null) {
            addView(
                text(hotlineLabel, 14f, Color.parseColor("#2563EB"), bold = true).also {
                    it.minHeight = dp(48)
                    it.setOnClickListener { onHotline() }
                    setTopMargin(it, 8)
                },
            )
        }
    }

    /**
     * The host app's brand colour: its own `colorPrimary` (AppCompat, MaterialComponents and Material 3
     * themes all define it, and it is the colour apps actually set), else the platform `colorAccent`.
     * Null when the theme gives a colour state list or nothing, and the platform button stays.
     */
    @Suppress("DiscouragedApi") // the attribute is the host's own, only its name is known here
    private fun hostAccent(): Int? {
        val hostPrimary = context.resources.getIdentifier("colorPrimary", "attr", context.packageName)
        val value = TypedValue()
        for (attr in intArrayOf(hostPrimary, android.R.attr.colorAccent)) {
            if (attr == 0) continue
            if (context.theme.resolveAttribute(attr, value, true) &&
                value.type in TypedValue.TYPE_FIRST_COLOR_INT..TypedValue.TYPE_LAST_COLOR_INT
            ) {
                return value.data
            }
        }
        return null
    }

    /**
     * The retry button wears the host's brand colour, so the one screen drawn natively does not look
     * like a stranger in the app.
     */
    private fun styleWithHostAccent(button: Button) {
        val accent = hostAccent() ?: return
        button.background = GradientDrawable().apply {
            setColor(accent)
            cornerRadius = dp(24).toFloat()
        }
        button.setTextColor(if (ColorUtils.calculateLuminance(accent) > 0.5) Color.parseColor("#111827") else Color.WHITE)
        button.isAllCaps = false
        button.setPadding(dp(28), 0, dp(28), 0)
    }

    private fun text(value: String, sp: Float, color: Int, bold: Boolean) = TextView(context).apply {
        text = value
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
        setTextColor(color)
        gravity = Gravity.CENTER
        if (bold) setTypeface(typeface, Typeface.BOLD)
    }

    private fun setTopMargin(view: View, dp: Int) {
        view.layoutParams = LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(dp)
        }
    }

    private fun dp(value: Int): Int =
        TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics,
        ).toInt()
}
