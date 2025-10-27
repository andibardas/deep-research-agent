package com.andibardas.project.controller

import com.andibardas.project.controller.dto.ProgressUpdate
import com.andibardas.project.controller.dto.StartResearchRequest
import com.andibardas.project.controller.dto.StartResearchResponse
import com.andibardas.project.controller.dto.EvidenceSupportMatrixDto
import com.andibardas.project.service.ResearchService
import kotlinx.coroutines.flow.Flow
import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.*
import java.util.*

@RestController
@RequestMapping("/api/research")
class ResearchController(private val researchService: ResearchService) {

    @PostMapping("/start")
    suspend fun startResearch(@RequestBody request: StartResearchRequest): StartResearchResponse {
        val researchId = UUID.randomUUID().toString()
        researchService.startResearchJob(researchId, request.query)
        return StartResearchResponse(researchId)
    }

    @GetMapping("/{researchId}/progress", produces = [MediaType.TEXT_EVENT_STREAM_VALUE])
    fun getProgress(@PathVariable researchId: String): Flow<ProgressUpdate> {
        return researchService.getProgressFlow(researchId)
    }

    @GetMapping("/{researchId}/evidence-matrix")
    suspend fun getEvidenceMatrix(@PathVariable researchId: String): EvidenceSupportMatrixDto {
        return researchService.computeEvidenceSupportMatrix()
    }
}