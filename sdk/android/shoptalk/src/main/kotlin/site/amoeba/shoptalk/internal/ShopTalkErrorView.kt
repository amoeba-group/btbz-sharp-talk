package site.amoeba.shoptalk.internal

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

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
