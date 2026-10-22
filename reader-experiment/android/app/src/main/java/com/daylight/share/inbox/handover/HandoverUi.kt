package com.daylight.share.inbox.handover

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.daylight.share.App
import com.daylight.share.R
import com.daylight.share.ui.MainActivity
import com.daylight.share.ui.SecondaryButton
import com.daylight.share.ui.Section
import com.daylight.share.ui.announced
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/*
 * The handover's words (LAB-PLAN 5.3.4; card K6): in the Lab card (Inbox role, Lab on) and at the top of the Inbox while
 * another app receives. The sentences are the plan's, in the K6 block of `res/values/strings.xml`: LAB_TEXT has no
 * handover strings yet (reported to the share lane). Nothing here moves (F27): the note appears and goes at once.
 */

/** The test tag of the handover's line on the Inbox screen. */
const val HANDOVER_TAG = "lab-handover"

/**
 * The handover's rows inside the Lab card (Inbox role, Lab on; LAB-PLAN 6.3: K6's rows): while the Lab Reader receives,
 * [HandoverStatus]; else, when the Lab Reader is installed, **Let Daylight Reader (lab) receive**, which arms the
 * 2-minute grant and shows "Open Daylight Reader (lab) › Settings › Labs › Send to Daylight and choose Take over." until
 * the grant is used or lapses. Without the Lab Reader (every DC-1 but the lab tablet) nothing.
 */
@Composable
fun HandoverRows(activity: MainActivity) {
    val app = App.of(activity)
    val st by app.handover.state.collectAsStateWithLifecycle()
    var installed by remember { mutableStateOf(false) }
    LaunchedEffect(activity.resumes.intValue, st.elsewhere) {
        installed = withContext(Dispatchers.IO) { app.handover.labReaderInstalled() }
    }
    if (st.elsewhere != null) {
        HandoverStatus(activity, st)
        return
    }
    if (!installed) return
    // Shown while armed; one recomposition when the grant lapses (no ticking: nothing on screen counts down).
    var lapsed by remember { mutableIntStateOf(0) }
    LaunchedEffect(st.armedUntil) {
        val left = st.armedUntil - app.handover.now()
        if (left > 0) {
            delay(left + 100)
            lapsed++
        }
    }
    val armed = remember(st.armedUntil, lapsed) { app.handover.armed() }
    SecondaryButton(stringResource(R.string.handover_let), Modifier.fillMaxWidth()) { app.handover.arm() }
    if (armed) Text(stringResource(R.string.handover_armed), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.announced())
}

/** The Inbox screen's line while another app receives for this Daylight (Lab on or off: it says why nothing arrives). */
@Composable
fun HandoverLine(activity: MainActivity) {
    val st by App.of(activity).handover.state.collectAsStateWithLifecycle()
    if (st.elsewhere == null) return
    Section(modifier = Modifier.testTag(HANDOVER_TAG)) { HandoverStatus(activity, st) }
}

/**
 * "Daylight Reader (lab) receives for this Daylight now.", then the Reader's last answer, asked again whenever the
 * screen shows: can't be reached ("Can’t reach Daylight Reader (lab) right now.", announced), or not receiving
 * (**Receive here again**, which asks once more and resumes only on another "not receiving").
 */
@Composable
fun HandoverStatus(activity: MainActivity, st: Handover.State) {
    val app = App.of(activity)
    val scope = rememberCoroutineScope()
    LaunchedEffect(activity.resumes.intValue, st.elsewhere) {
        withContext(Dispatchers.IO) { app.handover.check() }
    }
    Text(stringResource(R.string.handover_elsewhere), style = MaterialTheme.typography.bodyLarge)
    when (st.reach) {
        Handover.Reach.UNREACHABLE ->
            Text(stringResource(R.string.handover_unreachable), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.announced())
        Handover.Reach.NOT_RECEIVING -> SecondaryButton(stringResource(R.string.handover_receive_here), Modifier.fillMaxWidth()) {
            scope.launch { withContext(Dispatchers.IO) { app.handover.receiveHereAgain() } }
        }
        Handover.Reach.RECEIVING, null -> Unit
    }
}
