package com.daylight.share.ui

import android.text.format.DateUtils
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.LocalOverscrollFactory
import androidx.compose.foundation.border
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.FlowRowScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LocalMinimumInteractiveComponentSize
import androidx.compose.material3.LocalRippleConfiguration
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RippleConfiguration
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.daylight.share.App
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import kotlin.math.floor

val Ink = Color(0xFF000000)
val Paper = Color(0xFFFFFFFF)
val Pencil = Color(0xFF444444)
val Wash = Color(0xFFF0F0F0)

private fun scheme(comfort: Boolean) = lightColorScheme(
    primary = Ink, onPrimary = Paper, primaryContainer = Wash, onPrimaryContainer = Ink,
    secondary = Ink, onSecondary = Paper, secondaryContainer = Wash, onSecondaryContainer = Ink,
    tertiary = Ink, onTertiary = Paper, tertiaryContainer = Wash, onTertiaryContainer = Ink,
    background = Paper, onBackground = Ink, surface = Paper, onSurface = Ink,
    // Comfort: secondary text and outlines are as dark as the rest.
    surfaceVariant = Wash, onSurfaceVariant = if (comfort) Ink else Pencil, surfaceTint = Paper,
    inverseSurface = Ink, inverseOnSurface = Paper, inversePrimary = Paper,
    error = Ink, onError = Paper, errorContainer = Wash, onErrorContainer = Ink,
    outline = Ink, outlineVariant = if (comfort) Ink else Color(0xFF888888), scrim = Ink,
    surfaceBright = Paper, surfaceDim = Wash, surfaceContainer = Paper, surfaceContainerHigh = Paper,
    surfaceContainerHighest = Wash, surfaceContainerLow = Paper, surfaceContainerLowest = Paper,
)

private fun typography(comfort: Boolean) = Typography().let { t ->
    t.copy(
        headlineSmall = t.headlineSmall.copy(fontWeight = FontWeight.Bold, fontSize = 26.sp),
        titleLarge = t.titleLarge.copy(fontWeight = FontWeight.Bold, fontSize = 22.sp),
        titleMedium = t.titleMedium.copy(fontWeight = FontWeight.Bold, fontSize = 18.sp),
        bodyLarge = t.bodyLarge.copy(fontSize = 18.sp, lineHeight = 25.sp),
        bodyMedium = t.bodyMedium.copy(fontSize = 16.sp, lineHeight = 22.sp),
        bodySmall = t.bodySmall.copy(fontSize = 14.sp, lineHeight = 19.sp, color = if (comfort) Ink else Pencil),
        labelLarge = t.labelLarge.copy(fontSize = 17.sp, fontWeight = FontWeight.Bold),
    )
}

/** Comfort's text size: x1.3 on top of the system's font scale (F27). */
const val COMFORT_TEXT_SCALE = 1.3f

/** Comfort's smallest touch target, and the usual one. */
val COMFORT_TARGET = 56.dp
val USUAL_TARGET = 48.dp

/** Whether Comfort is on for this composition (DaylightTheme provides it). */
val LocalComfort = staticCompositionLocalOf { false }

/**
 * The system's density with text [COMFORT_TEXT_SCALE] times larger. Text sizes go through [toDp] (the system's own
 * conversion, non-linear font scaling included, then x1.3); everything else is the system's.
 */
private class ComfortDensity(private val base: Density) : Density {
    override val density: Float get() = base.density
    override val fontScale: Float get() = base.fontScale * COMFORT_TEXT_SCALE
    override fun TextUnit.toDp(): Dp = with(base) { this@toDp.toDp() } * COMFORT_TEXT_SCALE
    override fun Dp.toSp(): TextUnit = with(base) { (this@toSp / COMFORT_TEXT_SCALE).toSp() }
    override fun equals(other: Any?) = other is ComfortDensity && other.base == base
    override fun hashCode() = base.hashCode() * 31 + 13
}

/**
 * Black on white, large type, no colour: made for the DC-1's e-paper screen, fine on a phone. It follows the app's
 * Comfort switch, and in the Inbox role (the DC-1) nothing moves: no ripples, no stretch at the end of a list, and the
 * app's own controls and fields are static.
 */
@Composable
fun DaylightTheme(content: @Composable () -> Unit) {
    val app = LocalContext.current.applicationContext as? App
    val comfort = app?.comfort?.collectAsState()?.value ?: false
    val role = app?.role?.collectAsState()?.value
    DaylightTheme(comfort = comfort, still = comfort || role == com.daylight.share.Role.INBOX, content = content)
}

/**
 * The theme with Comfort ([comfort]: text x1.3 via [LocalDensity], 56 dp touch targets, more contrast, no motion) and
 * [still] (no ripples and no overscroll stretch: the DC-1 Inbox, and Comfort).
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun DaylightTheme(comfort: Boolean, still: Boolean = comfort, content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = remember(comfort) { scheme(comfort) }, typography = remember(comfort) { typography(comfort) }) {
        val base = LocalDensity.current
        val density = remember(base, comfort) { if (comfort) ComfortDensity(base) else base }
        val overscroll = LocalOverscrollFactory.current
        // One provider whatever the values, so switching Comfort keeps every screen's state (where you are, what you typed).
        CompositionLocalProvider(
            LocalComfort provides comfort,
            LocalDensity provides density,
            LocalMinimumInteractiveComponentSize provides if (comfort) COMFORT_TARGET else USUAL_TARGET,
            LocalRippleConfiguration provides if (still) null else RippleConfiguration(),
            // Android 12+ stretches a list pulled past its end, and lets it spring back.
            LocalOverscrollFactory provides if (still) null else overscroll,
            content = content,
        )
    }
}

private val square = RoundedCornerShape(6.dp)

@Composable
fun PrimaryButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    val comfort = LocalComfort.current
    Button(
        onClick = onClick, enabled = enabled, shape = square,
        modifier = modifier.heightIn(min = if (comfort) COMFORT_TARGET else 52.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Ink, contentColor = Paper, disabledContainerColor = Wash, disabledContentColor = Pencil),
        elevation = null, // flat, and nothing rises under a pointer
    ) { Text(text) }
}

@Composable
fun SecondaryButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    val comfort = LocalComfort.current
    OutlinedButton(
        onClick = onClick, enabled = enabled, shape = square,
        modifier = modifier.heightIn(min = if (comfort) COMFORT_TARGET else USUAL_TARGET),
        border = BorderStroke(2.dp, if (enabled) Ink else Color(0xFF999999)),
        // Comfort: a disabled button's words stay readable (its pale border still says it is off).
        colors = if (comfort) ButtonDefaults.outlinedButtonColors(contentColor = Ink, disabledContentColor = Pencil) else ButtonDefaults.outlinedButtonColors(contentColor = Ink),
    ) { Text(text) }
}

/** The smallest touch target here: 56 dp with Comfort, else 48 dp. */
@Composable
fun target(): Dp = if (LocalComfort.current) COMFORT_TARGET else USUAL_TARGET

/** A button that is only its words ("OK", "Remove"); with Comfort it is as tall as the others. */
@Composable
fun TextAction(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    TextButton(onClick = onClick, modifier = if (LocalComfort.current) modifier.heightIn(min = COMFORT_TARGET) else modifier) { Text(text) }
}

/** A row of buttons that wraps onto the next line when they do not fit (large text, Comfort, narrow phones). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun Buttons(modifier: Modifier = Modifier, content: @Composable FlowRowScope.() -> Unit) {
    FlowRow(
        modifier,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        content = content,
    )
}

/**
 * A screen's or a list's header: [title] with a [button] at its end; with Comfort the button goes under the title, so
 * large text never squeezes either.
 */
@Composable
fun HeaderRow(title: @Composable ColumnScope.() -> Unit, button: @Composable () -> Unit) {
    if (LocalComfort.current) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            title()
            button()
        }
    } else {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), content = title)
            button()
        }
    }
}

/**
 * A status line that changes while the screen is open ("Delivered ✓", "In your Reader ✓", a share's result): screen
 * readers announce each change (F27).
 */
fun Modifier.announced(): Modifier = semantics { liveRegion = LiveRegionMode.Polite }

/** How many lines a title shows before it ends in "…": all of them with Comfort (F27.4). */
@Composable
fun titleLines(usual: Int): Int = if (LocalComfort.current) Int.MAX_VALUE else usual

/**
 * A switch as one control: the label (and a line under it) and a static on/off mark; the whole row toggles, so a
 * screen reader reads the label with the state. It never animates (the DC-1's e-paper, Comfort's "no motion"); on and
 * off differ in shape (the thumb's side, a filled track and a check mark), not colour.
 */
@Composable
fun SwitchRow(label: String, checked: Boolean, detail: String? = null, onChange: (Boolean) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = target())
            .toggleable(value = checked, role = Role.Switch, onValueChange = onChange),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.bodyLarge)
            if (detail != null) Text(detail, style = MaterialTheme.typography.bodySmall)
        }
        SwitchMark(checked, Modifier.padding(start = 12.dp))
    }
}

@Composable
private fun SwitchMark(on: Boolean, modifier: Modifier = Modifier) {
    Canvas(modifier.size(52.dp, 32.dp)) {
        val line = 2.dp.toPx()
        val r = size.height / 2
        drawRoundRect(if (on) Ink else Paper, cornerRadius = CornerRadius(r))
        drawRoundRect(Ink, topLeft = Offset(line / 2, line / 2), size = Size(size.width - line, size.height - line), cornerRadius = CornerRadius(r), style = Stroke(line))
        val thumb = r - 6.dp.toPx()
        val cx = if (on) size.width - r else r
        drawCircle(if (on) Paper else Ink, thumb, Offset(cx, r))
        if (on) {
            val check = Path().apply {
                moveTo(cx - thumb * 0.5f, r)
                lineTo(cx - thumb * 0.12f, r + thumb * 0.4f)
                lineTo(cx + thumb * 0.52f, r - thumb * 0.42f)
            }
            drawPath(check, Ink, style = Stroke(line, cap = StrokeCap.Round, join = StrokeJoin.Round))
        }
    }
}

/**
 * One choice of several: the whole row selects (one control for a screen reader, with its [detail]); a static radio
 * mark, ringed, filled when chosen. Put the choices of one question in a `Modifier.selectableGroup()`.
 */
@Composable
fun Choice(label: String, selected: Boolean, detail: String? = null, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = target())
            .selectable(selected = selected, role = Role.RadioButton, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioMark(selected, Modifier.padding(horizontal = 12.dp))
        Column(Modifier.weight(1f).padding(start = 4.dp)) {
            Text(label, style = MaterialTheme.typography.bodyLarge)
            if (detail != null) Text(detail, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun RadioMark(on: Boolean, modifier: Modifier = Modifier) {
    Canvas(modifier.size(22.dp)) {
        val line = 2.dp.toPx()
        drawCircle(Ink, size.minDimension / 2 - line / 2, style = Stroke(line))
        if (on) drawCircle(Ink, size.minDimension / 2 - 5.dp.toPx())
    }
}

@Composable
fun Section(title: String? = null, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = square,
        border = BorderStroke(2.dp, Ink),
        colors = CardDefaults.cardColors(containerColor = Paper, contentColor = Ink),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (title != null) Text(title, style = MaterialTheme.typography.titleMedium)
            content()
        }
    }
}

/**
 * A one-line text field that never moves (F27: Comfort's "no motion", and the DC-1 Inbox never animates). Material's
 * text fields slide their label into the border and fade the border on focus; here the [label] always sits above the
 * box, focus thickens the border at once, and [placeholder] shows while the field is focused and empty. The label is
 * part of the field for a screen reader ("Pairing code, edit box"); [errorText] is its error (the sentence under it
 * says it in words).
 */
@Composable
fun Field(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    errorText: String? = null,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
) {
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val style = MaterialTheme.typography.bodyLarge.copy(color = Ink)
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = if (errorText != null) modifier.semantics { error(errorText) } else modifier,
        textStyle = style,
        keyboardOptions = keyboardOptions,
        keyboardActions = keyboardActions,
        singleLine = true,
        interactionSource = source,
        cursorBrush = SolidColor(Ink),
        decorationBox = { inner ->
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(label, style = MaterialTheme.typography.bodyMedium)
                Box(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = target())
                        .border(if (focused) 3.dp else 2.dp, Ink, square)
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    if (focused && value.isEmpty() && placeholder != null) {
                        // It wraps rather than run past the box at large text sizes.
                        Text(placeholder, style = style.copy(color = MaterialTheme.colorScheme.onSurfaceVariant))
                    }
                    inner()
                }
            }
        },
    )
}

/**
 * The small card shown by the translucent activities (sharing, hand-off). Tapping outside it closes it. [close] adds a
 * Close button (with an [action], or alone for someone who needs time to read it).
 */
@Composable
fun StatusCard(text: String, action: Pair<String, () -> Unit>? = null, onDismiss: (() -> Unit)? = null, close: Boolean = action != null) {
    val none = remember { MutableInteractionSource() }
    Box(
        Modifier
            .fillMaxSize()
            .clickable(interactionSource = none, indication = null, enabled = onDismiss != null) { onDismiss?.invoke() }
            .navigationBarsPadding()
            .padding(16.dp),
        contentAlignment = Alignment.BottomCenter,
    ) {
        Card(
            modifier = Modifier.widthIn(max = 520.dp).fillMaxWidth()
                .clickable(interactionSource = none, indication = null) { },
            shape = square,
            border = BorderStroke(2.dp, Ink),
            colors = CardDefaults.cardColors(containerColor = Paper, contentColor = Ink),
            elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        ) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Daylight Share", style = MaterialTheme.typography.bodySmall)
                Text(text, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.announced())
                if (action != null || (close && onDismiss != null)) {
                    Buttons {
                        if (action != null) PrimaryButton(action.first) { action.second() }
                        if (close && onDismiss != null) SecondaryButton("Close") { onDismiss() }
                    }
                }
            }
        }
    }
}

/** What a screen reader says for the pairing QR code. */
const val QR_DESCRIPTION = "QR code for pairing"

/** A QR code drawn module by module, black on white with a quiet zone. */
@Composable
fun QrCode(content: String, modifier: Modifier = Modifier) {
    val matrix = remember(content) {
        QRCodeWriter().encode(
            content, BarcodeFormat.QR_CODE, 0, 0,
            mapOf(EncodeHintType.MARGIN to 2, EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M),
        )
    }
    Canvas(modifier.aspectRatio(1f).background(Paper).semantics { contentDescription = QR_DESCRIPTION }) {
        val n = matrix.width
        val cell = floor(size.minDimension / n)
        val off = (size.minDimension - cell * n) / 2
        for (y in 0 until n) for (x in 0 until n) {
            if (matrix.get(x, y)) drawRect(Ink, Offset(off + x * cell, off + y * cell), Size(cell, cell))
        }
    }
}

@Composable
fun Mono(text: String, modifier: Modifier = Modifier, size: Int = 22) {
    Text(text, modifier = modifier, style = TextStyle(fontFamily = FontFamily.Monospace, fontSize = size.sp, fontWeight = FontWeight.Bold, color = Ink, letterSpacing = 1.sp))
}

@Composable
fun Gap(h: Int = 8) = Spacer(Modifier.height(h.dp))

fun ago(ms: Long): String {
    if (ms <= 0) return ""
    val d = System.currentTimeMillis() - ms
    return when {
        d < 60_000 -> "just now"
        d < 3_600_000 -> "${d / 60_000} min ago"
        else -> DateUtils.getRelativeTimeSpanString(ms, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS).toString()
    }
}

/**
 * A size for people in the units of the status sentences (CHANGES-v1.1 2.5): decimal and rounded up, so a row's size
 * matches "Files can be up to 9 MB; this one is 14.2 MB." From 1 MB through `formatMB` ("8 MB", "14.2 MB"), below it
 * in KB ("124 KB").
 */
fun sizeText(bytes: Long): String = when {
    bytes <= 0 -> ""
    bytes < 1_000 -> "$bytes B"
    bytes <= 999_000 -> "${(bytes + 999) / 1_000} KB"
    else -> "${com.daylight.share.core.Text.formatMB(bytes)} MB"
}
