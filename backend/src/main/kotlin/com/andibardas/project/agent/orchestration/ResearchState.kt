package com.andibardas.project.agent.orchestration

import java.util.concurrent.ConcurrentHashMap

data class ResearchState(
    val researchId: String,
    val initialQuery: String,
    val visitedUrls: MutableSet<String> = ConcurrentHashMap.newKeySet()
)
