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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dealtrack.app.data.model.Inquiry
import com.dealtrack.app.ui.UiState
import com.dealtrack.app.ui.components.EmptyHint
import com.dealtrack.app.ui.components.SectionCard
import com.dealtrack.app.ui.components.StatusChip
import com.dealtrack.app.ui.components.durationText
import com.dealtrack.app.ui.components.inquiryChip
import com.dealtrack.app.ui.components.intentLabel
import com.dealtrack.app.ui.components.languageLabel
import com.dealtrack.app.ui.components.relativeTime

private val FILTERS = listOf(
    "all" to "全部",
    "new" to "新询盘",
    "parsed" to "已解析",
    "quoted" to "已报价",
    "won" to "成交",
    "lost" to "丢单",
)

@Composable
fun InboxScreen(
    state: UiState,
    onFilter: (String) -> Unit,
    onOpen: (String) -> Unit,
) {
    var filter by remember { mutableStateOf("all") }

    Column(Modifier.fillMaxWidth()) {
        LazyRow(
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            items(FILTERS) { (value, label) ->
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
            if (state.inquiries.isEmpty()) {
                item {
                    SectionCard {
                        EmptyHint(
                            "询盘箱是空的",
                            "点右下角 + 把客户原文粘进来，AI 会自动解析、匹配产品库并生成报价",
                        )
                    }
                }
            }

            items(state.inquiries, key = { it.id }) { inquiry ->
                InquiryRow(inquiry) { onOpen(inquiry.id) }
            }
        }
    }

}

/**
 * Exposed so MainActivity can drive it from the Scaffold's FAB — the dialog is
 * an inbox concern, the placement is a shell concern.
 */
@Composable
fun ComposeInquiryDialog(
    onDismiss: () -> Unit,
    onSend: (String, String?, String?, String?) -> Unit,
) = ComposeDialog(onDismiss = onDismiss, onSend = onSend)

@Composable
private fun InquiryRow(inquiry: Inquiry, onClick: () -> Unit) {
    SectionCard(modifier = Modifier.clickable(onClick = onClick)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(inquiry.code, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.weight(1f))
            StatusChip(inquiryChip(inquiry.status))
        }
        Spacer(Modifier.height(4.dp))
        Text(
            inquiry.customer?.company ?: inquiry.fromName ?: "未建档",
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            inquiry.subject ?: "(无主题)",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 2,
        )

        if (!inquiry.summaryZh.isNullOrBlank()) {
            Spacer(Modifier.height(4.dp))
            Text(
                inquiry.summaryZh!!,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary,
                maxLines = 2,
            )
        }

        Spacer(Modifier.height(7.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            val item = inquiry.items?.firstOrNull()
            if (item?.qty != null) {
                Text(
                    "${item.qty.toInt()} ${item.unit ?: "pcs"}" +
                        if ((inquiry.items?.size ?: 0) > 1) " +${(inquiry.items?.size ?: 1) - 1}" else "",
                    style = MaterialTheme.typography.bodySmall,
                )
                Spacer(Modifier.width(8.dp))
            }
            Text(
                languageLabel(inquiry.language) + " · " + intentLabel(inquiry.detectedIntent),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.weight(1f))
            Text(
                if (inquiry.firstResponseSeconds != null) {
                    "首响 " + durationText(inquiry.firstResponseSeconds)
                } else {
                    relativeTime(inquiry.receivedAt)
                },
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun ComposeDialog(
    onDismiss: () -> Unit,
    onSend: (String, String?, String?, String?) -> Unit,
) {
    var body by remember { mutableStateOf("") }
    var subject by remember { mutableStateOf("") }
    var contactName by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("粘贴一封新询盘") },
        text = {
            Column {
                Text(
                    "任意语言都可以。系统会自动识别语言、抽取产品与数量、匹配产品库、计算 FOB/CIF 价格，并按客户语言起草回复。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = body,
                    onValueChange = { body = it },
                    label = { Text("询盘正文 *") },
                    minLines = 5,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = subject,
                    onValueChange = { subject = it },
                    label = { Text("主题") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = contactName,
                        onValueChange = { contactName = it },
                        label = { Text("联系人") },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                    OutlinedTextField(
                        value = email,
                        onValueChange = { email = it },
                        label = { Text("邮箱") },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        },
        confirmButton = {
            Button(
                enabled = body.trim().length > 3,
                onClick = {
                    onSend(
                        body.trim(),
                        subject.trim().takeIf { it.isNotBlank() },
                        contactName.trim().takeIf { it.isNotBlank() },
                        email.trim().takeIf { it.isNotBlank() },
                    )
                },
            ) { Text("交给销售智能体") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}
