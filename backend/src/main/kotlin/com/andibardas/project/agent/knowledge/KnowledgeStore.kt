package com.andibardas.project.agent.knowledge

import com.andibardas.project.config.AgentProperties
import com.andibardas.project.config.ApiProperties
import com.andibardas.project.openai.OpenAIHttpService
import com.andibardas.project.openai.dto.EmbeddingRequest
import org.apache.commons.math3.linear.ArrayRealVector
import org.apache.commons.math3.linear.RealVector
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.util.concurrent.ConcurrentHashMap

@Component
class KnowledgeStore(
    private val openAIHttpService: OpenAIHttpService,
    private val props: AgentProperties,
    private val apiProps: ApiProperties
) {
    private val logger = LoggerFactory.getLogger(javaClass)
    private val store = ConcurrentHashMap<String, Fact>()

    suspend fun addFact(content: String, sourceUrl: String): Boolean {
        if (store.containsKey(content)) return false

        val embedding = createEmbedding(content)
        if (embedding == null) {
            logger.warn("Embedding unavailable (model='${apiProps.openai.embeddingModel}'); skipping fact to preserve similarity dedup: '${content.take(120)}'")
            return false
        }

        val mostSimilar = findMostSimilarFact(embedding)

        if (mostSimilar != null && mostSimilar.first > props.similarityThreshold) {
            logger.info("Skipping redundant fact (similarity: %.2f%%): '%s'".format(mostSimilar.first * 100, content))
            return false
        }

        logger.info("New fact added: '$content' from $sourceUrl")
        store[content] = Fact(content, sourceUrl, embedding)
        return true
    }

    private suspend fun createEmbedding(text: String): RealVector? {
        val request = EmbeddingRequest(
            model = apiProps.openai.embeddingModel,
            input = listOf(text)
        )

        val embeddingList = openAIHttpService.createEmbeddings(request)?.data?.firstOrNull()?.embedding
        return embeddingList?.let { ArrayRealVector(it.toDoubleArray()) }
    }

    private fun findMostSimilarFact(vector: RealVector): Pair<Double, Fact>? {
        if(store.isEmpty()) return null

        return store.values
            .map { fact -> cosineSimilarity(vector, fact.embedding) to fact }
            .maxByOrNull { it.first }
    }

    private fun cosineSimilarity(vecA: RealVector, vecB: RealVector): Double {
        if(vecA.dimension != vecB.dimension) return 0.0
        val denom = vecA.norm * vecB.norm
        if (denom == 0.0) return 0.0
        return vecA.dotProduct(vecB) / denom
    }

    fun getAllFacts(): List<Fact> = store.values.toList()
    fun getFactCount(): Int = store.size
    fun clear() = store.clear()
}