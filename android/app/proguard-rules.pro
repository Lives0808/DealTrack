# DealTrack Android — R8 rules

# kotlinx.serialization keeps generated serializers reflectively reachable.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.dealtrack.app.**$$serializer { *; }
-keepclassmembers class com.dealtrack.app.** {
    *** Companion;
}
-keepclasseswithmembers class com.dealtrack.app.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# OkHttp ships optional platform integrations we do not use.
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# Model classes are deserialized by name — never strip their fields.
-keep class com.dealtrack.app.data.model.** { *; }
