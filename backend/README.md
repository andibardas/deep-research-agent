# Deep Research Agent — Backend (Spring Boot + Kotlin)

Prerequisites
- Java Development Kit (JDK) 21
  - The build is configured for Java 21 (`toolchain`), so you must run with JDK 21.
- Gradle
  - Use the included Gradle Wrapper (`./gradlew`), which downloads Gradle 8.14.3 automatically — you do not need to install Gradle globally.
- API keys (required)
  - `OPENAI_API_KEY` — for chat and embeddings
  - `BRAVE_API_KEY` — for web search
  - Optional: `OPENAI_MODEL`, `OPENAI_EMBEDDING_MODEL` (override defaults)

macOS (zsh) quick setup

Install JDK 21 and set JAVA_HOME:
```bash
brew install openjdk@21
# Optionally make it available system-wide on macOS:
sudo ln -sfn $(brew --prefix)/opt/openjdk@21/libexec/openjdk.jdk \
  /Library/Java/JavaVirtualMachines/openjdk-21.jdk
# Ensure shells pick up Java 21
echo 'export JAVA_HOME=$(/usr/libexec/java_home -v21)' >> ~/.zshrc
echo 'export PATH="$JAVA_HOME/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
java -version  # should report version 21
```

Export required environment variables (use your real keys):
```bash
export OPENAI_API_KEY="sk-..."
export BRAVE_API_KEY="brv-..."
# Optional overrides
export OPENAI_MODEL="gpt-4o-mini"
export OPENAI_EMBEDDING_MODEL="text-embedding-3-small"
```

Run using the Gradle Wrapper (no global Gradle needed):
```bash
./gradlew bootRun
```

This backend powers the Deep Research Agent. It orchestrates multi-iteration web research, performs search and scraping, extracts facts with an LLM, deduplicates them via embeddings, builds a knowledge graph, streams progress to the client (SSE), and synthesizes a final Markdown report. It also exports reports to PDF/Markdown and computes an evidence support matrix.

Tech stack
- Spring Boot 3 (WebFlux), Kotlin, Coroutines
- Ktor HTTP client for external APIs
- OpenAI APIs for chat completions and embeddings
- Brave Search API for web search
- Jsoup for HTML parsing
- Apache Commons Math for vector math (cosine similarity)
- Flexmark + OpenHTMLtoPDF for Markdown→PDF export

Quick start

Environment variables (required):
- OPENAI_API_KEY
- BRAVE_API_KEY
- Optional overrides: OPENAI_MODEL (default from application.yml), OPENAI_EMBEDDING_MODEL

Run locally:
```bash
./gradlew bootRun
# Server listens on http://localhost:8080
```

Build:
```bash
./gradlew build
```

Configuration
- `src/main/resources/application.yml`
  - `server.port`: 8080
  - `api.openai`: `{ key, model, embeddingModel }`
  - `api.brave`: `{ key }`
  - `agent`: `{ max-iterations, scrape-concurrency, similarity-threshold }`
- `WebConfig`: CORS enabled for `http://localhost:4200` on `/api/**`
- `AgentProperties`: binds `agent.*`
- `ApiProperties`: binds `api.*`

High-level architecture

Controllers
- `ResearchController`
  - POST `/api/research/start` → Start a research run; returns `{ researchId }`.
  - GET `/api/research/{id}/progress` → Server-Sent Events stream of `ProgressUpdate` messages.
  - GET `/api/research/{id}/evidence-matrix` → Compute and return an `EvidenceSupportMatrixDto` derived from the current knowledge base.
- `ExportController`
  - POST `/api/export/pdf` → Accepts `{ markdown, filename? }`, returns a PDF.
  - POST `/api/export/markdown` → Accepts `{ markdown, filename? }`, returns raw `.md` bytes.

Services and core components
- `ResearchService`
  - Manages active jobs as `MutableStateFlow<ProgressUpdate>` keyed by `researchId`.
  - `startResearchJob(researchId, query)` → launches orchestration on a coroutine.
  - `getProgressFlow(researchId)` → returns the SSE-backed flow for clients.
  - `computeEvidenceSupportMatrix()` → builds a source×fact score matrix using cosine similarity of fact embeddings (details below).
- `ResearchOrchestrator`
  - The heart of the agent: multi-iteration loop to search → scrape → extract facts → deduplicate/store → plan next query → repeat, then synthesize final report and stream progress updates.
- Tools
  - `WebSearchTool` (Brave Search)
  - `WebScraperTool` (HTTP fetch + Jsoup text extraction)
  - `SynthesizerTool` (OpenAI chat for fact extraction, query planning, and final report)
- Knowledge and AI integration
  - `KnowledgeStore` (in-memory facts store with embeddings + similarity deduplication)
  - `OpenAIHttpService` (Ktor client for chat completions and embeddings)

Data contracts (DTOs)
- `ProgressUpdate` → `{ researchId, message, isComplete, finalReport?, knowledgeGraph? }`
- `KnowledgeGraphDto`
  - `nodes: List<Node>` where `Node = { id, label, type, iteration? }`
  - `edges: List<Edge>` where `Edge = { from, to }`
- `EvidenceSupportMatrixDto`
  - `sources: [{ id, label }]` — source IDs are URLs
  - `facts: [{ id, label, sourceId }]` — label is the fact text
  - `scores: number[][]` — rows=sources, cols=facts, values in [0..1]

End-to-end research flow
1) Start run
   - Client calls `POST /api/research/start` with `{ query }`.
   - Backend creates `researchId`, initializes a `MutableStateFlow` and starts `ResearchOrchestrator.conductResearch(...)` in `Dispatchers.IO`.

2) Iterate (up to `agent.max-iterations`)
   - Search: `WebSearchTool.execute(currentQuery)` calls Brave Search (`/res/v1/web/search`) with `X-Subscription-Token`.
     - Results normalized into text blocks: Title, URL, Snippet.
   - URL extraction & selection: Orchestrator extracts URLs via regex `URL: (https?://\S+)` and picks a diverse batch by host (`pickDiverse`), limited by `agent.scrape-concurrency`.
   - Concurrent scraping: For each selected URL (max concurrency):
     - `WebScraperTool.execute(url)` fetches the page and extracts readable text via Jsoup; response text is collapsed whitespace and truncated to ~6000 chars.
     - Retried with `commons.retry` (exponential backoff) up to 2 times.
   - Fact extraction: `SynthesizerTool.extractFacts(content, originalQuery)` uses OpenAI Chat with a JSON-only instruction to return `{ "facts": ["..."] }`.
     - If JSON parsing fails, it falls back to bullet/legacy patterns; if still empty, uses a keyword-weighted heuristic sentence picker.
   - Store facts: For each extracted fact, `KnowledgeStore.addFact(content, sourceUrl)`
     - Embedding via `OpenAIHttpService.createEmbeddings` with `api.openai.embeddingModel`.
     - Deduplication: compute cosine similarity against stored facts; if `maxSim > agent.similarity-threshold`, skip as redundant; else store.
   - Plan next query: `SynthesizerTool.generateNextQuery(originalQuery, knownFacts)` guides the next search step using recent facts.
   - Each substep streams a `ProgressUpdate` with a small knowledge graph snapshot.

3) Final report
   - After iterations, `SynthesizerTool.generateFinalReport(originalQuery, allFacts)` creates a Markdown report and returns `ProgressUpdate` with `isComplete=true` and `finalReport`.

4) Evidence matrix (on demand)
   - `ResearchService.computeEvidenceSupportMatrix()` groups facts by `sourceUrl` and produces a matrix showing how similar each source is to each fact.

Knowledge graph: how we store and build it
- Storage: `KnowledgeStore` keeps facts in-memory: `Map<content, Fact>`.
  - `Fact = { content: String, sourceUrl: String, embedding: RealVector }`
  - Embeddings are created when adding facts; if embedding is unavailable, the fact is skipped (to keep similarity/dedup consistent).
- Graph snapshots: `ResearchOrchestrator.buildGraph(...)`
  - If no facts yet: return only `source` nodes for visited URLs.
  - When facts exist: create `source` nodes (by URL host label) and `fact` nodes (content). Add edges `source → fact` for provenance.
  - Note: The frontend augments this with Question/Sub-question layers for visualization; backend nodes are primarily `source` and `fact` here.

Embeddings and similarity
- Embedding creation: `OpenAIHttpService.createEmbeddings(EmbeddingRequest)` posts to `/v1/embeddings`.
- Model configured via `api.openai.embeddingModel`.
- Vectors are stored as `ArrayRealVector` (Apache Commons Math).
- Similarity: cosine similarity `cos(a,b) = dot(a,b) / (||a||·||b||)`.
- Deduplication rule: skip adding a fact if the most similar stored fact has similarity > `agent.similarity-threshold` (e.g., 0.95).

Evidence support matrix (scores semantics)
- Rows: sources (unique `sourceUrl`), Columns: facts (ordered as discovered).
- Score for row `s`, column `f`:
  - If `f.sourceUrl == s` → 0.0 (skip self-reinforcement)
  - Else: compute similarity of `f.embedding` vs each embedding from the same source `s`, take the max; map cosine [-1..1] to [0..1] via `(cos + 1)/2`.
- Intuition: shows how strongly a source’s content aligns with each fact, even when the fact originated elsewhere.

External tools: details
- `WebSearchTool`
  - Ktor JSON client, calls Brave Search with `count=10`, returns up to 7 formatted results.
  - Robust error handling: returns `Error: ...` on client/server exceptions.
- `WebScraperTool`
  - Ktor fetch, `Jsoup.parse(html).text()`, whitespace-normalized and truncated. Logs failures and returns empty string on error.
- `SynthesizerTool`
  - `extractFacts`: JSON-only instruction; strips code fences; JSON parse to `FactsPayload`; legacy and heuristic fallbacks.
  - `generateNextQuery`: returns a single raw query string (quotes stripped).
  - `generateFinalReport`: creates a structured Markdown report and cites sources inline `[Source: URL]`.
- `OpenAIHttpService`
  - Ktor client with ContentNegotiation; logs non-2xx and parse errors; returns `null` on failure so callers can fallback/continue.

Error handling, retries, and concurrency
- SSE: any error pushes an error message and completes; client can surface and stop UI progress.
- Scraping: retried (2 attempts) with backoff via `commons.retry` helper.
- Concurrency: scraping limited by `agent.scrape-concurrency` (used to cap concurrent `async` tasks per iteration).

Security & keys
- API keys are read from environment variables via Spring config.
- Do not commit secrets to source control. Prefer local env vars or secret managers.

Operational notes & limitations
- Knowledge store is in-memory and cleared per run (`knowledgeStore.clear()` at start). There’s no persistent DB yet.
- Some sites require JS to render; current scraper is static HTML only.
- Rate limiting/backoff for external APIs is minimal; consider adding global rate limiters and caching.
- Knowledge graph currently exposes `source` and `fact` nodes; sub-questions are visualized client-side.
- Similarity-based dedup relies on embedding availability; if embeddings fail, facts are skipped.

API reference (backend)
- Start research
  - `POST /api/research/start`
  - Body: `{ "query": "..." }`
  - Response: `{ "researchId": "..." }`
- Progress stream
  - `GET /api/research/{researchId}/progress` (text/event-stream)
  - Events: `ProgressUpdate` (see DTOs)
- Evidence support matrix
  - `GET /api/research/{researchId}/evidence-matrix`
  - Response: `EvidenceSupportMatrixDto`
- Export
  - `POST /api/export/pdf` → PDF bytes
  - `POST /api/export/markdown` → `.md` bytes

Development tips
- Logs show iteration steps, scraping progress, and dedup decisions (similarity %).
- Tune behavior via `agent.*` in `application.yml`:
  - `max-iterations`: how deep the loop goes
  - `scrape-concurrency`: parallelism per iteration
  - `similarity-threshold`: dedup aggressiveness (0.0–1.0)

Appendix: Modules and files
- App entry: `ResearchAgentApplication.kt`
- Config: `AgentProperties.kt`, `ApiProperties.kt`, `WebConfig.kt`
- Controllers: `ResearchController.kt`, `ExportController.kt`, `controller/dto/ControllerDto.kt`
- Services: `ResearchService.kt`
- Orchestration: `agent/orchestration/ResearchOrchestrator.kt`, `ResearchState.kt`
- Knowledge: `agent/knowledge/KnowledgeStore.kt`, `Fact.kt`
- Tools: `agent/tools/WebSearchTool.kt`, `WebScraperTool.kt`, `SynthesizerTool.kt`, `Tool.kt`
- OpenAI client: `openai/OpenAIHttpService.kt`, `openai/dto/OpenAIDto.kt`
- Export: `export/PdfExporter.kt`

License
- This repository contains code that calls third-party APIs (OpenAI, Brave). Review their terms for usage and attribution.
