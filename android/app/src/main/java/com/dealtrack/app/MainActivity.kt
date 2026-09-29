package com.dealtrack.app

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.dealtrack.app.ui.AppViewModel
import com.dealtrack.app.ui.screens.ComposeInquiryDialog
import com.dealtrack.app.ui.screens.DashboardScreen
import com.dealtrack.app.ui.screens.FollowupsScreen
import com.dealtrack.app.ui.screens.InboxScreen
import com.dealtrack.app.ui.screens.InquiryDetailScreen
import com.dealtrack.app.ui.screens.QuoteDetailScreen
import com.dealtrack.app.ui.screens.QuotesScreen
import com.dealtrack.app.ui.screens.SettingsScreen
import com.dealtrack.app.ui.theme.DealTrackTheme

/**
 * Single-activity Compose app.
 *
 * Navigation is a hand-rolled sealed class rather than Navigation Compose: there
 * are five destinations and two detail screens, and the back stack rules are
 * trivial. Fewer moving parts means fewer ways for a salesperson to get stuck.
 */
sealed interface Screen {
    data object Dashboard : Screen
    data object Inbox : Screen
    data object Quotes : Screen
    data object Followups : Screen
    data object Settings : Screen
    data class InquiryDetail(val id: String) : Screen
    data class QuoteDetail(val id: String) : Screen
}

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            DealTrackTheme {
                DealTrackRoot()
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DealTrackRoot() {
    val app = DealTrackApp.instance
    val viewModel: AppViewModel = viewModel(
        factory = object : androidx.lifecycle.ViewModelProvider.Factory {
            override fun <T : androidx.lifecycle.ViewModel> create(modelClass: Class<T>): T {
                @Suppress("UNCHECKED_CAST")
                return AppViewModel(app.repository, app.settings) as T
            }
        },
    )
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    val snackbar = remember { SnackbarHostState() }

    var screen by remember {
        mutableStateOf<Screen>(if (app.settings.configured) Screen.Dashboard else Screen.Settings)
    }
    var composing by remember { mutableStateOf(false) }
    // Simple back stack — pushing preserves the previous screen so Back works.
    var stack by remember { mutableStateOf(listOf<Screen>()) }

    fun push(next: Screen) {
        stack = stack + screen
        screen = next
    }

    fun pop() {
        screen = stack.lastOrNull() ?: Screen.Dashboard
        stack = stack.dropLast(1)
    }

    LaunchedEffect(state.toast) {
        state.toast?.let {
            snackbar.showSnackbar(it)
            viewModel.dismissToast()
        }
    }

    val openUrl: (String) -> Unit = { path ->
        // The quote PDF carries the API token, so it is fetched through the same
        // authenticated client and handed to a viewer as a content-less intent.
        // Opening a browser tab would lose the Authorization header entirely.
        val url = "${app.settings.serverUrl}$path"
        try {
            context.startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                    putExtra("com.android.browser.headers", Bundle().apply {
                        // Browsers ignore this; kept for viewers that honour it.
                        putString("Authorization", "Bearer ${app.settings.token}")
                    })
                },
            )
        } catch (error: ActivityNotFoundException) {
            android.widget.Toast.makeText(context, "没有可打开文档的应用", android.widget.Toast.LENGTH_SHORT).show()
        } catch (error: Exception) {
            android.widget.Toast.makeText(context, "打开失败：${error.message}", android.widget.Toast.LENGTH_SHORT).show()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            if (screen !is Screen.InquiryDetail && screen !is Screen.QuoteDetail) {
                TopAppBar(
                    title = {
                        Text(
                            when (screen) {
                                Screen.Dashboard -> "老板看板"
                                Screen.Inbox -> "询盘箱"
                                Screen.Quotes -> "报价单"
                                Screen.Followups -> "跟进看板"
                                else -> "设置"
                            },
                        )
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.colorScheme.primary,
                        titleContentColor = MaterialTheme.colorScheme.onPrimary,
                        actionIconContentColor = MaterialTheme.colorScheme.onPrimary,
                    ),
                    actions = {
                        if (screen !is Screen.Settings) {
                            IconButton(onClick = { viewModel.refreshAll() }) {
                                Icon(Icons.Filled.Schedule, contentDescription = "刷新")
                            }
                        }
                    },
                )
            }
        },
        bottomBar = {
            if (screen !is Screen.InquiryDetail && screen !is Screen.QuoteDetail) {
                NavigationBar {
                    BottomItem("看板", Icons.Filled.Dashboard, screen is Screen.Dashboard) { screen = Screen.Dashboard }
                    BottomItem("询盘", Icons.Filled.Inbox, screen is Screen.Inbox) {
                        screen = Screen.Inbox
                        viewModel.loadInquiries("all")
                    }
                    BottomItem("报价", Icons.Filled.Description, screen is Screen.Quotes) {
                        screen = Screen.Quotes
                        viewModel.loadQuotes("all")
                    }
                    BottomItem("跟进", Icons.Filled.Schedule, screen is Screen.Followups) {
                        screen = Screen.Followups
                        viewModel.loadFollowups("scheduled")
                    }
                    BottomItem("设置", Icons.Filled.Settings, screen is Screen.Settings) { screen = Screen.Settings }
                }
            }
        },
        floatingActionButton = {
            if (screen is Screen.Inbox) {
                FloatingActionButton(onClick = { composing = true }) {
                    Icon(Icons.Filled.Add, contentDescription = "粘贴新询盘")
                }
            }
        },
    ) { padding ->
        Box(
            Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            when (val current = screen) {
                Screen.Dashboard -> DashboardScreen(
                    state = state,
                    onRefresh = { viewModel.refreshAll() },
                    onOpenAgents = { screen = Screen.Settings },
                )

                Screen.Inbox -> InboxScreen(
                    state = state,
                    onFilter = { viewModel.loadInquiries(it) },
                    onOpen = { id ->
                        viewModel.loadInquiry(id)
                        push(Screen.InquiryDetail(id))
                    },
                )

                Screen.Quotes -> QuotesScreen(
                    state = state,
                    onFilter = { viewModel.loadQuotes(it) },
                    onOpen = { quote ->
                        viewModel.loadQuote(quote.id, quote)
                        push(Screen.QuoteDetail(quote.id))
                    },
                )

                Screen.Followups -> FollowupsScreen(
                    state = state,
                    onFilter = { viewModel.loadFollowups(it) },
                    onDraft = { viewModel.draftFollowup(it) },
                    onSend = { viewModel.sendFollowup(it) },
                    onSnooze = { id, days -> viewModel.snoozeFollowup(id, days) },
                )

                Screen.Settings -> SettingsScreen(
                    state = state,
                    onSave = { url, token, actor ->
                        viewModel.saveConnection(url, token, actor)
                        screen = Screen.Dashboard
                    },
                    onTest = { viewModel.testConnection() },
                )

                is Screen.InquiryDetail -> InquiryDetailScreen(
                    state = state,
                    inquiryId = current.id,
                    onBack = { pop() },
                    onGenerateQuote = { viewModel.generateQuote(current.id) },
                    onApprove = { messageId -> viewModel.approveMessage(messageId, current.id) },
                    onOpenQuote = { quoteId ->
                        viewModel.loadQuote(quoteId)
                        push(Screen.QuoteDetail(quoteId))
                    },
                )

                is Screen.QuoteDetail -> QuoteDetailScreen(
                    state = state,
                    onBack = { pop() },
                    onSend = { viewModel.sendQuote(current.id) },
                    onOpenDocument = { openUrl(app.repository.quoteDocumentUrl(it)) },
                    onOpenDeclaration = { openUrl(app.repository.declarationUrl(it)) },
                    onRecordOutcome = { quoteId, result, reason, note ->
                        viewModel.recordOutcome(quoteId, result, reason, note)
                    },
                )
            }

            if (state.loading && state.overview == null) {
                Box(Modifier.fillMaxSize()) {
                    CircularProgressIndicator(Modifier.padding(24.dp))
                }
            }
        }
    }

    if (composing) {
        ComposeInquiryDialog(
            onDismiss = { composing = false },
            onSend = { body, subject, name, email ->
                composing = false
                viewModel.createInquiry(body, subject, name, email) { inquiryId ->
                    screen = Screen.Inbox
                    viewModel.loadInquiry(inquiryId)
                    push(Screen.InquiryDetail(inquiryId))
                }
            },
        )
    }
}

// `NavigationBarItem` is declared as `RowScope.NavigationBarItem` in Material3 —
// it positions itself with the width of the row it sits in. Calling it from a
// plain @Composable wrapper loses that receiver and fails to resolve, so this
// helper carries the RowScope through.
@Composable
private fun RowScope.BottomItem(label: String, icon: ImageVector, selected: Boolean, onClick: () -> Unit) {
    NavigationBarItem(
        selected = selected,
        onClick = onClick,
        icon = { Icon(icon, contentDescription = label) },
        label = { Text(label) },
    )
}

