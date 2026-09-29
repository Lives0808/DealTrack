package com.dealtrack.app.ui.screens

import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import com.dealtrack.app.data.model.Quote
import com.dealtrack.app.ui.UiState
import com.dealtrack.app.ui.components.EmptyHint
import com.dealtrack.app.ui.components.KeyValueRow
import com.dealtrack.app.ui.components.SectionCard
import com.dealtrack.app.ui.components.StatusChip
import com.dealtrack.app.ui.components.formatMoney
import com.dealtrack.app.ui.components.formatPercent
import com.dealtrack.app.ui.components.languageLabel
import com.dealtrack.app.ui.components.marginColor
import com.dealtrack.app.ui.components.quoteChip
import com.dealtrack.app.ui.components.relativeTime
import com.dealtrack.app.ui.components.shortDateTime

private val QUOTE_FILTERS = listOf(
    "all" to "全部",
    "pending_approval" to "待审批",
    "sent" to "已发出",
    "accepted" to "成交",
    "rejected" to "丢单",
)

@Composable
fun QuotesScreen(state: UiState, onFilter: (String) -> Unit, onOpen: (Quote) -> Unit) {
    var filter by remember { mutableStateOf("all") }

    Column(Modifier.fillMaxWidth()) {
        LazyRow(
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            items(QUOTE_FILTERS) { (value, label) ->
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
            if (state.quotes.isEmpty()) {
                item {
                    SectionCard {
                        EmptyHint("还没有报价单", "从询盘详情点「生成报价」，AI 会算好价格并起草回复")
                    }
                }
            }
            items(state.quotes, key = { it.id }) { quote ->
                SectionCard(modifier = Modifier.clickable { onOpen(quote) }) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(quote.quoteNo, style = MaterialTheme.typography.titleSmall)
                        Spacer(Modifier.weight(1f))
                        StatusChip(quoteChip(quote.status))
                    }
                    Spacer(Modifier.height(3.dp))
                    Text(
                        quote.customer?.company ?: "—",
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                    )
                    Text(
                        "${quote.incoterm} ${quote.incotermPlace} · ${languageLabel(quote.language)}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(7.dp))
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            formatMoney(quote.total, quote.currency),
                            style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.weight(1f),
                        )
                        if (quote.marginPct != null) {
                            Text(
                                "毛利 " + formatPercent(quote.marginPct, 1),
                                style = MaterialTheme.typography.bodySmall,
                                color = marginColor(quote.marginPct),
                            )
                        }
                    }
                    val firstItem = quote.items?.firstOrNull()
                    if (firstItem != null) {
                        Text(
                            "${firstItem.qty.toInt()} ${firstItem.unit} × ${firstItem.description}",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                        )
                    }
                    Row(Modifier.fillMaxWidth()) {
                        Spacer(Modifier.weight(1f))
                        Text(
                            relativeTime(quote.createdAt),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun QuoteDetailScreen(
    state: UiState,
    onBack: () -> Unit,
    onSend: () -> Unit,
    onOpenDocument: (String) -> Unit,
    onOpenDeclaration: (String) -> Unit,
    onOpenProforma: (String) -> Unit,
    onRecordOutcome: (String, String, String?, String?) -> Unit,
    onMarkPaid: (String, Double) -> Unit,
    onRemindPayment: (String) -> Unit,
) {
    val quote = state.quote
    var outcomeFor by remember { mutableStateOf<Quote?>(null) }

    LazyColumn(
        contentPadding = PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(11.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回") }
                Column(Modifier.weight(1f)) {
                    Text(quote?.quoteNo ?: "…", style = MaterialTheme.typography.titleMedium)
                    Text(
                        quote?.customer?.company ?: "",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (quote != null) StatusChip(quoteChip(quote.status))
            }
        }

        if (quote == null) {
            item { SectionCard { EmptyHint("加载中…") } }
            return@LazyColumn
        }

        item {
            SectionCard {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
                    Column(Modifier.weight(1f)) {
                        Text("总价", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(
                            formatMoney(quote.total, quote.currency),
                            style = MaterialTheme.typography.headlineSmall,
                        )
                    }
                    if (quote.marginPct != null) {
                        Column(horizontalAlignment = Alignment.End) {
                            Text("毛利", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(
                                formatPercent(quote.marginPct, 1),
                                style = MaterialTheme.typography.titleMedium,
                                color = marginColor(quote.marginPct),
                            )
                        }
                    }
                }
                Spacer(Modifier.height(10.dp))
                KeyValueRow("客户", quote.customer?.company ?: "—")
                KeyValueRow("国家", quote.customer?.country ?: "—")
                KeyValueRow("贸易条款", "${quote.incoterm} ${quote.incotermPlace}")
                KeyValueRow("付款方式", quote.paymentTerms ?: "—")
                KeyValueRow("交货期", "${quote.leadTimeDays ?: "—"} 天")
                KeyValueRow("有效期至", shortDateTime(quote.validUntil))
                KeyValueRow("回复语言", languageLabel(quote.language))
                KeyValueRow("生成方", quote.createdBy)
            }
        }

        // ---- Line items with cost transparency -----------------------------
        item {
            SectionCard(title = "报价明细", subtitle = "${quote.items?.size ?: 0} 行") {
                quote.items.orEmpty().forEach { item ->
                    Column(Modifier.padding(vertical = 6.dp)) {
                        Text(item.description, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                        Row(Modifier.fillMaxWidth()) {
                            Text(
                                "${item.qty.toInt()} ${item.unit} × ${formatMoney(item.unitPrice, quote.currency, 4)}",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Spacer(Modifier.weight(1f))
                            Text(
                                formatMoney(item.amount, quote.currency),
                                style = MaterialTheme.typography.bodySmall,
                                fontWeight = FontWeight.Medium,
                            )
                        }
                        if (item.sku != null || item.hsCode != null) {
                            Text(
                                listOfNotNull(item.sku, item.hsCode?.let { "HS $it" }).joinToString(" · "),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
                val subtotal = quote.subtotal
                KeyValueRow("小计", formatMoney(subtotal, quote.currency))
                if (quote.discountAmount > 0) KeyValueRow("折扣", "−" + formatMoney(quote.discountAmount, quote.currency))
                if (quote.freight > 0) KeyValueRow("运费", formatMoney(quote.freight, quote.currency))
                if (quote.insurance > 0) KeyValueRow("保险", formatMoney(quote.insurance, quote.currency))
                KeyValueRow("成本", formatMoney(quote.costTotal, quote.currency))
                KeyValueRow("总价", formatMoney(quote.total, quote.currency), MaterialTheme.colorScheme.primary)
            }
        }

        // ---- Proforma invoice & money ---------------------------------------
        // The quote is only half the deal. Once it is won, the question changes
        // from "will they buy?" to "have they paid?" — and that is the half you
        // actually need on a phone.
        // Deliberately an `if` rather than `?.let {}`: inside a LazyColumn's
        // LazyListScope, `item` resolves more predictably from a direct branch
        // than from a lambda that hides the scope.
        val proforma = state.proforma
        if (proforma != null) {
            item {
                SectionCard(
                    title = "形式发票 ${proforma.piNo}",
                    subtitle = "签发 ${shortDateTime(proforma.issuedAt)} · ${proforma.incoterm} ${proforma.incotermPlace}",
                    trailing = {
                        OutlinedButton(onClick = { onOpenProforma(quote.id) }) { Text("打开 PI") }
                    },
                ) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("总额", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(formatMoney(proforma.total, proforma.currency), style = MaterialTheme.typography.titleMedium)
                        }
                        Text(
                            when (proforma.status) {
                                "paid" -> "已全款"
                                "deposit_paid" -> "定金已收"
                                else -> "待收款"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = when (proforma.status) {
                                "paid", "deposit_paid" -> Color(0xFF1C7A3D)
                                else -> Color(0xFFD97706)
                            },
                        )
                    }
                    Spacer(Modifier.height(8.dp))

                    proforma.milestones.forEach { milestone ->
                        val overdue = milestone.status == "overdue"
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(
                                    when (milestone.label) {
                                        "deposit" -> "定金"
                                        "balance" -> "尾款"
                                        else -> milestone.label
                                    },
                                    style = MaterialTheme.typography.bodyMedium,
                                )
                                Text(
                                    "应付 " + shortDateTime(milestone.dueAt) +
                                        if (overdue) "（已逾期）" else "",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = if (overdue) Color(0xFFD02F2F) else MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Text(
                                formatMoney(milestone.amount, milestone.currency),
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.Medium,
                            )
                            Spacer(Modifier.width(8.dp))
                            if (milestone.status == "paid") {
                                Icon(Icons.Filled.Check, contentDescription = "已收", tint = Color(0xFF1C7A3D))
                            } else {
                                Button(
                                    onClick = { onMarkPaid(milestone.id, milestone.amount) },
                                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                                ) { Text("登记收款", style = MaterialTheme.typography.bodySmall) }
                            }
                        }
                        if (milestone.status != "paid") {
                            OutlinedButton(
                                onClick = { onRemindPayment(milestone.id) },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Icon(Icons.Filled.Notifications, contentDescription = null)
                                Text("  让 AI 起草催款")
                            }
                        }
                    }
                }
            }
        }

        // ---- Why this price -------------------------------------------------
        if (quote.appliedRules.isNotEmpty() || !quote.internalNotes.isNullOrBlank()) {
            item {
                SectionCard(title = "价格审计", subtitle = "这个价格是怎么算出来的") {
                    quote.appliedRules.forEach { rule ->
                        Row(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
                            Text("• ", style = MaterialTheme.typography.bodySmall)
                            Text(rule.name, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                            rule.deltaPct?.let {
                                Text(
                                    formatPercent(it, 1),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = if (it < 0) Color(0xFF1C7A3D) else Color(0xFFD97706),
                                )
                            }
                        }
                    }
                    if (!quote.internalNotes.isNullOrBlank()) {
                        Spacer(Modifier.height(6.dp))
                        Text(quote.internalNotes!!, style = MaterialTheme.typography.bodySmall, color = Color(0xFFD97706))
                    }
                }
            }
        }

        // ---- Actions --------------------------------------------------------
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (quote.status == "pending_approval" || quote.status == "draft") {
                    Button(onClick = onSend, modifier = Modifier.fillMaxWidth(), enabled = !state.loading) {
                        Icon(Icons.AutoMirrored.Filled.Send, contentDescription = null)
                        Text("  批准并发送（自动排跟进）")
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { onOpenDocument(quote.id) }, modifier = Modifier.weight(1f)) {
                        Icon(Icons.Filled.PictureAsPdf, contentDescription = null)
                        Text(" 报价单")
                    }
                    OutlinedButton(onClick = { onOpenDeclaration(quote.id) }, modifier = Modifier.weight(1f)) {
                        Text("报关要素")
                    }
                }
                if (quote.status != "accepted" && quote.status != "rejected") {
                    OutlinedButton(onClick = { outcomeFor = quote }, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Filled.Check, contentDescription = null)
                        Text("  登记成交 / 丢单")
                    }
                }
            }
        }

        item { Spacer(Modifier.height(12.dp)) }
    }

    outcomeFor?.let { target ->
        OutcomeDialog(
            quote = target,
            onDismiss = { outcomeFor = null },
            onSubmit = { result, reason, note ->
                outcomeFor = null
                onRecordOutcome(target.id, result, if (result == "won") null else reason, note)
            },
        )
    }
}

private val LOSS_REASONS = listOf(
    "price" to "价格偏高",
    "lead_time" to "交期太长",
    "quality" to "质量/规格不符",
    "payment_terms" to "付款条件不接受",
    "moq" to "起订量过高",
    "certification" to "认证不满足",
    "shipping" to "运费过高",
    "competitor" to "被竞品拿下",
    "no_budget" to "客户预算取消",
    "no_response" to "客户失联",
)

@Composable
private fun OutcomeDialog(
    quote: Quote,
    onDismiss: () -> Unit,
    onSubmit: (String, String, String?) -> Unit,
) {
    var result by remember { mutableStateOf("won") }
    var reason by remember { mutableStateOf("price") }
    var note by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("登记结果 · ${quote.quoteNo}") },
        text = {
            Column {
                Text(
                    "丢单原因会回流到老板看板的归因分析，用来改话术与定价。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    FilterChip(selected = result == "won", onClick = { result = "won" }, label = { Text("成交") })
                    FilterChip(selected = result == "lost", onClick = { result = "lost" }, label = { Text("丢单") })
                    FilterChip(selected = result == "no_response", onClick = { result = "no_response" }, label = { Text("失联") })
                }
                if (result != "won") {
                    Spacer(Modifier.height(10.dp))
                    Text("主因", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(5.dp))
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        items(LOSS_REASONS) { (value, label) ->
                            FilterChip(selected = reason == value, onClick = { reason = value }, label = { Text(label) })
                        }
                    }
                }
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = note,
                    onValueChange = { note = it },
                    label = { Text("备注（客户原话 / 竞品）") },
                    minLines = 2,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            Button(onClick = { onSubmit(result, reason, note.takeIf { it.isNotBlank() }) }) { Text("提交") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

