package com.daylight.share.inbox.handover

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.Binder
import android.os.Bundle
import com.daylight.share.App

/**
 * The handover's provider (LAB-PLAN 5.3.4 step 2; card K6), authority `com.daylight.share.handover`, exported: the
 * Lab Reader's `call("pairing")` gets `{code, relay, name, since}` while "Let Daylight Reader (lab) receive" is armed
 * ([Handover.pairingFor]), and only when the calling package is the Lab Reader's pinned id ([Handover.ALLOWED]). It
 * answers nothing else: no query, insert, update or delete, and no other method.
 */
open class HandoverProvider : ContentProvider() {
    override fun onCreate(): Boolean = true

    override fun call(method: String, arg: String?, extras: Bundle?): Bundle? {
        if (method != Handover.METHOD_PAIRING) return null
        val context = context ?: return null
        return App.of(context).handover.pairingFor(caller())
    }

    /**
     * The calling package, or null: `getCallingPackage()` (which Android checks against the calling uid), and that uid
     * must own it. Tests stand in for the Lab Reader by overriding this.
     */
    protected open fun caller(): String? {
        val pkg = runCatching { callingPackage }.getOrNull() ?: return null
        val uid = Binder.getCallingUid()
        val owns = runCatching { context?.packageManager?.getPackagesForUid(uid)?.contains(pkg) == true }.getOrDefault(false)
        return pkg.takeIf { owns }
    }

    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null

    override fun getType(uri: Uri): String? = null

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0
}
