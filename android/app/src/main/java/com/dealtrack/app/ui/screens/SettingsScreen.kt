package com.dealtrack.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.dealtrack.app.ui.UiState
import com.dealtrack.app.ui.components.KeyValueRow
import com.dealtrack.app.ui.components.SectionCard

/**
 * 设置 — the first screen a new install actually needs, so it is deliberately
 * plain: where is the server, what is the token, and is it reachable.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    state: UiState,
    onSave: (String, String, String) -> Unit,
    onTest: () -> Unit,
) {
    var url by remember(state.serverUrl) { mutableStateOf(state.serverUrl) }
    var token by remember(state.token) { mutableStateOf(state.token) }
    var actor by remember { mutableStateOf("user:ops") }

    LazyColumn(
        contentPadding = PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(11.dp),
    ) {
        item {
            SectionCard(
                title = "连接 DealTrack 服务",
                subtitle = "服务跑在你的电脑或公司服务器上，数据不经过第三方",
            ) {
                OutlinedTextField(
                    value = url,
                    onValueChange = { url = it },
                    label = { Text("服务器地址") },
                    singleLine = true,
                    supportingText = {
                        Text("模拟器用 http://10.0.2.2:8787；真机填电脑局域网 IP，如 http://192.168.1.20:8787")
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = token,
                    onValueChange = { token = it },
                    label = { Text("API Token") },
                    singleLine = true,
                    supportingText = { Text("在服务端 Settings → 系统与安全 中查看或轮换") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = actor,
                    onValueChange = { actor = it },
                    label = { Text("操作身份") },
                    singleLine = true,
                    supportingText = { Text("user:boss / user:ops / user:sales —— 用于审计谁批的") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { onSave(url, token, actor) }, modifier = Modifier.weight(1f)) {
                        Text("保存并连接")
                    }
                    Button(onClick = onTest, modifier = Modifier.weight(1f)) { Text("测试连接") }
                }
            }
        }

        item {
            SectionCard(title = "连接状态") {
                val connected = state.connected
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        if (connected) Icons.Filled.CheckCircle else Icons.Filled.ErrorOutline,
                        contentDescription = null,
                        tint = if (connected) Color(0xFF1C7A3D) else Color(0xFFD02F2F),
                    )
                    Spacer(Modifier.height(0.dp))
                    Text(
                        if (state.checking) "  正在检测…" else if (connected) "  已连接" else "  未连接",
                        style = MaterialTheme.typography.titleSmall,
                    )
                }
                state.error?.let { error ->
                    Spacer(Modifier.height(6.dp))
                    Text(error, style = MaterialTheme.typography.bodySmall, color = Color(0xFFD02F2F))
                }
                state.health?.let { health ->
                    Spacer(Modifier.height(8.dp))
                    KeyValueRow("服务", health.status)
                    health.llm?.let { llm ->
                        KeyValueRow(
                            "AI 模型",
                            "${llm.provider} · " + if (llm.ready) "就绪" else "未就绪（用离线引擎）",
                            if (llm.ready) Color(0xFF1C7A3D) else Color(0xFFD97706),
                        )
                        if (!llm.ready) {
                            Text(
                                llm.reason,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }

        item {
            SectionCard(title = "这个 App 能做什么") {
                Text(
                    "• 询盘箱：查看所有渠道的询盘，粘贴新询盘让 AI 自动解析与报价\n" +
                        "• 报价单：查看毛利与成本构成，一键批准发送，查看多语言 PDF 与报关要素\n" +
                        "• 跟进看板：逾期高亮，一键起草/发送/延后，客户回复会自动停止催问\n" +
                        "• 老板看板：首响时长、节省工时、漏斗与丢单归因\n\n" +
                        "Android 端定位是「口袋里的确认按钮」——AI 把 27 分钟的准备做完，" +
                        "你在手机上用 3 分钟审完发出去。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        item {
            SectionCard(title = "安全") {
                Text(
                    "服务器地址与 Token 只保存在本机，已排除云备份与换机同步。" +
                        "报文仅在你的设备与你的服务器之间传输；除你自行配置的 LLM 供应商外，" +
                        "不经过任何第三方服务。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        item {
            SectionCard(title = "关于") {
                KeyValueRow("应用版本", "0.2.1")
                KeyValueRow("协议", "MIT")
                KeyValueRow("定位", "跨境小卖家的数字外贸团队")
                Spacer(Modifier.height(4.dp))
                Text(
                    "目标：把「30 分钟/封」变成「3 分钟/封」，并且不漏跟。",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        }

        item { Spacer(Modifier.height(12.dp)) }
    }
}

