package com.dealtrack.app

import android.app.Application
import com.dealtrack.app.data.AppSettings
import com.dealtrack.app.data.DealTrackApi
import com.dealtrack.app.data.DealTrackRepository

/**
 * Hand-rolled dependency container.
 *
 * Three objects with no configuration needs — a DI framework here would be more
 * code than the thing it wires.
 */
class DealTrackApp : Application() {

    val settings: AppSettings by lazy { AppSettings(this) }
    val api: DealTrackApi by lazy { DealTrackApi(settings) }
    val repository: DealTrackRepository by lazy { DealTrackRepository(api) }

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    companion object {
        lateinit var instance: DealTrackApp
            private set
    }
}
