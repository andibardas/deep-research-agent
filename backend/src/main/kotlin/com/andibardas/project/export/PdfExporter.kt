package com.andibardas.project.export

import com.vladsch.flexmark.ext.autolink.AutolinkExtension
import com.vladsch.flexmark.ext.emoji.EmojiExtension
import com.vladsch.flexmark.ext.gfm.strikethrough.StrikethroughExtension
import com.vladsch.flexmark.ext.gfm.tasklist.TaskListExtension
import com.vladsch.flexmark.ext.tables.TablesExtension
import com.vladsch.flexmark.html.HtmlRenderer
import com.vladsch.flexmark.parser.Parser
import com.vladsch.flexmark.util.ast.Node
import com.vladsch.flexmark.util.data.MutableDataSet
import org.springframework.stereotype.Component
import java.io.ByteArrayOutputStream
import java.util.logging.Level
import java.util.logging.Logger
import com.openhtmltopdf.pdfboxout.PdfRendererBuilder

@Component
class PdfExporter {
    init {
        System.setProperty("xr.util-logging.loggingEnabled", "false")
        try {
            Logger.getLogger("com.openhtmltopdf").level = Level.WARNING
            Logger.getLogger("com.openhtmltopdf.load").level = Level.WARNING
            Logger.getLogger("com.openhtmltopdf.match").level = Level.WARNING
            Logger.getLogger("com.openhtmltopdf.general").level = Level.WARNING
            Logger.getLogger("org.apache.pdfbox").level = Level.WARNING
        } catch (_: Throwable) {}
    }

    private val mdParser: Parser
    private val htmlRenderer: HtmlRenderer

    init {
        val options = MutableDataSet()
        options.set(Parser.EXTENSIONS, listOf(
            TablesExtension.create(),
            AutolinkExtension.create(),
            StrikethroughExtension.create(),
            TaskListExtension.create(),
            EmojiExtension.create()
        ))
        this.mdParser = Parser.builder(options).build()
        this.htmlRenderer = HtmlRenderer.builder(options).build()
    }

    fun markdownToHtml(markdown: String): String {
        val document: Node = mdParser.parse(markdown)
        val body: String = htmlRenderer.render(document)
        return wrapHtml(body)
    }

    fun pdfFromHtml(html: String): ByteArray {
        val baos = ByteArrayOutputStream()
        val builder = PdfRendererBuilder()
        builder.useFastMode()
        builder.withHtmlContent(html, null)
        builder.toStream(baos)
        builder.run()
        return baos.toByteArray()
    }

    private fun wrapHtml(body: String): String {
        val css = """
            @page {
              size: A4;
              margin: 20mm 18mm 20mm 18mm;
              @bottom-right {
                content: "Page " counter(page) " of " counter(pages);
                font-size: 10px;
                color: #666;
              }
            }
            html, body { padding: 0; margin: 0; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
              font-size: 11pt; line-height: 1.55; color: #111;
            }
            h1, h2, h3, h4 { color: #111; line-height: 1.25; }
            h1 { font-size: 22pt; margin: 0 0 12pt; }
            h2 { font-size: 18pt; margin: 18pt 0 8pt; }
            h3 { font-size: 14pt; margin: 14pt 0 6pt; }
            h4 { font-size: 12pt; margin: 12pt 0 6pt; }
            p { margin: 0 0 10pt; }
            ul, ol { margin: 0 0 10pt 18pt; }
            li { margin: 0 0 6pt; }
            hr { border: none; border-top: 1px solid #ddd; margin: 14pt 0; }
            a { color: #0366d6; text-decoration: none; }
            img { max-width: 100%; height: auto; }
            code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 10pt; }
            pre { background: #f6f8fa; padding: 10pt; border-radius: 4pt; overflow-wrap: anywhere; white-space: pre-wrap; }
            blockquote { border-left: 3pt solid #ddd; padding: 6pt 10pt; color: #555; background: #fafafa; }
            table { border-collapse: collapse; width: 100%; margin: 10pt 0; }
            th, td { border: 1px solid #ddd; padding: 6pt 8pt; vertical-align: top; }
            th { background: #f0f0f0; font-weight: 600; }
            tr:nth-child(even) td { background: #fcfcfc; }
            .meta { color: #666; font-size: 9pt; }
        """.trimIndent()
        val head = "<meta charset=\"UTF-8\" />\n<style type=\"text/css\">$css</style>"
        return "<!DOCTYPE html>\n<html><head>$head</head><body>$body</body></html>"
    }
}