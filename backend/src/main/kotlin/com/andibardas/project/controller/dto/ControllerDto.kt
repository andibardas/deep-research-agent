package com.andibardas.project.controller.dto

data class StartResearchRequest(
    val query: String
)

data class StartResearchResponse(
    val researchId: String
)

data class ProgressUpdate(
    val researchId: String,
    val message: String,
    val isComplete: Boolean = false,
    val finalReport: String? = null,
    val knowledgeGraph: KnowledgeGraphDto? = null
)

data class KnowledgeGraphDto(
    val nodes: List<Node>,
    val edges: List<Edge>
) {
    data class Node(
        val id: String,
        val label: String,
        val type: String,
        val iteration: Int? = null
    )

    data class Edge(
        val from: String,
        val to: String
    )
}

data class EvidenceSupportMatrixDto(
    val sources: List<Item>,
    val facts: List<FactItem>,
    val scores: List<List<Double>>
) {
    data class Item(
        val id: String,
        val label: String
    )

    data class FactItem(
        val id: String,
        val label: String,
        val sourceId: String
    )
}
