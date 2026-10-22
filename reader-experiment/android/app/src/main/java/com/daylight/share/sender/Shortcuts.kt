package com.daylight.share.sender

import android.content.Context
import android.content.Intent
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import com.daylight.share.App
import com.daylight.share.R
import com.daylight.share.Role
import com.daylight.share.core.lab.LabText
import com.daylight.share.logi
import com.daylight.share.logw
import com.daylight.share.ui.MainActivity

/**
 * F08: your Daylight in the share sheet's top row (Direct Share). One long-lived dynamic shortcut, id [ID], in the
 * category [CATEGORY] that `res/xml/shortcuts.xml` makes a share target of `ShareActivity`; its short label is the
 * Daylight's name cut to 10 characters with "…", its long label the name. It is pushed on every send (and updated when
 * the name changes), and removed on Unpair, when Lab or F08's Use switch goes off, and in the Inbox role. The id is
 * stable, so it survives updates. A share that arrives through it carries `EXTRA_SHORTCUT_ID` = [ID] and sends as
 * any other share does.
 */
object Shortcuts {
    const val ID = "daylight"
    const val CATEGORY = "com.daylight.share.category.SEND_TO_DAYLIGHT"
    const val SHORT_MAX = 10

    /** The short label: [name] as it is up to 10 characters, else its first 9 and "…". */
    fun shortLabel(name: String): String {
        val cps = name.codePointCount(0, name.length)
        if (cps <= SHORT_MAX) return name
        return name.substring(0, name.offsetByCodePoints(0, SHORT_MAX - 1)) + "…"
    }

    private fun wanted(app: App): Boolean =
        app.prefs.role == Role.SENDER && app.sender.pairing() != null && PhoneLab.useOn(app, "F08")

    /** Pushes (or updates) the shortcut for the current pairing, when F08 is in use; otherwise removes it. Never throws. */
    fun push(app: App) {
        if (!wanted(app)) {
            remove(app)
            return
        }
        val name = app.sender.pairing()?.name?.ifEmpty { null } ?: LabText["shareInPlace.yourDaylight"]
        try {
            val info = ShortcutInfoCompat.Builder(app, ID)
                .setShortLabel(shortLabel(name))
                .setLongLabel(name)
                .setIcon(IconCompat.createWithResource(app, R.mipmap.ic_launcher))
                .setIntent(Intent(Intent.ACTION_MAIN, null, app, MainActivity::class.java))
                .setLongLived(true)
                .setCategories(setOf(CATEGORY))
                .setRank(0)
                .build()
            ShortcutManagerCompat.pushDynamicShortcut(app, info)
        } catch (e: Exception) {
            logw("lab: could not push the Direct Share shortcut", e)
        }
    }

    /** Updates the shortcut's labels when it exists (a new name); never adds one. */
    fun update(app: App) {
        if (exists(app)) push(app)
    }

    /** Removes the shortcut, dynamic and long-lived. Never throws. */
    fun remove(context: Context) {
        try {
            val had = exists(context)
            ShortcutManagerCompat.removeDynamicShortcuts(context, listOf(ID))
            ShortcutManagerCompat.removeLongLivedShortcuts(context, listOf(ID))
            if (had) logi("lab: Direct Share shortcut removed")
        } catch (e: Exception) {
            logw("lab: could not remove the Direct Share shortcut", e)
        }
    }

    /** Whether the shortcut is there (dynamic shortcuts of this app). */
    fun exists(context: Context): Boolean = runCatching {
        ShortcutManagerCompat.getDynamicShortcuts(context).any { it.id == ID }
    }.getOrDefault(false)
}
