package com.andibardas.project.agent.orchestration

import com.andibardas.project.agent.knowledge.KnowledgeStore
import com.andibardas.project.agent.tools.SynthesizerTool
import com.andibardas.project.agent.tools.WebScraperTool
import com.andibardas.project.agent.tools.WebSearchTool
import com.andibardas.project.commons.retry
import com.andibardas.project.config.AgentProperties
import com.andibardas.project.controller.dto.KnowledgeGraphDto
import com.andibardas.project.controller.dto.ProgressUpdate
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.net.URI
import java.util.concurrent.atomic.AtomicInteger

@Component
class ResearchOrchestrator(
    private val webSearchTool: WebSearchTool,
    private val webScraperTool: WebScraperTool,
    private val synthesizerTool: SynthesizerTool,
    private val knowledgeStore: KnowledgeStore,
    private val props: AgentProperties
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    suspend fun conductResearch(researchId: String, query: String, progressFlow: MutableStateFlow<ProgressUpdate>) {
        val state = ResearchState(researchId, query)
        knowledgeStore.clear()

        try {
            var currentQuery = query

            for (iteration in 1..props.maxIterations) {
                update(progressFlow, state, "Iteration $iteration: Searching for '$currentQuery'")
                val searchResults = webSearchTool.execute(currentQuery)

                if (searchResults.startsWith("Error:")) {
                    update(progressFlow, state, searchResults)
                    break
                }

                val urls = extractUrls(searchResults)
                val pending = urls.filterNot { it in state.visitedUrls }
                if (pending.isEmpty()) {
                    update(progressFlow, state, "No new URLs found.")
                    break
                }

                val batchSize = (props.scrapeConcurrency * 2).coerceAtLeast(2)
                val selected = pickDiverse(pending, take = batchSize)
                val newFactsCount = processUrlsConcurrently(selected, state, currentQuery, progressFlow)

                val totalFacts = knowledgeStore.getFactCount()
                val sourcesWithFacts = knowledgeStore.getAllFacts().map { it.sourceUrl }.toSet().size
                update(progressFlow, state, "Found $newFactsCount new facts. Total facts: $totalFacts. Sources with facts: $sourcesWithFacts.")

                if (iteration < props.maxIterations) {
                    update(progressFlow, state, "Reflecting on findings to plan next step...")
                    currentQuery = synthesizerTool.generateNextQuery(query, knowledgeStore.getAllFacts()).trim()
                }
            }

            update(progressFlow, state, "Synthesizing final report...")
            val finalReport = synthesizerTool.generateFinalReport(query, knowledgeStore.getAllFacts())
            update(progressFlow, state, "Research complete.", isComplete = true, finalReport = finalReport)
        } catch (e: Exception) {
            logger.error("Research failed for id=$researchId", e)
            update(progressFlow, state, "Error: ${e.message}", isComplete = true)
        }
    }

    private suspend fun processUrlsConcurrently(
        urls: List<String>,
        state: ResearchState,
        query: String,
        progressFlow: MutableStateFlow<ProgressUpdate>
    ): Int = coroutineScope {
        val newFacts = AtomicInteger(0)
        val limited = urls.take(props.scrapeConcurrency.coerceAtLeast(1))
        limited.map { url ->
            async(Dispatchers.IO) {
                if (state.visitedUrls.add(url)) {
                    update(progressFlow, state, "Scraping $url")
                    val content = retry(times = 2) { webScraperTool.execute(url) }
                    if (content.isNotBlank()) {
                        update(progressFlow, state, "Analyzing content from $url")
                        val facts = synthesizerTool.extractFacts(content, query)
                        facts.forEach { fact ->
                            if (knowledgeStore.addFact(fact, url)) {
                                newFacts.incrementAndGet()
                                update(progressFlow, state, "New fact discovered.")
                            }
                        }
                    }
                }
            }
        }.awaitAll()
        newFacts.get()
    }

    private fun pickDiverse(urls: List<String>, take: Int): List<String> {
        val byHost = urls.groupBy { host(it) ?: it }
        val firstPass = byHost.values.mapNotNull { it.firstOrNull() }
        if (firstPass.size >= take) return firstPass.take(take)
        val remaining = urls.filterNot { it in firstPass }
        return (firstPass + remaining).distinct().take(take)
    }

    private fun host(url: String): String? = try { URI(url).host } catch (_: Exception) { null }

    private fun extractUrls(searchResults: String): List<String> = "URL: (https?://\\S+)".toRegex()
        .findAll(searchResults).map { it.groupValues[1] }.toList()

    private fun update(
        flow: MutableStateFlow<ProgressUpdate>,
        state: ResearchState,
        msg: String,
        isComplete: Boolean = false,
        finalReport: String? = null
    ) {
        logger.info("[${state.researchId}] $msg")
        val graph = buildGraph(state)
        flow.value = ProgressUpdate(state.researchId, msg, isComplete, finalReport, graph)
    }

    private fun buildGraph(state: ResearchState): KnowledgeGraphDto? {
        val facts = knowledgeStore.getAllFacts()
        if (facts.isEmpty()) {
            if (state.visitedUrls.isEmpty()) return null
            val sourceNodes = state.visitedUrls.map { url ->
                val label = try { (URI(url).host ?: url).removePrefix("www.") } catch (_: Exception) { url }
                KnowledgeGraphDto.Node(id = url, label = label, type = "source")
            }
            return KnowledgeGraphDto(nodes = sourceNodes, edges = emptyList())
        }

        val sourceNodes = linkedMapOf<String, KnowledgeGraphDto.Node>()
        val factNodes = mutableListOf<KnowledgeGraphDto.Node>()
        val edges = mutableListOf<KnowledgeGraphDto.Edge>()

        var factIndex = 0
        facts.forEach { fact ->
            val sid = fact.sourceUrl
            val slabel = try { (URI(sid).host ?: sid).removePrefix("www.") } catch (_: Exception) { sid }
            if (!sourceNodes.containsKey(sid)) {
                sourceNodes[sid] = KnowledgeGraphDto.Node(id = sid, label = slabel, type = "source")
            }
            val fid = "f-${factIndex++}"
            factNodes.add(KnowledgeGraphDto.Node(id = fid, label = fact.content, type = "fact"))
            edges.add(KnowledgeGraphDto.Edge(from = sid, to = fid))
        }

        return KnowledgeGraphDto(
            nodes = sourceNodes.values.toList() + factNodes,
            edges = edges
        )
    }
}
