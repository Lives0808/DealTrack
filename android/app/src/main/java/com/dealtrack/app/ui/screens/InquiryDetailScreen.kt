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
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dealtrack.app.data.model.Message
import com.dealtrack.app.ui.UiState
import com.dealtrack.app.ui.components.EmptyHint
import com.dealtrack.app.ui.components.KeyValueRow
import com.dealtrack.app.ui.components.SectionCard
import com.dealtrack.app.ui.components.StatusChip
import com.dealtrack.app.ui.components.durationText
import com.dealtrack.app.ui.components.formatPercent
import com.dealtrack.app.ui.components.inquiryChip
import com.dealtrack.app.ui.components.intentLabel
import com.dealtrack.app.ui.components.languageLabel
import com.dealtrack.app.ui.components.marginColor
import com.dealtrack.app.ui.components.quoteChip
import com.dealtrack.app.ui.components.shortDateTime

/**
 * 询盘详情 — the mobile version of the web drawer.
 *
 * Layout order matches what a salesperson needs in the first three seconds:
 * what the AI understood → what it wants to send → only then the raw email.
 */
@Composable
fun InquiryDetailScreen(
    state: UiState,
    inquiryId: String,
    onBack: () -> Unit,
    onGenerateQuote: () -> Unit,
    onApprove: (String) -> Unit,
    onOpenQuote: (String) -> Unit,
) {
    val inquiry = state.inquiry

    LazyColumn(
        contentPadding = PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(11.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回") }
                Column(Modifier.weight(1f)) {
                    Text(inquiry?.code ?: "…", style = MaterialTheme.typography.titleMedium)
                    Text(
                        inquiry?.customer?.company ?: inquiry?.fromName ?: "",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (inquiry != null) StatusChip(inquiryChip(inquiry.status))
            }
        }

        if (inquiry == null) {
            item { SectionCard { EmptyHint("加载中…") } }
            return@LazyColumn
        }

        // ---- What the AI understood ---------------------------------------
        item {
            SectionCard(title = "AI 解析结果") {
                if (inquiry.summaryZh.isNullOrBlank()) {
                    EmptyHint("尚未解析", "点下方「生成报价」让销售智能体接手")
                } else {
                    Text(inquiry.summaryZh!!, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.height(8.dp))
                    KeyValueRow("置信度", formatPercent(inquiry.parseConfidence, 0))
                    KeyValueRow("意图", intentLabel(inquiry.detectedIntent))
                    KeyValueRow("客户语言", languageLabel(inquiry.language) + " · 回复将使用该语言")
                    val parsed = inquiry.parsed
                    parsed?.get("incoterm")?.let { KeyValueRow("贸易条款", it.toString().trim('"')) }
                    parsed?.get("destination")?.let { KeyValueRow("目标市场", it.toString().trim('"')) }
                    parsed?.get("destination_port")?.let { KeyValueRow("目的港", it.toString().trim('"')) }
                }

                if (inquiry.missingInfo.isNotEmpty()) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "缺少信息：" + inquiry.missingInfo.joinToString("、"),
                        style = MaterialTheme.typography.bodySmall,
                        color = Color(0xFFD97706),
                    )
                }

                if (inquiry.productMatches.isEmpty() && inquiry.status != "new") {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "未匹配到产品库，需要人工指定产品或先补齐产品库",
                        style = MaterialTheme.typography.bodySmall,
                        color = Color(0xFFD02F2F),
                    )
                }
            }
        }

        // ---- Line items ----------------------------------------------------
        val items = inquiry.items.orEmpty()
        if (items.isNotEmpty()) {
            item {
                SectionCard(title = "产品匹配", subtitle = "${items.size} 行") {
                    items.forEach { item ->
                        Column(Modifier.padding(vertical = 5.dp)) {
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    item.description ?: item.rawText ?: "—",
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = FontWeight.Medium,
                                    modifier = Modifier.weight(1f),
                                )
                                Text(
                                    "${item.qty?.toInt() ?: 0} ${item.unit ?: ""}",
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                            Row(Modifier.fillMaxWidth()) {
                                if (item.sku != null) {
                                    Text(item.sku, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                Spacer(Modifier.weight(1f))
                                if (item.matchConfidence != null) {
                                    Text(
                                        "匹配 " + formatPercent(item.matchConfidence, 0),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = if (item.matchConfidence >= 0.6) Color(0xFF1C7A3D) else Color(0xFFD97706),
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }

        // ---- Drafts awaiting a human ---------------------------------------
        val drafts = inquiry.messages?.filter { it.status == "pending_approval" }.orEmpty()
        if (drafts.isNotEmpty()) {
            item {
                SectionCard(title = "待你确认的回复草稿", subtitle = "AI 已经写好了，你只需要点发送") {
                    drafts.forEach { message -> MessageBlock(message, onApprove) }
                }
            }
        }

        // ---- Quotes --------------------------------------------------------
        val quotes = inquiry.quotes.orEmpty()
        if (quotes.isNotEmpty()) {
            item {
                SectionCard(title = "报价单", subtitle = "${quotes.size} 张") {
                    quotes.forEach { quote ->
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .padding(vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(quote.quoteNo, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                                Text(
                                    "${quote.incoterm} ${quote.incotermPlace} · ${quote.currency} ${quote.total}",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            if (quote.marginPct != null) {
                                Text(
                                    formatPercent(quote.marginPct, 1),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = marginColor(quote.marginPct),
                                )
                                Spacer(Modifier.width(8.dp))
                            }
                            StatusChip(quoteChip(quote.status))
                            Spacer(Modifier.width(6.dp))
                            OutlinedButton(onClick = { onOpenQuote(quote.id) }) { Text("查看") }
                        }
                    }
                }
            }
        }

        // ---- Raw email last ------------------------------------------------
        item {
            SectionCard(title = "客户原文") {
                KeyValueRow("发件人", inquiry.fromEmail ?: inquiry.fromPhone ?: "—")
                KeyValueRow("收到", shortDateTime(inquiry.receivedAt))
                KeyValueRow("渠道", inquiry.channel)
                if (inquiry.firstResponseSeconds != null) {
                    KeyValueRow("首次响应", durationText(inquiry.firstResponseSeconds) + " （已在 SLA 内）", Color(0xFF1C7A3D))
                }
                Spacer(Modifier.height(8.dp))
                Text(inquiry.body ?: "(空)", style = MaterialTheme.typography.bodySmall)
            }
        }

        item {
            Button(
                onClick = onGenerateQuote,
                enabled = !state.loading,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Icons.Filled.AutoAwesome, contentDescription = null)
                Text("  生成报价 + 回复草稿")
            }
        }

        item { Spacer(Modifier.height(12.dp)) }
    }
}

@Composable
private fun MessageBlock(message: Message, onApprove: (String) -> Unit) {
    Column(Modifier.padding(vertical = 6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                message.subject ?: "(无主题)",
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.weight(1f),
            )
            Text(
                languageLabel(message.language),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(Modifier.height(5.dp))
        Text(message.body, style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(8.dp))
        Button(onClick = { onApprove(message.id) }) {
            Icon(Icons.AutoMirrored.Filled.Send, contentDescription = null)
            Text("  确认发送")
        }
    }
}

