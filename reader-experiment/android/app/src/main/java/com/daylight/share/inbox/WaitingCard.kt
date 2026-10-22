package com.daylight.share.inbox

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.annotation.VisibleForTesting
import com.daylight.share.App
import com.daylight.share.Prefs
import com.daylight.share.logi
import com.daylight.share.logw

/**
 * A small card over whatever is in front (on the Daylight, the full-screen Reader) for items that wait for a tap:
 * "New PDF from iPhone", the title, **Add to Reader** and **Later**. It needs "Display over other apps", which the Inbox
 * has on the Daylight for its background hand-offs, and does not depend on the system showing a heads-up notification
 * over the Reader (which lasts a few seconds, and an e-paper reader can miss). It stays until answered or until its
 * items are handed over; it takes no keyboard focus, and touches outside it go to the Reader.
 *
 * - **Add to Reader** hands the card's items over ([HandoffActivity.forItems], logged `by=card`).
 * - **Later** takes the card down; the items wait in the Inbox and in the notification shade, and the card does not
 *   come back for them ([Prefs.NOTICE_LATER]). With Lab on it reads **Keep for later** (F15): the items are also marked
 *   kept for later, so nothing hands them over until Add to Reader, and their senders see "Kept for later".
 *
 * Shown and updated by [Handoff.notifyWaiting], on the main thread.
 */
object WaitingCard {
    const val TAG_HEADING = "heading"
    const val TAG_BODY = "body"
    const val TAG_ADD = "add"
    const val TAG_LATER = "later"

    private var root: FrameLayout? = null

    /** The window's layout, while the card is up (tests). */
    @VisibleForTesting
    internal var params: WindowManager.LayoutParams? = null
        private set

    /** The ids of the items on the card, oldest first (empty when it is not up). */
    var ids: List<String> = emptyList()
        private set

    val showing: Boolean get() = root != null

    /** The card's view, while it is up (tests). */
    @VisibleForTesting
    internal val view: View? get() = root

    /**
     * Shows the card for [items], updates it when it is up, or takes it down when [items] is empty or "Display over other
     * apps" is not allowed. A card that is not up is shown only when [pop] (something new arrived). Returns whether the
     * card is up and shows [items].
     */
    fun update(context: Context, items: List<InboxItem>, pop: Boolean): Boolean {
        val app = context.applicationContext
        if (Looper.myLooper() != Looper.getMainLooper()) {
            Handler(Looper.getMainLooper()).post { update(app, items, pop) }
            return false
        }
        if (items.isEmpty() || !Settings.canDrawOverlays(app)) {
            hide(app)
            return false
        }
        val sorted = items.sortedBy { it.received }
        val current = root
        if (current != null) {
            if (ids != sorted.map { it.id }) {
                current.removeAllViews()
                current.addView(content(app, sorted))
                ids = sorted.map { it.id }
            }
            return true
        }
        if (!pop) return false
        val wm = app.getSystemService(WindowManager::class.java) ?: return false
        val frame = FrameLayout(app).apply { addView(content(app, sorted)) }
        val p = layout(app)
        return try {
            wm.addView(frame, p)
            root = frame
            params = p
            ids = sorted.map { it.id }
            true
        } catch (e: Exception) { // BadTokenException, or "Display over other apps" withdrawn just now
            logw("card not shown", e)
            false
        }
    }

    /** Takes the card down. */
    fun hide(context: Context) {
        val r = root ?: return
        root = null
        params = null
        ids = emptyList()
        runCatching { context.applicationContext.getSystemService(WindowManager::class.java)?.removeViewImmediate(r) }
            .onFailure { logw("card not removed", it) }
    }

    /** Drops the card without touching the window manager (each Robolectric test has a new application). */
    @VisibleForTesting
    internal fun forget() {
        root = null
        params = null
        ids = emptyList()
    }

    private fun add(context: Context, ids: List<String>) {
        hide(context)
        val app = context.applicationContext
        try {
            app.startActivity(HandoffActivity.forItems(app, ids, by = HandoffActivity.BY_CARD).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) {
            logw("hand-off from the card refused: ${e.message}")
        }
    }

    private fun later(context: Context, ids: List<String>) {
        val app = context.applicationContext as? App
        app?.prefs?.addNoticeIds(Prefs.NOTICE_LATER, ids)
        // Lab (F15): Keep for later: marked kept, so it waits for Add to Reader.
        if (app != null && app.prefs.lab) app.inbox.markHeld(ids)
        // Lab (F17): kept for later on purpose ("Kept for later on your Daylight").
        app?.labReporter?.held(ids)
        logi("card: later for ${ids.joinToString(",")}: waits in the Inbox")
        if (app != null) for (id in ids) app.inbox.get(id)?.let { com.daylight.share.sender.ActivityLog.add(app, "held", id, it.kind, "card") }
        hide(context)
    }

    /** Top centre, as wide as a phone at most, no focus (the Reader keeps its keys), touches outside it pass. */
    private fun layout(context: Context): WindowManager.LayoutParams {
        val dm = context.resources.displayMetrics
        val d = dm.density
        val width = minOf(dm.widthPixels - (32 * d).toInt(), (520 * d).toInt()).coerceAtLeast((200 * d).toInt())
        return WindowManager.LayoutParams(
            width,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            y = (24 * d).toInt()
            title = "Daylight Share"
        }
    }

    /**
     * Black on white with a black border, like the app (it is read on e-paper). With Comfort (F27) the text is 1.3 times
     * larger, nothing is cut short, the buttons are 56 dp tall and stacked; the heading is announced when it changes.
     */
    private fun content(context: Context, items: List<InboxItem>): View {
        val d = context.resources.displayMetrics.density
        fun dp(v: Int) = (v * d).toInt()
        val comfort = (context.applicationContext as? App)?.prefs?.comfort == true
        val scale = if (comfort) com.daylight.share.ui.COMFORT_TEXT_SCALE else 1f
        // Lab (F15): "Keep for later" for "Later", and excerpts from one sender grouped.
        val words = Notices.card(items, lab = (context.applicationContext as? App)?.prefs?.lab == true)
        val ids = items.map { it.id }
        val box = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(14), dp(18), dp(12))
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                setStroke(dp(2), Color.BLACK)
                cornerRadius = dp(12).toFloat()
            }
        }
        box.addView(TextView(context).apply {
            tag = TAG_HEADING
            text = words.heading
            setTextColor(Color.BLACK)
            textSize = 18f * scale
            setTypeface(typeface, Typeface.BOLD)
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        })
        box.addView(TextView(context).apply {
            tag = TAG_BODY
            text = words.body
            setTextColor(Color.BLACK)
            textSize = 16f * scale
            if (!comfort) {
                maxLines = 4
                ellipsize = TextUtils.TruncateAt.END
            }
            setPadding(0, dp(4), 0, dp(12))
        })
        val row = LinearLayout(context).apply {
            orientation = if (comfort) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL
            gravity = Gravity.END
        }
        if (comfort) {
            // Stacked, full width: Add to Reader first.
            val full = { top: Int -> LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = top } }
            row.addView(button(context, words.add, TAG_ADD, filled = true, comfort = true) { add(context, ids) }, full(0))
            row.addView(button(context, words.later, TAG_LATER, filled = false, comfort = true) { later(context, ids) }, full(dp(10)))
        } else {
            row.addView(button(context, words.later, TAG_LATER, filled = false) { later(context, ids) })
            row.addView(
                button(context, words.add, TAG_ADD, filled = true) { add(context, ids) },
                LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginStart = dp(12) },
            )
        }
        box.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        return box
    }

    private fun button(context: Context, label: String, tag: String, filled: Boolean, comfort: Boolean = false, onClick: () -> Unit): TextView {
        val d = context.resources.displayMetrics.density
        return TextView(context).apply {
            this.tag = tag
            text = label
            contentDescription = label
            textSize = 16f * (if (comfort) com.daylight.share.ui.COMFORT_TEXT_SCALE else 1f)
            gravity = Gravity.CENTER
            setTextColor(if (filled) Color.WHITE else Color.BLACK)
            minHeight = ((if (comfort) 56 else 48) * d).toInt()
            minWidth = (96 * d).toInt()
            setPadding((16 * d).toInt(), 0, (16 * d).toInt(), 0)
            background = GradientDrawable().apply {
                setColor(if (filled) Color.BLACK else Color.WHITE)
                setStroke((2 * d).toInt(), Color.BLACK)
                cornerRadius = 24 * d
            }
            isClickable = true
            setOnClickListener { onClick() }
        }
    }
}
