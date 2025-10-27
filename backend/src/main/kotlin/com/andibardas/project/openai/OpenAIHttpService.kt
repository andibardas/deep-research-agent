package com.andibardas.project.openai

import com.andibardas.project.config.ApiProperties
import com.andibardas.project.openai.dto.ChatCompletionRequest
import com.andibardas.project.openai.dto.ChatCompletionResponse
import com.andibardas.project.openai.dto.EmbeddingRequest
import com.andibardas.project.openai.dto.EmbeddingResponse
import io.ktor.client.*
import io.ktor.client.engine.cio.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType.Application
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.*
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service

@Service
class OpenAIHttpService(private val props: ApiProperties) {
    private val logger = LoggerFactory.getLogger(javaClass)
    private val json = Json { ignoreUnknownKeys = true }

    private val httpClient = HttpClient(CIO) {
        install(ContentNegotiation) { json(this@OpenAIHttpService.json) }
        engine { requestTimeout = 60_000 }
        expectSuccess = false
    }

    private val chatCompletionUrl = "https://api.openai.com/v1/chat/completions"
    private val embeddingsUrl = "https://api.openai.com/v1/embeddings"

    suspend fun createChatCompletion(request: ChatCompletionRequest): ChatCompletionResponse? {
        return try {
            val resp: HttpResponse = httpClient.post(chatCompletionUrl) {
                bearerAuth(props.openai.key)
                contentType(Application.Json)
                setBody(request)
            }
            val status = resp.status
            val body = resp.bodyAsText()
            if (status.value !in 200..299) {
                logger.error("OpenAI Chat Completion API error: ${status.value} ${status.description}. Body: ${body.take(500)}")
                return null
            }

            try {
                json.decodeFromString(ChatCompletionResponse.serializer(), body)
            } catch (e: Exception) {
                val msg = runCatching {
                    val root = json.parseToJsonElement(body).jsonObject
                    root["error"]?.jsonObject?.get("message")?.jsonPrimitive?.content
                }.getOrNull()
                if (msg != null) logger.error("OpenAI Chat Completion unexpected payload: $msg", e)
                else logger.error("OpenAI Chat Completion unexpected payload: ${body.take(500)}", e)
                null
            }
        } catch (e: Exception) {
            logger.error("OpenAI Chat Completion API call failed", e)
            null
        }
    }

    suspend fun createEmbeddings(request: EmbeddingRequest): EmbeddingResponse? {
        return try {
            val resp: HttpResponse = httpClient.post(embeddingsUrl) {
                bearerAuth(props.openai.key)
                contentType(Application.Json)
                setBody(request)
            }
            val status = resp.status
            val body = resp.bodyAsText()
            if (status.value !in 200..299) {
                logger.error("OpenAI Embeddings API error: ${status.value} ${status.description}. Body: ${body.take(500)}")
                return null
            }
            try {
                json.decodeFromString(EmbeddingResponse.serializer(), body)
            } catch (e: Exception) {
                val msg = runCatching {
                    val root = json.parseToJsonElement(body).jsonObject
                    root["error"]?.jsonObject?.get("message")?.jsonPrimitive?.content
                }.getOrNull()
                if (msg != null) logger.error("OpenAI Embeddings unexpected payload: $msg", e)
                else logger.error("OpenAI Embeddings unexpected payload: ${body.take(500)}", e)
                null
            }
        } catch (e: Exception) {
            logger.error("OpenAI Embeddings API call failed", e)
            null
        }
    }
}