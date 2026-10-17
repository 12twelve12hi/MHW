package com.daylight.share.ui

import android.text.format.DateUtils
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import kotlin.math.floor

val Ink = Color(0xFF000000)
val Paper = Color(0xFFFFFFFF)
val Pencil = Color(0xFF444444)
val Wash = Color(0xFFF0F0F0)

private val colors = lightColorScheme(
    primary = Ink, onPrimary = Paper, primaryContainer = Wash, onPrimaryContainer = Ink,
    secondary = Ink, onSecondary = Paper, secondaryContainer = Wash, onSecondaryContainer = Ink,
    tertiary = Ink, onTertiary = Paper, tertiaryContainer = Wash, onTertiaryContainer = Ink,
    background = Paper, onBackground = Ink, surface = Paper, onSurface = Ink,
    surfaceVariant = Wash, onSurfaceVariant = Pencil, surfaceTint = Paper,
    inverseSurface = Ink, inverseOnSurface = Paper, inversePrimary = Paper,
    error = Ink, onError = Paper, errorContainer = Wash, onErrorContainer = Ink,
    outline = Ink, outlineVariant = Color(0xFF888888), scrim = Ink,
    surfaceBright = Paper, surfaceDim = Wash, surfaceContainer = Paper, surfaceContainerHigh = Paper,
    surfaceContainerHighest = Wash, surfaceContainerLow = Paper, surfaceContainerLowest = Paper,
)

private val type = Typography().let { t ->
    t.copy(
        headlineSmall = t.headlineSmall.copy(fontWeight = FontWeight.Bold, fontSize = 26.sp),
        titleLarge = t.titleLarge.copy(fontWeight = FontWeight.Bold, fontSize = 22.sp),
        titleMedium = t.titleMedium.copy(fontWeight = FontWeight.Bold, fontSize = 18.sp),
        bodyLarge = t.bodyLarge.copy(fontSize = 18.sp, lineHeight = 25.sp),
        bodyMedium = t.bodyMedium.copy(fontSize = 16.sp, lineHeight = 22.sp),
        bodySmall = t.bodySmall.copy(fontSize = 14.sp, lineHeight = 19.sp, color = Pencil),
        labelLarge = t.labelLarge.copy(fontSize = 17.sp, fontWeight = FontWeight.Bold),
    )
}

/** Black on white, large type, no colour: made for the DC-1's e-paper screen, fine on a phone. */
@Composable
fun DaylightTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = colors, typography = type, content = content)
}

private val square = RoundedCornerShape(6.dp)

@Composable
fun PrimaryButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    Button(
        onClick = onClick, enabled = enabled, shape = square,
        modifier = modifier.heightIn(min = 52.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Ink, contentColor = Paper, disabledContainerColor = Wash, disabledContentColor = Pencil),
    ) { Text(text) }
}

@Composable
fun SecondaryButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick, enabled = enabled, shape = square,
        modifier = modifier.heightIn(min = 48.dp),
        border = BorderStroke(2.dp, if (enabled) Ink else Color(0xFF999999)),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = Ink),
    ) { Text(text) }
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

/** The small card shown by the translucent activities (sharing, hand-off). Tapping outside it closes it. */
@Composable
fun StatusCard(text: String, action: Pair<String, () -> Unit>? = null, onDismiss: (() -> Unit)? = null) {
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
                Text(text, style = MaterialTheme.typography.bodyLarge)
                if (action != null) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        PrimaryButton(action.first) { action.second() }
                        if (onDismiss != null) SecondaryButton("Close") { onDismiss() }
                    }
                }
            }
        }
    }
}

/** A QR code drawn module by module, black on white with a quiet zone. */
@Composable
fun QrCode(content: String, modifier: Modifier = Modifier) {
    val matrix = remember(content) {
        QRCodeWriter().encode(
            content, BarcodeFormat.QR_CODE, 0, 0,
            mapOf(EncodeHintType.MARGIN to 2, EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M),
        )
    }
    Canvas(modifier.aspectRatio(1f).background(Paper)) {
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

fun sizeText(bytes: Long): String = when {
    bytes <= 0 -> ""
    bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> "${bytes / 1024} KB"
    else -> String.format(java.util.Locale.US, "%.1f MB", bytes / 1048576.0)
}
