package com.daylight.share.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.gestures.BringIntoViewSpec
import androidx.compose.foundation.gestures.ScrollableState
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MonotonicFrameClock
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.node.CompositionLocalConsumerModifierNode
import androidx.compose.ui.node.ModifierNodeElement
import androidx.compose.ui.node.currentValueOf
import androidx.compose.ui.node.requireLayoutCoordinates
import androidx.compose.ui.platform.InspectorInfo
import androidx.compose.ui.relocation.BringIntoViewModifierNode
import androidx.compose.ui.relocation.bringIntoView as askParentToShow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.yield
import kotlin.coroutines.coroutineContext
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/*
 * Scrolling that does not move (F27: Comfort's "no motion", and the DC-1 Inbox never animates).
 *
 * Compose brings a focused field into view with a short scroll animation: when a field is tapped while partly off the
 * screen, and when the keyboard opens over it. Compose 1.8 lets an app change neither its speed nor its curve
 * (BringIntoViewSpec's animation spec is deprecated and no longer read). So on a still screen DaylightTheme turns that
 * scrolling off ([NoBringIntoViewScroll]) and the app does it in one step instead: each screen gives its list's scroll
 * state and box ([rememberStillScroll], [stillViewport], [LocalStillScroll]); the app's fields, sections and header
 * rows answer a request to be shown ([stillBringIntoView]) by scrolling the list the needed distance at once; and a
 * focused [Field] stays in view when the list's box shrinks (the keyboard opening).
 */

/** Whether nothing may move here: the DC-1 Inbox, and Comfort (DaylightTheme provides it). */
val LocalStill = staticCompositionLocalOf { false }

/** A still screen's list ([rememberStillScroll]); null where things may move (the phone without Comfort). */
val LocalStillScroll = staticCompositionLocalOf<StillScroll?> { null }

/** No scrolling to bring something into view: on a still screen the app does that itself, in one step. */
@OptIn(ExperimentalFoundationApi::class)
internal object NoBringIntoViewScroll : BringIntoViewSpec {
    override fun calculateScrollDistance(offset: Float, size: Float, containerSize: Float): Float = 0f
}

/** A still screen's list: its scroll [state] and its box (set by [stillViewport]). */
@Stable
class StillScroll internal constructor(private val state: ScrollableState) {
    private var viewport: LayoutCoordinates? = null
    private val pending = ArrayList<Pair<LayoutCoordinates, () -> Rect?>>()
    private var answering = false

    /** The list box's height in pixels: a focused field follows it (the keyboard opening shrinks it). */
    var height by mutableIntStateOf(0)
        private set

    internal fun place(box: LayoutCoordinates) {
        viewport = box
        height = box.size.height
    }

    /**
     * Shows [bounds] (in [child]'s coordinates) in the list's box, scrolling it in one step, by Compose's own rule (the
     * nearer edge; nothing when it is already shown, or taller than the box). The requests of one frame are answered
     * together, on the next frame, so the layout has caught up with any earlier scroll and a field's two requests
     * (its box and its cursor's line) make one jump, not two.
     */
    internal suspend fun show(child: LayoutCoordinates, bounds: () -> Rect?) {
        pending += child to bounds
        if (answering) return
        answering = true
        try {
            while (pending.isNotEmpty()) {
                if (coroutineContext[MonotonicFrameClock] != null) withFrameNanos { } else yield()
                val batch = pending.toList()
                pending.clear()
                scrollToShow(batch)
            }
        } finally {
            pending.clear()
            answering = false
        }
    }

    private suspend fun scrollToShow(batch: List<Pair<LayoutCoordinates, () -> Rect?>>) {
        val box = viewport?.takeIf { it.isAttached } ?: return
        var shown: Rect? = null
        for ((c, b) in batch) {
            if (!c.isAttached) continue
            val r = b()?.translate(box.localBoundingBoxOf(c, clipBounds = false).topLeft) ?: continue
            val both = shown?.let { Rect(min(it.left, r.left), min(it.top, r.top), max(it.right, r.right), max(it.bottom, r.bottom)) }
            // Together when they fit (a field and its cursor), else the latest request.
            shown = if (both != null && both.height <= box.size.height) both else r
        }
        val distance = shown?.let { distanceToShow(it.top, it.bottom, box.size.height.toFloat()) } ?: 0f
        if (distance != 0f) state.scrollBy(distance)
    }

    companion object {
        /** How far to scroll so that [top]..[bottom] is in a box [height] tall: Compose's default rule. */
        fun distanceToShow(top: Float, bottom: Float, height: Float): Float = when {
            top >= 0f && bottom <= height -> 0f
            top < 0f && bottom > height -> 0f
            abs(top) < abs(bottom - height) -> top
            else -> bottom - height
        }
    }
}

/** The [StillScroll] of a list scrolled by [state] on a still screen, or null where things may move. */
@Composable
fun rememberStillScroll(state: ScrollableState): StillScroll? {
    val still = LocalStill.current
    return remember(state, still) { if (still) StillScroll(state) else null }
}

/** A screen that scrolls as a column (Settings, the role choice), still where it should be. */
@Composable
fun ScreenColumn(padding: Dp, content: @Composable ColumnScope.() -> Unit) {
    val scroll = rememberScrollState()
    val still = rememberStillScroll(scroll)
    CompositionLocalProvider(LocalStillScroll provides still) {
        Column(
            Modifier.fillMaxSize().stillViewport(still).verticalScroll(scroll).padding(padding),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            content = content,
        )
    }
}

/** A screen that is a list (the phone's home screen, the Inbox), still where it should be. */
@Composable
fun ScreenList(content: LazyListScope.() -> Unit) {
    val list = rememberLazyListState()
    val still = rememberStillScroll(list)
    CompositionLocalProvider(LocalStillScroll provides still) {
        LazyColumn(
            Modifier.fillMaxSize().stillViewport(still),
            state = list,
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            content = content,
        )
    }
}

/** Marks the list's box for [still]: on a LazyColumn, or just before `verticalScroll`. */
fun Modifier.stillViewport(still: StillScroll?): Modifier =
    if (still == null) this else onGloballyPositioned { still.place(it) }

/**
 * Answers a request to show this (or something in it) on a still screen: the list scrolls at once
 * ([StillScroll.show]). Elsewhere it passes the request on unchanged, and Compose scrolls as usual.
 */
fun Modifier.stillBringIntoView(): Modifier = this then StillBringIntoViewElement

private object StillBringIntoViewElement : ModifierNodeElement<StillBringIntoViewNode>() {
    override fun create() = StillBringIntoViewNode()
    override fun update(node: StillBringIntoViewNode) = Unit
    override fun InspectorInfo.inspectableProperties() {
        name = "stillBringIntoView"
    }
    override fun hashCode(): Int = 0x57111
    override fun equals(other: Any?): Boolean = other === this
}

private class StillBringIntoViewNode : Modifier.Node(), BringIntoViewModifierNode, CompositionLocalConsumerModifierNode {
    override suspend fun bringIntoView(childCoordinates: LayoutCoordinates, boundsProvider: () -> Rect?) {
        if (!isAttached) return
        val still = currentValueOf(LocalStillScroll)
        if (still != null) {
            still.show(childCoordinates, boundsProvider)
            return
        }
        val mine = requireLayoutCoordinates()
        askParentToShow {
            val r = boundsProvider()
            if (r == null || !mine.isAttached || !childCoordinates.isAttached) null
            else r.translate(mine.localBoundingBoxOf(childCoordinates, clipBounds = false).topLeft)
        }
    }
}
