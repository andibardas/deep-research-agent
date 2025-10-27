# Deep Research Agent

An end-to-end, multi-source research assistant. It searches the web, scrapes sources, extracts and de-duplicates facts with embeddings, builds a knowledge graph, and synthesizes a Markdown report—plus interactive visuals to audit evidence.

What it’s for
- Answering complex questions that need multiple sources
- Cross-checking claims and tracing them back to sources
- Creating concise, well-cited summaries you can export to Markdown/PDF

Key features
- Multi-iteration research loop: search → scrape → extract → deduplicate → plan next step → synthesize
- Evidence-aware visualizations: Argument Map, Topic Constellations, Evidence Matrix
- Live progress via SSE, final Markdown report with inline citations

Prerequisites
- macOS (or Linux/Windows with equivalent tooling)
- Java Development Kit (JDK) 21 (backend)
- Node.js 20.x and npm 10.x (frontend)
- API keys: OPENAI_API_KEY, BRAVE_API_KEY

Quick start (macOS, zsh)
1) Install Java 21
```bash
brew install openjdk@21
sudo ln -sfn $(brew --prefix)/opt/openjdk@21/libexec/openjdk.jdk \
  /Library/Java/JavaVirtualMachines/openjdk-21.jdk
echo 'export JAVA_HOME=$(/usr/libexec/java_home -v21)' >> ~/.zshrc
echo 'export PATH="$JAVA_HOME/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
java -version
```

2) Install Node 20 and Angular CLI
```bash
brew install node@20
echo 'export PATH="/opt/homebrew/opt/node@20/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
npm i -g @angular/cli
node -v && npm -v && ng version
```

3) Export API keys (replace with your keys)
```bash
export OPENAI_API_KEY="sk-..."
export BRAVE_API_KEY="brv-..."
# Optional overrides
export OPENAI_MODEL="gpt-4o-mini"
export OPENAI_EMBEDDING_MODEL="text-embedding-3-small"
```

4) Start backend
```bash
cd backend
./gradlew bootRun
# Backend: http://localhost:8080
```

5) Start frontend (in a new terminal)
```bash
cd frontend
npm ci
ng serve
# Frontend: http://localhost:4200
```

User flow
1) Open http://localhost:4200
2) Enter a complex question and click Start
3) While running
   - The app searches the web, scrapes pages, extracts candidate facts using an LLM
   - Facts are embedded and compared; near-duplicates are skipped
   - You’ll see a progress bar and, when available, graph data becomes explorable
4) Completion
   - A Markdown report is shown with inline source citations `[Source: URL]`
   - You can export the report as Markdown or PDF
   - Open the tabs in the header to explore: Argument Map, Topics, Evidence Matrix

Expected outputs and how to interpret them
- Final report (Markdown)
  - Concise synthesis answering your question; inline citations let you verify claims
  - Export options: Markdown and PDF
- Argument Map (interactive graph)
  - Columns: Question → Sub-questions → Facts → Sources
  - Edges:
    - Derived (Question→Sub-question), Answered (Sub-question→Fact), Supported (Fact→Source)
  - Click a node to highlight a likely reasoning path across the four layers
  - Use it to trace claims back to facts and their sources
- Topic Constellations
  - Clusters fact nodes into topical groups; hover to see fact labels
  - Use it to spot themes and coverage breadth
- Evidence Matrix
  - Rows: sources; Columns: facts; Color: how strongly a source supports a fact (0–1)
  - Values are derived from cosine similarity of embeddings (mapped to [0..1])
  - Use it to gauge cross-source support and potential consensus

How it works (high level)
- Backend (Spring Boot + Kotlin)
  - Orchestrates N iterations (configurable). Each iteration:
    1) Search via Brave API
    2) Scrape selected URLs (Jsoup)
    3) Extract facts via OpenAI Chat (JSON-first, with robust fallbacks)
    4) Embed and de-duplicate facts using cosine similarity
    5) Plan next query via LLM
    6) Stream a progress update and knowledge graph snapshot
  - After iterations, synthesizes a final Markdown report with citations
- Frontend (Angular 20)
  - Collects your query, shows progress, renders the final report
  - Provides interactive visuals: Argument Map (D3/SVG), Topics (D3/force), Evidence Matrix (Canvas)

When to use this
- Investigations where multiple independent sources matter (market/tech research, due diligence, policy analysis)
- Rapid literature reconnaissance and claim cross-checking
- Drafting briefings with auditable evidence

Limitations and notes
- In-memory knowledge: facts are not persisted between runs
- Static scraping: JavaScript-heavy sites may yield limited text
- LLM and embeddings can be imperfect—always verify key claims and sources
- API rate limits should be respected

Troubleshooting
- Backend won’t start: ensure JDK 21 is active (`java -version`) and keys are exported
- Frontend CORS errors: backend allows `http://localhost:4200` by default; confirm it’s running on 8080
- No results/few facts: try a broader query or allow more iterations in backend config (`agent.max-iterations`)

Repository layout
```
backend/   # Spring Boot + Kotlin backend (SSE, orchestration, embeddings, export)
frontend/  # Angular 20 SPA (UI, report, visualizations)
```
- Backend docs: `backend/README.md`
- Frontend docs: `frontend/README.md`
