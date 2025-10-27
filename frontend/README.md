# Deep Research Agent — Frontend (Angular 20)

This is the Angular frontend for the Deep Research Agent. It provides the UI, routing, and client-side logic to interact with the backend APIs.

Angular CLI: 20.3.7

## Quick start

Prerequisites:
- Node.js: 20.x LTS recommended
- npm 10.x (or pnpm/yarn if your team prefers)
- Angular CLI installed globally: `npm i -g @angular/cli`

Install dependencies:
```bash
npm ci
# or: npm install
```

Run the dev server:
```bash
ng serve
# open http://localhost:4200
```

Hot reload is enabled. The app rebuilds when you edit source files.

## Build

Development build:
```bash
ng build
```

## Project structure (high level)

```
frontend/
├─ src/
│  ├─ app/
│  │  ├─ core/        # singletons: interceptors, guards, services used app-wide
│  │  ├─ shared/      # reusable UI components, directives, pipes
│  │  ├─ features/    # feature modules & pages (routed)
│  │  ├─ app.component.*   # root shell (layout, router-outlet)
│  │  └─ app.routes.ts     # standalone routes or routing module
│  ├─ assets/        # static assets (images, icons)
│  ├─ environments/  # environment.ts files
│  └─ main.ts        # bootstrap entry
└─ angular.json       # Angular workspace config
```

Key concepts:
- Standalone components vs NgModules: Angular 20 supports standalone components; routes often reference them directly.
- Container vs presentational components: containers fetch/manipulate data; presentational components render UI and emit outputs.
- Services: encapsulate API calls and business logic.
- Interceptors: add auth headers, handle errors globally.
- Guards/Resolvers: protect routes and prefetch data.

## Component catalog (project-specific)

High-level data flow:
- User enters a research query in ResearchForm → emits `startResearch(query)` → ResearchDashboard calls ResearchService to start a run → subscribes to SSE progress → updates progress, thoughts, knowledge graph, and final report → enables overlays (Argument Map, Topics, Evidence Matrix) once a report exists.

Routes:
- `''` → `ResearchDashboardComponent`
- `**` → redirect to `''`

Components

1) AppComponent (`src/app/app.component.ts`)
- Purpose: Root application shell that hosts the global `<router-outlet>`.
- Inputs: none
- Outputs: none
- Routed?: Bootstrapped root (not routed)
- Talks to: Router (via `<router-outlet>`)

2) ResearchDashboardComponent (`src/app/features/research/pages/research-dashboard/research-dashboard.component.ts`)
- Purpose: Container page that orchestrates a full research run: kicks off research, streams progress via SSE, updates the knowledge graph and final report, and hosts visualization overlays (Argument Map, Topics, Evidence Matrix).
- Inputs: none
- Outputs: none
- Routed?: yes (`path: ''`)
- Talks to: `ResearchService`
- Child components: `ResearchFormComponent`, `KnowledgeGraphComponent`, `TopicConstellationsComponent`, `EvidenceMatrixComponent`
- Notable state:
  - `isLoading$`: whether a run is in progress
  - `progress$`: coarse progress estimate (0–100)
  - `finalReport$`: final markdown report returned by backend
  - `graphData$`: current `KnowledgeGraph` snapshot for visualizations
  - `thoughts$`, `timelineEvents`: synthesized UX hints from progress messages
  - `overlayOpen`: which overlay is active: `'argument' | 'topics' | 'matrix' | false`
- Behavior highlights:
  - Calls `researchService.startResearch(query)` then `getProgressStream(researchId)`.
  - Parses progress messages to update progress and “thoughts”.
  - Opens overlays only after a final report is available; when opening Evidence Matrix, fetches matrix data via `getEvidenceMatrix(researchId)`.

3) ResearchFormComponent (`src/app/features/research/components/research-form/research-form.component.ts`)
- Purpose: Presentational component for the query input, progress indicator, and rendered final answer. Also provides Markdown/PDF export of the answer.
- Inputs:
  - `isLoading: boolean` — disables input and shows progress bar
  - `answerMd: string` — final report in Markdown to render/convert
  - `thoughts: string[]` — optional “thinking” stream (collapsed by default)
  - `progress: number` — 0–100 used for progress bar and status hint
- Outputs:
  - `startResearch: EventEmitter<string>` — fires with the typed query
- Routed?: no
- Talks to: `HttpClient` (optional server-side PDF export at `POST /api/export/pdf`), uses `marked` to convert Markdown to HTML, and `jspdf` to generate a client-side PDF fallback.
- Notes:
  - Converts Markdown to plain, printable lines for consistent layout.
  - Provides “Markdown” and “PDF” download actions when not loading and content exists.

4) KnowledgeGraphComponent (`src/app/features/research/components/knowledge-graph/knowledge-graph.component.ts`)
- Purpose: Visualizes the knowledge graph as a layered D3 diagram: Question → Sub-questions → Facts → Sources, with curved edges indicating relationships.
- Inputs:
  - `graphData: KnowledgeGraph | null`
- Outputs: none
- Routed?: no (rendered in overlay)
- Talks to: D3 and Angular `Renderer2` for DOM/SVG manipulation.
- Notes:
  - Node types and colors: Question (amber), Sub-question (violet), Fact (blue), Source (green).
  - Edge semantics:
    - `derived`: Question→Sub-question
    - `answered`: Sub-question→Fact
    - `supported`: Fact→Source
    - `related`: fallback for uncategorized edges
  - Interaction: hover shows labels; click focuses a node and highlights a path across the four layers; clicking background clears focus.

5) TopicConstellationsComponent (`src/app/features/research/components/topic-constellations/topic-constellations.component.ts`)
- Purpose: Shows “constellations” of related facts by clustering fact nodes into groups and animating them with a force simulation for exploratory browsing.
- Inputs:
  - `graphData: KnowledgeGraph | null`
- Outputs: none
- Routed?: no (rendered in overlay)
- Talks to: D3 and Angular `Renderer2`.
- Notes:
  - Clusters facts by the first one or two words in their labels to form topic groups.
  - Displays interactive dots colored by cluster; hover shows a header overlay with the fact label.

6) EvidenceMatrixComponent (`src/app/features/research/components/evidence-matrix/evidence-matrix.component.ts`)
- Purpose: Renders a source-vs-fact heatmap, showing how strongly each source supports each fact.
- Inputs:
  - `graphData: KnowledgeGraph | null` — used as a fallback to infer a binary support matrix
  - `matrix: EvidenceSupportMatrix | null` — preferred explicit matrix from backend
  - `labelMode: 'off' | 'hover' | 'auto'` — label rendering strategy (UI hint)
  - `maxLabelChars: number` — label truncation length (UI hint)
  - `labelDensity: 'high' | 'medium' | 'low'` — UI hint for labeling density
- Outputs: none
- Routed?: no (rendered in overlay)
- Talks to: Canvas 2D context and Angular `Renderer2` for an overlay header.
- Notes:
  - If no `matrix` is provided, derives a simple adjacency matrix from `graphData` edges.
  - Hovering a cell shows `source • fact • support%` in the overlay.

Services

ResearchService (`src/app/core/services/research.service.ts`)
- Purpose: Encapsulates all I/O with the research backend and normalizes streaming updates into a stable UI shape.
- Public API:
  - `startResearch(query: string): Observable<{ researchId: string }>` — starts a run and returns an id.
  - `getProgressStream(researchId: string): Observable<ProgressUpdate>` — opens an SSE stream `GET /api/research/{id}/progress`, maps and normalizes updates, and shares the stream.
  - `getEvidenceMatrix(researchId: string): Observable<EvidenceSupportMatrix>` — fetches an evidence matrix for the completed run.
- Internal behavior:
  - Tracks `maxIteration` and sub-question labels per iteration to improve graph labeling.
  - Normalizes node types to one of: `question | subquestion | fact | source` and reconstructs missing root question when needed.
- Backend endpoints (dev defaults):
  - `POST http://localhost:8080/api/research/start`
  - `GET  http://localhost:8080/api/research/{researchId}/progress` (SSE)
  - `GET  http://localhost:8080/api/research/{researchId}/evidence-matrix`
  - Optional export: `POST http://localhost:8080/api/export/pdf`

Shared models (`src/app/shared/models/research.model.ts`)
- `Node`: `{ id: string; label?: string; type: 'source' | 'fact' | 'question' | 'subquestion'; iteration?: number }`
- `Edge`: `{ id?: string; label?: string; from: string; to: string }`
- `KnowledgeGraph`: `{ nodes: Node[]; edges: Edge[] }`
- `EvidenceSupportMatrix`: `{ sources: { id; label }[]; facts: { id; label; sourceId }[]; scores: number[][] }`
- `ProgressUpdate`: `{ researchId; message; isComplete; finalReport?; knowledgeGraph? }`

Semantics and conventions
- Node types:
  - Question: the root user query (iteration 0).
  - Sub-question: derived or follow-up questions tied to iterations (> 0).
  - Fact: extracted statements that answer sub-questions.
  - Source: documents/URLs that support facts.
- Edge types (derived by visualization if not explicitly present):
  - Question→Sub-question (`derived`)
  - Sub-question→Fact (`answered`)
  - Fact→Source (`supported`)

UI overlays and when they appear
- Overlays open only after a final report exists to ensure there’s enough data to explore.
- Available overlays from the header tabs:
  - Argument Map → `KnowledgeGraphComponent`
  - Topics → `TopicConstellationsComponent`
  - Evidence Matrix → `EvidenceMatrixComponent`
