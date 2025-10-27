package com.andibardas.project.agent.tools

import com.andibardas.project.config.ApiProperties
import io.ktor.client.*
import io.ktor.client.call.*
import io.ktor.client.engine.cio.*
import io.ktor.client.plugins.ClientRequestException
import io.ktor.client.plugins.ServerResponseException
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component

@Serializable data class BraveSearchResponse(val web: WebResults? = null)
@Serializable data class WebResults(val results: List<SearchResult>? = null)
@Serializable data class SearchResult(
    val title: String? = null,
    val url: String? = null,
    val description: String? = null
)

@Component
class WebSearchTool(private val props: ApiProperties): Tool {
    override val name: String = "web_search"
    private val logger = LoggerFactory.getLogger(javaClass)
    private val httpClient = HttpClient(CIO) {
        install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true; isLenient = true }) }
        expectSuccess = true
    }

    suspend fun execute(query: String): String {
        logger.info("Searching for: '$query'")
        return try {
            val response: BraveSearchResponse = httpClient.get("https://api.search.brave.com/res/v1/web/search") {
                url {
                    parameters.append("q", query)
                    parameters.append("count", "10")
                }
                header("X-Subscription-Token", props.brave.key)
            }.body()

            val results = response.web?.results.orEmpty()
            logger.info("Brave search returned ${results.size} results for query '$query'")

            val formatted = results.asSequence()
                .filter { !it.url.isNullOrBlank() }
                .take(7)
                .joinToString("\n---\n") {
                    val title = it.title?.ifBlank { "Untitled" } ?: "Untitled"
                    val url = it.url ?: ""
                    val snippet = it.description?.ifBlank { "" } ?: ""
                    "Title: $title\nURL: $url\nSnippet: $snippet".trimEnd()
                }

            formatted.ifBlank { "No results found." }
        } catch (e: ClientRequestException) {
            val status = e.response.status
            val body = safeBody(e.response)
            logger.error("Brave Search API client error: ${status.value} ${status.description}. Body: $body")
            "Error: Web search failed (${status.value}). ${status.description}. ${body.take(200)}"
        } catch (e: ServerResponseException) {
            val status = e.response.status
            val body = safeBody(e.response)
            logger.error("Brave Search API server error: ${status.value} ${status.description}. Body: $body")
            "Error: Web search failed (${status.value}). ${status.description}. ${body.take(200)}"
        } catch (e: Exception) {
            logger.error("Brave Search API call failed", e)
            "Error: Web search failed. ${e.message}"
        }
    }

    private suspend fun safeBody(response: HttpResponse): String = try {
        response.bodyAsText()
    } catch (_: Exception) {
        "<no body>"
    }
}