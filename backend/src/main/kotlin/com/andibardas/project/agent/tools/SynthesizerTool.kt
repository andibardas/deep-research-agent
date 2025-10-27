package com.andibardas.project.agent.tools

import com.andibardas.project.agent.knowledge.Fact
import com.andibardas.project.openai.OpenAIHttpService
import com.andibardas.project.openai.dto.ChatCompletionRequest
import com.andibardas.project.openai.dto.ChatMessage
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import com.andibardas.project.config.ApiProperties
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Component
class SynthesizerTool(
    private val openAIHttpService: OpenAIHttpService,
    private val apiProps: ApiProperties
): Tool {
    override val name = "synthesizer"
    private val logger = LoggerFactory.getLogger(javaClass)

    private val model: String get() = apiProps.openai.model
    private val json = Json { ignoreUnknownKeys = true }

    @Serializable
    private data class FactsPayload(val facts: List<String> = emptyList())

    suspend fun extractFacts(content: String, originalQuery: String): List<String> {
        val request = ChatCompletionRequest(
            model = model,
            messages = listOf(
                ChatMessage(role = "system", content = "You are an expert fact extractor. Return ONLY valid JSON with this exact shape and nothing else: {\"facts\": [\"...\", \"...\"]}. Each fact must be a distinct, atomic, concise sentence relevant to the user's original query."),
                ChatMessage(role = "user", content = "Original Query: $originalQuery\n\nText to analyze (may be truncated):\n$content")
            )
        )

        val response = openAIHttpService.createChatCompletion(request)
        val raw = response?.choices?.firstOrNull()?.message?.content?.trim().orEmpty()
        val responseContent = stripCodeFences(raw)

        val jsonFacts = runCatching { json.decodeFromString(FactsPayload.serializer(), responseContent).facts }
            .getOrElse { emptyList() }
            .map { it.trim() }
            .filter { it.isNotBlank() }

        if (jsonFacts.isNotEmpty()) return jsonFacts

        val legacyFacts = responseContent.lines()
            .map { it.trim() }
            .filter { it.startsWith("FACT:") || it.startsWith("- ") || it.startsWith("*") }
            .map { it.removePrefix("FACT:").removePrefix("- ").removePrefix("*").trim() }
            .filter { it.isNotBlank() }

        if (legacyFacts.isNotEmpty()) return legacyFacts

        return heuristicFacts(content, originalQuery)
    }

    private fun stripCodeFences(s: String): String {
        val trimmed = s.trim()
        if (trimmed.startsWith("```")) {
            val lines = trimmed.lines()
            return lines.drop(1).dropLastWhile { it.trim().isEmpty() || it.trim().startsWith("```") }.joinToString("\n")
        }
        return trimmed
    }

    private fun heuristicFacts(content: String, originalQuery: String): List<String> {
        val text = content.replace("\n", " ").replace(Regex("\\s{2,}"), " ").trim()
        if (text.isBlank()) return emptyList()
        val sentences = text.split(Regex("(?<=[.!?])\\s+"))
        if (sentences.isEmpty()) return emptyList()

        val keywords = originalQuery.lowercase().split(Regex("[^a-z0-9]+"))
            .filter { it.length >= 4 }
            .distinct()
            .toSet()
        val scored = sentences.map { s ->
            val ls = s.lowercase()
            val score = keywords.count { kw -> ls.contains(kw) }
            val lengthOk = s.length in 50..280
            Triple(s.trim(), score, lengthOk)
        }
        val picked = scored
            .filter { it.second > 0 || it.third }
            .sortedWith(compareByDescending<Triple<String, Int, Boolean>> { it.second }.thenBy { kotlin.math.abs((it.first.length) - 140) })
            .map { it.first }
            .distinct()
            .take(5)

        return if (picked.isNotEmpty()) picked else sentences.take(3).map { it.trim() }
    }

    suspend fun generateNextQuery(originalQuery: String, knownFacts: List<Fact>): String {
        val factSummary = knownFacts.takeLast(15).joinToString("\n") { "- ${it.content}" }
        val request = ChatCompletionRequest(
            model = model,
            messages = listOf(
                ChatMessage(role = "system", content = "You are a strategic research planner. Return ONLY the single best search query text, without quotes, for the next step."),
                ChatMessage(role = "user", content = "Original Query: $originalQuery\n\nRecent Facts:\n$factSummary")
            )
        )

        val out = openAIHttpService.createChatCompletion(request)?.choices?.firstOrNull()?.message?.content ?: originalQuery
        return out.trim().removeSurrounding("\"").removeSurrounding("'")
    }

    suspend fun generateFinalReport(originalQuery: String, allFacts: List<Fact>): String {
        val allContent = allFacts.groupBy { it.sourceUrl }
            .map { (url, facts) -> "Source: $url\nFacts:\n${facts.joinToString("\n") { "- ${it.content}" }}" }
            .joinToString("\n\n")

        val request = ChatCompletionRequest(
            model = model,
            messages = listOf(
                ChatMessage(role = "system", content = "You are an expert report writer. Synthesize the provided facts into a comprehensive, well-structured report that answers the user's original query. Use Markdown for formatting. Cite sources inline like this [Source: URL]."),
                ChatMessage(role = "user", content = "Original Query: $originalQuery\n\nKnowledge Base:\n$allContent")
            )
        )

        return openAIHttpService.createChatCompletion(request)?.choices?.firstOrNull()?.message?.content ?: "Error: Could not generate the final report."
    }
}