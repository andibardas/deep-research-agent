package com.andibardas.project.config

import org.springframework.boot.context.properties.ConfigurationProperties

@ConfigurationProperties(prefix = "agent")
data class AgentProperties(
    val maxIterations: Int,
    val scrapeConcurrency: Int,
    val similarityThreshold: Double
)
