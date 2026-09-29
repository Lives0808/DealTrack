package com.dealtrack.app.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat

/** Brand palette — same blue as the web console so the two feel like one product. */
private val BrandBlue = Color(0xFF0B5CAD)
private val BrandBlueDark = Color(0xFF084A8C)
private val BrandBlueLight = Color(0xFFE8F1FA)
private val Success = Color(0xFF1C7A3D)
private val Warning = Color(0xFFD97706)
private val Danger = Color(0xFFD02F2F)

private val LightColors = lightColorScheme(
    primary = BrandBlue,
    onPrimary = Color.White,
    primaryContainer = BrandBlueLight,
    onPrimaryContainer = BrandBlueDark,
    secondary = Color(0xFF2E9BD6),
    onSecondary = Color.White,
    tertiary = Success,
    background = Color(0xFFF5F7FA),
    onBackground = Color(0xFF1C1F23),
    surface = Color.White,
    onSurface = Color(0xFF1C1F23),
    surfaceVariant = Color(0xFFF0F3F7),
    onSurfaceVariant = Color(0xFF5A6472),
    outline = Color(0xFFD6DCE3),
    error = Danger,
    onError = Color.White,
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF6FB3E8),
    onPrimary = Color(0xFF00325A),
    primaryContainer = Color(0xFF00497F),
    onPrimaryContainer = Color(0xFFD3E4FF),
    secondary = Color(0xFF8ECDF0),
    background = Color(0xFF12161B),
    onBackground = Color(0xFFE3E6EA),
    surface = Color(0xFF1A1F26),
    onSurface = Color(0xFFE3E6EA),
    surfaceVariant = Color(0xFF242B34),
    onSurfaceVariant = Color(0xFFB6BFC9),
    outline = Color(0xFF3A434E),
    error = Color(0xFFFF8A8A),
)

private val AppTypography = Typography(
    headlineSmall = TextStyle(fontSize = 21.sp, fontWeight = FontWeight.SemiBold),
    titleLarge = TextStyle(fontSize = 18.sp, fontWeight = FontWeight.SemiBold),
    titleMedium = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.SemiBold),
    titleSmall = TextStyle(fontSize = 13.5.sp, fontWeight = FontWeight.Medium),
    bodyLarge = TextStyle(fontSize = 14.sp),
    bodyMedium = TextStyle(fontSize = 13.sp),
    bodySmall = TextStyle(fontSize = 11.5.sp),
    labelLarge = TextStyle(fontSize = 13.sp, fontWeight = FontWeight.Medium),
    labelMedium = TextStyle(fontSize = 11.5.sp),
    labelSmall = TextStyle(fontSize = 10.5.sp, fontFamily = FontFamily.Monospace),
)

@Composable
fun DealTrackTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colors = if (darkTheme) DarkColors else LightColors

    // The window is edge-to-edge (see MainActivity.enableEdgeToEdge), so the
    // status bar is transparent and only the icon tint needs deciding: it sits on
    // the primary-coloured TopAppBar, so keep the icons light.
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = false
        }
    }

    MaterialTheme(colorScheme = colors, typography = AppTypography, content = content)
}
