package com.andibardas.project.controller

import com.andibardas.project.export.PdfExporter
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/api/export")
class ExportController(private val pdfExporter: PdfExporter) {

    data class ExportRequest(
        val markdown: String,
        val filename: String? = null
    )

    @PostMapping("/pdf")
    fun exportPdf(@RequestBody req: ExportRequest): ResponseEntity<ByteArray> {
        val html = pdfExporter.markdownToHtml(req.markdown)
        val pdf = pdfExporter.pdfFromHtml(html)
        val filename = (req.filename ?: "research-report") + ".pdf"

        return ResponseEntity.ok()
            .contentType(MediaType.APPLICATION_PDF)
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"$filename\"")
            .body(pdf)
    }

    @PostMapping("/markdown")
    fun exportMarkdown(@RequestBody req: ExportRequest): ResponseEntity<ByteArray> {
        val filename = (req.filename ?: "research-report") + ".md"

        return ResponseEntity.ok()
            .contentType(MediaType.valueOf("text/markdown"))
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"$filename\"")
            .body(req.markdown.toByteArray(Charsets.UTF_8))
    }
}