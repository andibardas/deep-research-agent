package com.andibardas.project.agent.tools

import io.ktor.client.*
import io.ktor.client.engine.cio.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import org.jsoup.Jsoup
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component

@Component
class WebScraperTool: Tool {
    override val name = "web_scraper"
    private val logger = LoggerFactory.getLogger(javaClass)
    private val httpClient = HttpClient(CIO)

    suspend fun execute(url: String): String {
        logger.info("Scraping: '$url'")
        return try {
            val html = httpClient.get(url).bodyAsText()
            Jsoup.parse(html).text().replace(Regex("\\s{2,}"), " ").take(6000)
        } catch (e: Exception) {
            logger.error("Failed to scrape URL $url", e)
            ""
        }
    }
}