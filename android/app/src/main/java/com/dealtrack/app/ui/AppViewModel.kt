package com.dealtrack.app.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.dealtrack.app.DealTrackApp
import com.dealtrack.app.data.ApiException
import com.dealtrack.app.data.DealTrackRepository
import com.dealtrack.app.data.model.AgentBoardEntry
import com.dealtrack.app.data.model.Followup
import com.dealtrack.app.data.model.Health
import com.dealtrack.app.data.model.Inquiry
import com.dealtrack.app.data.model.Overview
import com.dealtrack.app.data.model.Quote
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Everything a screen can be doing, in one place. */
data class UiState(
    val connected: Boolean = false,
    val checking: Boolean = false,
    val loading: Boolean = false,
    val error: String? = null,
    val toast: String? = null,
    val overview: Overview? = null,
    val health: Health? = null,
    val agents: List<AgentBoardEntry> = emptyList(),
    val inquiries: List<Inquiry> = emptyList(),
    val inquiry: Inquiry? = null,
    val quotes: List<Quote> = emptyList(),
    val quote: Quote? = null,
    val followups: List<Followup> = emptyList(),
    val serverUrl: String = "",
    val token: String = "",
)

/**
 * One ViewModel for the whole app.
 *
 * The app is a focused operational tool — dashboard, inbox, quotes, follow-ups —
 * not a sprawling product, so a single state holder keeps every screen honest
 * about what is loading and what failed. If it ever grows past this, the state
 * splits the same way the screens do.
 */
class AppViewModel(
    private val repository: DealTrackRepository,
    private val settings: com.dealtrack.app.data.AppSettings,
) : ViewModel() {

    private val _state = MutableStateFlow(
        UiState(serverUrl = settings.serverUrl, token = settings.token),
    )
    val state: StateFlow<UiState> = _state.asStateFlow()

    init {
        if (settings.configured) {
            refreshAll()
        }
    }

    private fun update(block: (UiState) -> UiState) {
        _state.value = block(_state.value)
    }

    fun dismissToast() = update { it.copy(toast = null) }

    fun saveConnection(url: String, token: String, actor: String) {
        settings.serverUrl = url
        settings.token = token
        settings.actor = actor
        settings.configured = true
        update { it.copy(serverUrl = settings.serverUrl, token = settings.token, error = null) }
        testConnection()
    }

    fun testConnection() {
        viewModelScope.launch {
            update { it.copy(checking = true, error = null) }
            try {
                val health = repository.health()
                update { it.copy(checking = false, connected = true, health = health) }
                refreshAll()
            } catch (error: Exception) {
                update {
                    it.copy(
                        checking = false,
                        connected = false,
                        error = error.message ?: "连接失败",
                    )
                }
            }
        }
    }

    fun refreshAll() {
        viewModelScope.launch {
            update { it.copy(loading = true, error = null) }
            try {
                val overview = repository.overview()
                update {
                    it.copy(
                        loading = false,
                        connected = true,
                        overview = overview,
                        agents = overview.agents,
                    )
                }
            } catch (error: Exception) {
                update { it.copy(loading = false, connected = false, error = error.message) }
                return@launch
            }
            // Secondary feeds are allowed to fail without blanking the dashboard.
            runCatching { repository.inquiries() }.onSuccess { list -> update { it.copy(inquiries = list) } }
            runCatching { repository.quotes() }.onSuccess { list -> update { it.copy(quotes = list) } }
            runCatching { repository.followups() }.onSuccess { list -> update { it.copy(followups = list) } }
        }
    }

    fun loadInquiries(status: String) {
        viewModelScope.launch {
            update { it.copy(loading = true) }
            runCatching { repository.inquiries(status) }
                .onSuccess { list -> update { it.copy(loading = false, inquiries = list) } }
                .onFailure { error -> update { it.copy(loading = false, error = error.message) } }
        }
    }

    fun loadInquiry(id: String) {
        update { it.copy(inquiry = null, loading = true) }
        viewModelScope.launch {
            runCatching { repository.inquiry(id) }
                .onSuccess { inquiry -> update { it.copy(loading = false, inquiry = inquiry) } }
                .onFailure { error -> update { it.copy(loading = false, error = error.message) } }
        }
    }

    fun loadQuote(id: String, listItem: Quote? = null) {
        update { it.copy(quote = listItem, loading = true) }
        viewModelScope.launch {
            runCatching { repository.quote(id) }
                .onSuccess { quote -> update { it.copy(loading = false, quote = quote) } }
                .onFailure { error -> update { it.copy(loading = false, error = error.message) } }
        }
    }

    fun loadQuotes(status: String) {
        viewModelScope.launch {
            update { it.copy(loading = true) }
            runCatching { repository.quotes(status) }
                .onSuccess { list -> update { it.copy(loading = false, quotes = list) } }
                .onFailure { error -> update { it.copy(loading = false, error = error.message) } }
        }
    }

    fun loadFollowups(status: String) {
        viewModelScope.launch {
            update { it.copy(loading = true) }
            runCatching { repository.followups(status) }
                .onSuccess { list -> update { it.copy(loading = false, followups = list) } }
                .onFailure { error -> update { it.copy(loading = false, error = error.message) } }
        }
    }

    // ---- Actions -----------------------------------------------------------

    private fun action(success: String, block: suspend () -> Unit) {
        viewModelScope.launch {
            update { it.copy(loading = true) }
            try {
                block()
                update { it.copy(loading = false, toast = success) }
            } catch (error: Exception) {
                update { it.copy(loading = false, toast = error.message ?: "操作失败") }
            }
        }
    }

    fun createInquiry(body: String, subject: String?, contactName: String?, email: String?, onDone: (String) -> Unit) {
        viewModelScope.launch {
            update { it.copy(loading = true) }
            try {
                val result = repository.createInquiry(body, subject, contactName, email)
                update {
                    it.copy(
                        loading = false,
                        toast = "已建档 ${result.inquiry.code}，AI 正在解析并报价",
                    )
                }
                onDone(result.inquiry.id)
                refreshAll()
            } catch (error: Exception) {
                update { it.copy(loading = false, toast = error.message ?: "创建失败") }
            }
        }
    }

    fun generateQuote(inquiryId: String) = action("已交给销售智能体，稍后刷新查看报价") {
        repository.generateQuote(inquiryId)
        refreshAll()
    }

    fun reparse(inquiryId: String) = action("已重新解析") {
        repository.reparse(inquiryId)
    }

    fun approveMessage(messageId: String, inquiryId: String?) = action("已发送") {
        repository.approveMessage(messageId)
        inquiryId?.let { repository.inquiry(it) }?.let { fresh -> update { it.copy(inquiry = fresh) } }
        refreshAll()
    }

    fun sendQuote(quoteId: String) = action("报价已发出，跟进节奏已自动排定") {
        repository.approveAndSendQuote(quoteId)
        runCatching { repository.quote(quoteId) }.onSuccess { fresh -> update { it.copy(quote = fresh) } }
        refreshAll()
    }

    fun sendFollowup(id: String) = action("已排入发送队列") {
        repository.sendFollowup(id)
        loadFollowups("scheduled")
    }

    fun draftFollowup(id: String) = action("跟单智能体正在起草") {
        repository.draftFollowup(id)
    }

    fun snoozeFollowup(id: String, days: Int) = action("已延后 $days 天") {
        repository.snoozeFollowup(id, days)
        loadFollowups("scheduled")
    }

    fun recordOutcome(quoteId: String, result: String, reasonCode: String?, note: String?) =
        action(if (result == "won") "已登记成交，报关智能体开始生成报关要素" else "已登记，数据进入丢单分析") {
            repository.recordOutcome(quoteId, result, reasonCode, note)
            runCatching { repository.quote(quoteId) }.onSuccess { fresh -> update { it.copy(quote = fresh) } }
            refreshAll()
        }
}
