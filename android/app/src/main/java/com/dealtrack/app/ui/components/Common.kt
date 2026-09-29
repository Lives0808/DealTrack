package com.dealtrack.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.time.Duration
import java.time.Instant
import java.util.Locale

// ---------------------------------------------------------------------------
// Formatting — shared so a number never appears two different ways in the app
// ---------------------------------------------------------------------------

fun formatMoney(value: Double?, currency: String = "USD", digits: Int = 2): String {
    if (value == null) return "—"
    return "$currency " + String.format(Locale.US, "%,.${digits}f", value)
}

fun formatCompact(value: Double): String {
    val symbol = when {
        value < 0 -> "-"
        else -> ""
    }
    val absolute = kotlin.math.abs(value)
    return symbol + when {
        absolute >= 1_000_000 -> String.format(Locale.US, "$%.2fM", absolute / 1_000_000)
        absolute >= 1_000 -> String.format(Locale.US, "$%.1fK", absolute / 1_000)
        else -> String.format(Locale.US, "$%.0f", absolute)
    }
}

fun formatNumber(value: Double?, digits: Int = 0): String {
    if (value == null) return "—"
    return String.format(Locale.US, "%,.${digits}f", value)
}

fun formatPercent(value: Double?, digits: Int = 1): String {
    if (value == null) return "—"
    return String.format(Locale.US, "%.${digits}f%%", value * 100)
}

fun formatLatency(ms: Int?): String {
    if (ms == null) return "—"
    return if (ms < 1000) "${ms}ms" else String.format(Locale.US, "%.2fs", ms / 1000.0)
}

/** "3 小时前" style relative time, computed from the ISO timestamps the API returns. */
fun relativeTime(iso: String?): String {
    if (iso.isNullOrBlank()) return "—"
    return try {
        val then = Instant.parse(iso)
        val seconds = Duration.between(then, Instant.now()).seconds
        when {
            seconds < 0 -> "刚刚"
            seconds < 60 -> "${seconds}秒前"
            seconds < 3600 -> "${seconds / 60}分钟前"
            seconds < 86_400 -> "${seconds / 3600}小时前"
            seconds < 2_592_000 -> "${seconds / 86_400}天前"
            else -> "${seconds / 2_592_000}个月前"
        }
    } catch (error: Exception) {
        iso.take(16).replace('T', ' ')
    }
}

fun shortDateTime(iso: String?): String {
    if (iso.isNullOrBlank()) return "—"
    return try {
        val instant = Instant.parse(iso)
        val local = java.time.ZonedDateTime.ofInstant(instant, java.time.ZoneId.systemDefault())
        String.format(
            Locale.US,
            "%02d-%02d %02d:%02d",
            local.monthValue, local.dayOfMonth, local.hour, local.minute,
        )
    } catch (error: Exception) {
        iso.take(16).replace('T', ' ')
    }
}

fun durationText(seconds: Double?): String {
    if (seconds == null) return "—"
    return when {
        seconds < 60 -> "${seconds.toInt()}秒"
        seconds < 3600 -> String.format(Locale.US, "%.1f分钟", seconds / 60)
        seconds < 86_400 -> String.format(Locale.US, "%.1f小时", seconds / 3600)
        else -> String.format(Locale.US, "%.1f天", seconds / 86_400)
    }
}

// ---------------------------------------------------------------------------
// Status chips — one vocabulary shared by every screen
// ---------------------------------------------------------------------------

data class ChipStyle(val label: String, val container: Color, val content: Color)

fun inquiryChip(status: String?): ChipStyle = when (status) {
    "new" -> ChipStyle("新询盘", Color(0xFFFFF4E5), Color(0xFFA75B00))
    "parsed" -> ChipStyle("已解析", Color(0xFFE8F1FA), Color(0xFF0B5CAD))
    "quoted" -> ChipStyle("已报价", Color(0xFFE8F1FA), Color(0xFF0B5CAD))
    "nurturing" -> ChipStyle("培育中", Color(0xFFF0F3F7), Color(0xFF5A6472))
    "won" -> ChipStyle("已成交", Color(0xFFE8F5EC), Color(0xFF1C7A3D))
    "lost" -> ChipStyle("已丢单", Color(0xFFFDECEC), Color(0xFFB32424))
    else -> ChipStyle(status ?: "—", Color(0xFFF0F3F7), Color(0xFF5A6472))
}

fun quoteChip(status: String?): ChipStyle = when (status) {
    "draft" -> ChipStyle("草稿", Color(0xFFF0F3F7), Color(0xFF5A6472))
    "pending_approval" -> ChipStyle("待审批", Color(0xFFFFF4E5), Color(0xFFA75B00))
    "sent" -> ChipStyle("已发出", Color(0xFFE8F1FA), Color(0xFF0B5CAD))
    "accepted" -> ChipStyle("已成交", Color(0xFFE8F5EC), Color(0xFF1C7A3D))
    "rejected" -> ChipStyle("已丢单", Color(0xFFFDECEC), Color(0xFFB32424))
    "expired" -> ChipStyle("已过期", Color(0xFFFDECEC), Color(0xFFB32424))
    else -> ChipStyle(status ?: "—", Color(0xFFF0F3F7), Color(0xFF5A6472))
}

fun followupChip(status: String?): ChipStyle = when (status) {
    "scheduled" -> ChipStyle("已排程", Color(0xFFE8F1FA), Color(0xFF0B5CAD))
    "pending_approval" -> ChipStyle("待确认", Color(0xFFFFF4E5), Color(0xFFA75B00))
    "sent" -> ChipStyle("已发出", Color(0xFFE8F5EC), Color(0xFF1C7A3D))
    "replied" -> ChipStyle("客户已回", Color(0xFFE8F5EC), Color(0xFF1C7A3D))
    "skipped" -> ChipStyle("已跳过", Color(0xFFF0F3F7), Color(0xFF5A6472))
    else -> ChipStyle(status ?: "—", Color(0xFFF0F3F7), Color(0xFF5A6472))
}

fun agentChip(status: String?): ChipStyle = when (status) {
    "busy" -> ChipStyle("工作中", Color(0xFFE8F1FA), Color(0xFF0B5CAD))
    "idle" -> ChipStyle("空闲", Color(0xFFE8F5EC), Color(0xFF1C7A3D))
    "paused" -> ChipStyle("已暂停", Color(0xFFF0F3F7), Color(0xFF5A6472))
    "error" -> ChipStyle("异常", Color(0xFFFDECEC), Color(0xFFB32424))
    else -> ChipStyle(status ?: "—", Color(0xFFF0F3F7), Color(0xFF5A6472))
}

fun marginColor(margin: Double?): Color = when {
    margin == null -> Color(0xFF8B949F)
    margin >= 0.25 -> Color(0xFF1C7A3D)
    margin >= 0.15 -> Color(0xFF0B5CAD)
    margin >= 0.08 -> Color(0xFFD97706)
    else -> Color(0xFFD02F2F)
}

/** Language label — Arabic is flagged so RTL content is obvious at a glance. */
fun languageLabel(code: String?): String = when (code?.lowercase()) {
    "en" -> "EN"
    "zh" -> "ZH"
    "es" -> "ES"
    "fr" -> "FR"
    "de" -> "DE"
    "ru" -> "RU"
    "ar" -> "AR · RTL"
    "pt" -> "PT"
    "ja" -> "JA"
    "ko" -> "KO"
    "it" -> "IT"
    "tr" -> "TR"
    "vi" -> "VI"
    "th" -> "TH"
    "id" -> "ID"
    "pl" -> "PL"
    "nl" -> "NL"
    null -> "—"
    else -> code.uppercase()
}

fun intentLabel(code: String?): String = when (code) {
    "rfq" -> "询价"
    "price_objection" -> "嫌贵"
    "lead_time_question" -> "问交期"
    "certification_question" -> "问认证"
    "payment_question" -> "问付款"
    "sample_request" -> "要样品"
    "order_placement" -> "要下单"
    "rejection" -> "明确拒绝"
    "complaint" -> "投诉"
    "shipping_question" -> "问物流"
    "general_inquiry" -> "一般咨询"
    null -> "未分类"
    else -> code
}

fun lossReasonLabel(code: String?): String = when (code) {
    "price" -> "价格偏高"
    "lead_time" -> "交期太长"
    "quality" -> "质量/规格不符"
    "payment_terms" -> "付款条件不接受"
    "moq" -> "起订量过高"
    "certification" -> "认证不满足"
    "shipping" -> "运费过高"
    "competitor" -> "被竞品拿下"
    "no_budget" -> "客户预算取消"
    "no_response" -> "客户失联"
    "spec_mismatch" -> "规格不匹配"
    else -> "其他"
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

@Composable
fun StatusChip(style: ChipStyle, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(6.dp))
            .background(style.container)
            .padding(horizontal = 7.dp, vertical = 2.dp),
    ) {
        Text(
            text = style.label,
            style = MaterialTheme.typography.labelSmall,
            color = style.content,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
        )
    }
}

@Composable
fun SectionCard(
    title: String? = null,
    subtitle: String? = null,
    modifier: Modifier = Modifier,
    trailing: @Composable (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(Modifier.padding(14.dp)) {
            if (title != null) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(title, style = MaterialTheme.typography.titleSmall)
                        if (subtitle != null) {
                            Text(
                                subtitle,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    trailing?.invoke()
                }
                Spacer(Modifier.height(10.dp))
            }
            content()
        }
    }
}

@Composable
fun KpiCard(
    label: String,
    value: String,
    hint: String? = null,
    valueColor: Color = MaterialTheme.colorScheme.onSurface,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(Modifier.padding(13.dp)) {
            Text(
                label,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                value,
                style = MaterialTheme.typography.headlineSmall,
                color = valueColor,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (hint != null) {
                Spacer(Modifier.height(2.dp))
                Text(
                    hint,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
fun KeyValueRow(label: String, value: String, valueColor: Color = MaterialTheme.colorScheme.onSurface) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.width(88.dp),
        )
        Text(
            value,
            style = MaterialTheme.typography.bodyMedium,
            color = valueColor,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
fun EmptyHint(title: String, hint: String? = null, padding: PaddingValues = PaddingValues(vertical = 36.dp)) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(padding),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (hint != null) {
            Spacer(Modifier.height(4.dp))
            Text(
                hint,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        }
    }
}

/** A horizontal progress bar used for funnel steps and win rates. */
@Composable
fun ThinBar(progress: Float, color: Color, modifier: Modifier = Modifier) {
    Box(
        modifier
            .fillMaxWidth()
            .height(7.dp)
            .clip(RoundedCornerShape(4.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Box(
            Modifier
                .fillMaxWidth(progress.coerceIn(0.02f, 1f))
                .height(7.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(color),
        )
    }
}
