package com.andibardas.project.config

import org.springframework.boot.context.properties.ConfigurationProperties

@ConfigurationProperties(prefix = "api")
data class ApiProperties(
    val openai: OpenAI,
    val brave: Brave
) {
    data class OpenAI(
        val key: String,
        val model: String = "gpt-4o-mini",
        val embeddingModel: String = "text-embedding-3-small"
    )
    data class Brave(val key: String)
}
