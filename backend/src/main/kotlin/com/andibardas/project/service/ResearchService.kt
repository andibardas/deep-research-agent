package com.andibardas.project.service

import com.andibardas.project.agent.knowledge.Fact
import com.andibardas.project.agent.knowledge.KnowledgeStore
import com.andibardas.project.agent.orchestration.ResearchOrchestrator
import com.andibardas.project.controller.dto.EvidenceSupportMatrixDto
import com.andibardas.project.controller.dto.ProgressUpdate
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import org.apache.commons.math3.linear.RealVector
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.web.server.ResponseStatusException
import java.net.URI
import java.util.concurrent.ConcurrentHashMap

@Service
class ResearchService(
    private val orchestrator: ResearchOrchestrator,
    private val knowledgeStore: KnowledgeStore
) {
    private val activeJobs = ConcurrentHashMap<String, MutableStateFlow<ProgressUpdate>>()

    fun startResearchJob(researchId: String, query: String) {
        val progressFlow = MutableStateFlow(ProgressUpdate(researchId, "Job queued..."))
        if (activeJobs.putIfAbsent(researchId, progressFlow) != null) {
            throw ResponseStatusException(HttpStatus.CONFLICT, "Research job with this ID already exists.")
        }

        CoroutineScope(Dispatchers.IO).launch {
            orchestrator.conductResearch(researchId, query, progressFlow)
        }

    }

    fun getProgressFlow(researchId: String): Flow<ProgressUpdate> {
        return activeJobs[researchId] ?: throw ResponseStatusException(HttpStatus.NOT_FOUND, "Research job not found")
    }

    suspend fun computeEvidenceSupportMatrix(): EvidenceSupportMatrixDto {
        val facts: List<Fact> = knowledgeStore.getAllFacts()
        if (facts.isEmpty()) {
            return EvidenceSupportMatrixDto(sources = emptyList(), facts = emptyList(), scores = emptyList())
        }

        val sourcesOrdered = facts.map { it.sourceUrl }.distinct()
        val sourceItems = sourcesOrdered.map { sid ->
            val label = try { (URI(sid).host ?: sid).removePrefix("www.") } catch (_: Exception) { sid }
            EvidenceSupportMatrixDto.Item(id = sid, label = label)
        }

        val factsOrdered = facts.mapIndexed { idx, f -> idx to f }
        val factItems = factsOrdered.map { (idx, f) ->
            EvidenceSupportMatrixDto.FactItem(id = "f-$idx", label = f.content, sourceId = f.sourceUrl)
        }

        val factsBySource: Map<String, List<Fact>> = facts.groupBy { it.sourceUrl }

        fun cos(a: RealVector, b: RealVector): Double {
            val denom = a.norm * b.norm
            if (denom == 0.0) return 0.0
            return (a.dotProduct(b) / denom).coerceIn(-1.0, 1.0)
        }

        val scores: List<List<Double>> = sourceItems.map { src ->
            val sourceFacts = factsBySource[src.id] ?: emptyList()
            val row = factsOrdered.map { (_, f) ->
                if (src.id == f.sourceUrl) 0.0 else if (sourceFacts.isEmpty()) 0.0 else {
                    val sims = sourceFacts.asSequence()
                        .map { other -> cos(f.embedding, other.embedding) }
                        .toList()
                    val maxSim = sims.maxOrNull() ?: 0.0
                    ((maxSim + 1.0) / 2.0).coerceIn(0.0, 1.0)
                }
            }
            row
        }

        return EvidenceSupportMatrixDto(
            sources = sourceItems,
            facts = factItems,
            scores = scores
        )
    }
}