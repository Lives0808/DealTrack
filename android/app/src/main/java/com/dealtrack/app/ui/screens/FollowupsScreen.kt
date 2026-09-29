package com.dealtrack.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dealtrack.app.ui.UiState
import com.dealtrack.app.ui.components.EmptyHint
import com.dealtrack.app.ui.components.SectionCard
import com.dealtrack.app.ui.components.StatusChip
import com.dealtrack.app.ui.components.followupChip
import com.dealtrack.app.ui.components.formatMoney
import com.dealtrack.app.ui.components.languageLabel
import com.dealtrack.app.ui.components.relativeTime
import com.dealtrack.app.ui.components.shortDateTime
import java.time.Duration
import java.time.Instant

private val FOLLOWUP_FILTERS = listOf(
    "scheduled" to "待跟进",
    "pending_approval" to "待确认",
    "sent" to "已发出",
    "replied" to "客户已回",
    "all" to "全部",
)

/**
 * 跟进看板 — this is the screen that makes "不漏跟" tangible on a phone.
 * Overdue items sort first and are colour-flagged, because the whole promise is
 * that nothing rots in a list nobody opens.
 */
@Composable
fun FollowupsScreen(
    state: UiState,
    onFilter: (String) -> Unit,
    onDraft: (String) -> Unit,
    onSend: (String) -> Unit,
    onSnooze: (String, Int) -> Unit,
) {
    var filter by remember { mutableStateOf("scheduled") }
    val now = Instant.now()

    Column(Modifier.fillMaxWidth()) {
        LazyRow(
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            items(FOLLOWUP_FILTERS) { (value, label) ->
                FilterChip(
                    selected = filter == value,
                    onClick = {
                        filter = value
                        onFilter(value)
                    },
                    label = { Text(label) },
                )
            }
        }

        LazyColumn(
            contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 88.dp),
            verticalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            if (state.followups.isEmpty()) {
                item {
                    SectionCard {
                        EmptyHint(
                            "暂无待跟进",
                            "给一张报价单点「批准并发送」，系统会自动排好整条跟进节奏（默认 D+3 / D+7 / D+14 / D+30）",
                        )
                    }
                }
            }

            items(state.followups, key = { it.id }) { followup ->
                val overdueSeconds = try {
                    Duration.between(Instant.parse(followup.dueAt), now).seconds
                } catch (error: Exception) {
                    0L
                }
                val overdue = overdueSeconds > 0 && followup.status in listOf("scheduled", "pending_approval")

                SectionCard {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "第 ${followup.sequenceNo} 次跟进",
                            style = MaterialTheme.typography.titleSmall,
                            color = if (overdue) Color(0xFFD02F2F) else MaterialTheme.colorScheme.onSurface,
                        )
                        Spacer(Modifier.weight(1f))
                        StatusChip(followupChip(followup.status))
                    }
                    Spacer(Modifier.height(3.dp))
                    Text(
                        followup.customer?.company ?: "—",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                    )
                    followup.quote?.let { quote ->
                        Text(
                            "${quote.quoteNo} · ${formatMoney(quote.total, quote.currency)}",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Spacer(Modifier.height(5.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "到期 " + shortDateTime(followup.dueAt),
                            style = MaterialTheme.typography.bodySmall,
                            color = if (overdue) Color(0xFFD02F2F) else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            if (overdue) "已逾期 ${overdueSeconds / 3600} 小时" else relativeTime(followup.dueAt),
                            style = MaterialTheme.typography.labelSmall,
                            color = if (overdue) Color(0xFFD02F2F) else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Text(
                        languageLabel(followup.language) + " · 将以客户语言发送",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )

                    if (!followup.subject.isNullOrBlank()) {
                        Spacer(Modifier.height(7.dp))
                        Text(followup.subject!!, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium)
                        if (!followup.body.isNullOrBlank()) {
                            Text(
                                followup.body!!,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 3,
                            )
                        }
                    }

                    if (followup.status in listOf("scheduled", "pending_approval")) {
                        Spacer(Modifier.height(9.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                            OutlinedButton(onClick = { onDraft(followup.id) }) {
                                Icon(Icons.Filled.AutoAwesome, contentDescription = null)
                                Text(" 起草")
                            }
                            Button(onClick = { onSend(followup.id) }) {
                                Icon(Icons.AutoMirrored.Filled.Send, contentDescription = null)
                                Text(" 发送")
                            }
                            OutlinedButton(onClick = { onSnooze(followup.id, 3) }) { Text("延后3天") }
                        }
                    }
                }
            }
        }
    }
}
