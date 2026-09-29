package com.dealtrack.app.ui.screens

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.automirrored.filled.TrendingUp
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.dealtrack.app.data.model.AgentBoardEntry
import com.dealtrack.app.ui.UiState
import com.dealtrack.app.ui.components.EmptyHint
import com.dealtrack.app.ui.components.KpiCard
import com.dealtrack.app.ui.components.KeyValueRow
import com.dealtrack.app.ui.components.SectionCard
import com.dealtrack.app.ui.components.StatusChip
import com.dealtrack.app.ui.components.ThinBar
import com.dealtrack.app.ui.components.agentChip
import com.dealtrack.app.ui.components.formatCompact
import com.dealtrack.app.ui.components.formatLatency
import com.dealtrack.app.ui.components.formatPercent
import com.dealtrack.app.ui.components.lossReasonLabel
import com.dealtrack.app.ui.components.relativeTime

/**
 * 老板看板 — the same question the web console answers, sized for a phone:
 * how fast are we replying, how much has that saved, and what is stuck.
 */
@Composable
fun DashboardScreen(
    state: UiState,
    onRefresh: () -> Unit,
    onOpenAgents: () -> Unit,
) {
    val overview = state.overview

    LazyColumn(
        contentPadding = PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.weight(1f)) {
                    Text("老板看板", style = MaterialTheme.typography.titleLarge)
                    Text(
                        if (overview != null) "近 30 天 · 目标是 ${overview.kpi.targetMinutes.toInt()} 分钟/封" else "加载中…",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                IconButton(onClick = onRefresh) {
                    Icon(Icons.Filled.Refresh, contentDescription = "刷新")
                }
            }
        }

        if (overview == null) {
            item {
                SectionCard {
                    EmptyHint(
                        "还没有数据",
                        if (state.connected) "在询盘箱里粘贴一封询盘试试" else "请先在设置里填服务器地址与 Token",
                    )
                }
            }
            return@LazyColumn
        }

        // ---- The headline metric: 30 分钟 → 3 分钟 -------------------------
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                KpiCard(
                    label = "平均首次响应",
                    value = "${overview.kpi.avgFirstResponseMinutes} 分",
                    hint = "基线 ${overview.kpi.baselineMinutes.toInt()} 分 · 目标 ${overview.kpi.targetMinutes.toInt()} 分",
                    valueColor = if (overview.kpi.avgFirstResponseMinutes <= overview.kpi.targetMinutes) {
                        Color(0xFF1C7A3D)
                    } else {
                        Color(0xFFD97706)
                    },
                    modifier = Modifier.weight(1f),
                )
                KpiCard(
                    label = "累计节省",
                    value = "${overview.kpi.hoursSaved} h",
                    hint = "${overview.kpi.responded} 封已回复",
                    valueColor = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.weight(1f),
                )
            }
        }

        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                KpiCard(
                    label = "提速倍数",
                    // With zero replies there is nothing to compare yet — showing the
                    // fallback ratio here would read as a measured result.
                    value = if (overview.kpi.responded > 0) "${overview.kpi.speedupFactor}×" else "待测量",
                    hint = if (overview.kpi.responded > 0) {
                        "最快 ${overview.kpi.bestFirstResponseMinutes} 分钟"
                    } else {
                        "目标 ${overview.kpi.baselineMinutes.toInt()}→${overview.kpi.targetMinutes.toInt()} 分钟"
                    },
                    valueColor = if (overview.kpi.responded > 0) Color(0xFF1C7A3D) else Color(0xFF8B949F),
                    modifier = Modifier.weight(1f),
                )
                KpiCard(
                    label = "在途报价",
                    value = formatCompact(overview.pipeline.openValue),
                    hint = "${overview.pipeline.totalQuotes} 张 · 毛利 ${formatCompact(overview.pipeline.openMargin)}",
                    modifier = Modifier.weight(1f),
                )
            }
        }

        // ---- Funnel --------------------------------------------------------
        item {
            SectionCard(title = "销售漏斗", subtitle = "从询盘到成交，每一步的流失都看得见") {
                val steps = listOf(
                    Triple("收到询盘", overview.funnel.received, MaterialTheme.colorScheme.secondary),
                    Triple("AI 已解析", overview.funnel.parsed, MaterialTheme.colorScheme.secondary),
                    Triple("已生成报价", overview.funnel.quoted, MaterialTheme.colorScheme.primary),
                    Triple("报价已发出", overview.funnel.sent, MaterialTheme.colorScheme.primary),
                    Triple("成交", overview.funnel.won, Color(0xFF1C7A3D)),
                )
                val max = steps.maxOfOrNull { it.second }?.coerceAtLeast(1) ?: 1
                steps.forEach { (label, value, color) ->
                    Column(Modifier.padding(vertical = 3.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(label, style = MaterialTheme.typography.bodySmall)
                            Text("$value", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                        }
                        Spacer(Modifier.height(3.dp))
                        ThinBar(value.toFloat() / max, color)
                    }
                }
                Spacer(Modifier.height(10.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(
                        "报价转化 ${formatPercent(overview.funnel.quoteRate, 0)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "成交率 ${formatPercent(overview.funnel.winRate, 0)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = Color(0xFF1C7A3D),
                    )
                }
            }
        }

        // ---- Agents --------------------------------------------------------
        item {
            SectionCard(
                title = "AI 数字外贸团队",
                trailing = {
                    IconButton(onClick = onOpenAgents) {
                        Icon(Icons.Filled.AutoAwesome, contentDescription = "智能体详情", tint = MaterialTheme.colorScheme.primary)
                    }
                },
            ) {
                overview.agents.forEach { agent -> AgentRow(agent) }
            }
        }

        // ---- Risks ---------------------------------------------------------
        item {
            SectionCard(title = "风险与待办", subtitle = "这些是「不漏跟」在替你盯的事") {
                KeyValueRow("SLA 超时未响", "${overview.risks.slaAtRisk}", if (overview.risks.slaAtRisk > 0) Color(0xFFD02F2F) else MaterialTheme.colorScheme.onSurface)
                KeyValueRow("待审批草稿", "${overview.risks.pendingApprovals}", if (overview.risks.pendingApprovals > 0) Color(0xFFD97706) else MaterialTheme.colorScheme.onSurface)
                KeyValueRow("报价即将过期", "${overview.risks.expiringQuotes}")
                KeyValueRow("未解决对齐群", "${overview.risks.openThreads}")
                KeyValueRow("已逾期跟进", "${overview.followups["overdue"] ?: 0}")
                KeyValueRow("死信任务", "${overview.risks.deadTasks}", if (overview.risks.deadTasks > 0) Color(0xFFD02F2F) else MaterialTheme.colorScheme.onSurface)
            }
        }

        // ---- Loss analysis -------------------------------------------------
        if (overview.loss.reasons.isNotEmpty()) {
            item {
                SectionCard(title = "丢单归因", subtitle = "用来改话术与定价，而不是用来复盘谁的责任") {
                    val max = overview.loss.reasons.maxOf { it.count }.coerceAtLeast(1)
                    overview.loss.reasons.take(6).forEach { reason ->
                        Column(Modifier.padding(vertical = 3.dp)) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text(reason.label.ifBlank { lossReasonLabel(reason.code) }, style = MaterialTheme.typography.bodySmall)
                                Text(
                                    "${reason.count} 单 · ${formatCompact(reason.lostValue)}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Spacer(Modifier.height(3.dp))
                            ThinBar(reason.count.toFloat() / max, Color(0xFFD02F2F))
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("丢单金额 ${formatCompact(overview.loss.lostValue)}", style = MaterialTheme.typography.bodySmall, color = Color(0xFFD02F2F))
                        Text("成交金额 ${formatCompact(overview.loss.wonValue)}", style = MaterialTheme.typography.bodySmall, color = Color(0xFF1C7A3D))
                    }
                }
            }
        }

        item { Spacer(Modifier.height(8.dp)) }
    }
}

@Composable
private fun AgentRow(agent: AgentBoardEntry) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(36.dp)
                .clip(RoundedCornerShape(11.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                when (agent.agent) {
                    "sales" -> Icons.Filled.Bolt
                    "followup" -> Icons.Filled.Schedule
                    else -> Icons.AutoMirrored.Filled.TrendingUp
                },
                contentDescription = null,
                tint = when (agent.agent) {
                    "sales" -> MaterialTheme.colorScheme.primary
                    "followup" -> Color(0xFF1C7A3D)
                    else -> Color(0xFFA75B00)
                },
            )
        }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(agent.label, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                StatusChip(agentChip(agent.status))
            }
            Text(
                "已处理 ${agent.processed} · 队列 ${agent.queueDepth} · 均耗时 ${formatLatency(agent.averageLatencyMs)}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                "成功率 ${formatPercent(agent.successRate, 0)} · ${relativeTime(agent.lastRunAt)}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

