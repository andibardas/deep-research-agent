import {Component, OnDestroy} from '@angular/core';
import {BehaviorSubject, Subscription} from 'rxjs';
import {KnowledgeGraph, ProgressUpdate, EvidenceSupportMatrix} from '../../../../shared/models/research.model';
import {ResearchService} from '../../../../core/services/research.service';
import {CommonModule} from '@angular/common';
import {ResearchFormComponent} from '../../components/research-form/research-form.component';
import {KnowledgeGraphComponent} from '../../components/knowledge-graph/knowledge-graph.component';
import { TopicConstellationsComponent } from '../../components/topic-constellations/topic-constellations.component';
import { EvidenceMatrixComponent } from '../../components/evidence-matrix/evidence-matrix.component';

@Component({
  selector: 'app-research-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    ResearchFormComponent,
    KnowledgeGraphComponent,
    TopicConstellationsComponent,
    EvidenceMatrixComponent
  ],
  templateUrl: './research-dashboard.component.html',
  styleUrl: './research-dashboard.component.css',
})
export class ResearchDashboardComponent implements OnDestroy {
  isLoading$ = new BehaviorSubject<boolean>(false);
  progressLog$ = new BehaviorSubject<string[]>([]);
  finalReport$ = new BehaviorSubject<string>('');
  graphData$ = new BehaviorSubject<KnowledgeGraph | null>(null);
  progress$ = new BehaviorSubject<number>(0);
  lastQuery$ = new BehaviorSubject<string>('');
  thoughts$ = new BehaviorSubject<string[]>([]);
  timelineEvents: { t: number; label: string }[] = [];
  private subscription: Subscription = new Subscription();
  private currentIteration = 0;
  private seenSynthesis = false;
  private readonly ITER_STEP = 18;
  overlayOpen: false | 'argument'|'flow'|'timeline'|'topics'|'matrix' = false;
  private currentResearchId: string | null = null;
  evidenceMatrix$ = new BehaviorSubject<EvidenceSupportMatrix | null>(null);

  constructor(private researchService: ResearchService) {}

  onStartResearch(query: string): void {
    this.isLoading$.next(true);
    this.progressLog$.next([]);
    this.finalReport$.next('');
    this.graphData$.next(null);
    this.progress$.next(5);
    this.lastQuery$.next(query);
    this.thoughts$.next([
      `Goal: ${query}`,
      'Approach: search, read, cross-check, and synthesize.',
    ]);
    this.currentIteration = 0;
    this.seenSynthesis = false;
    this.currentResearchId = null;
    this.evidenceMatrix$.next(null);
    this.subscription.add(this.researchService.startResearch(query).subscribe({
      next: (response) => {
        this.currentResearchId = response.researchId;
        this.subscribeToProgress(response.researchId);
      }, error: (err) => {
        this.progressLog$.next([...this.progressLog$.value, `Error starting research: ${err.message}`,]);
        this.isLoading$.next(false);
        this.progress$.next(0);
      },
    }));
  }

  private subscribeToProgress(researchId: string): void {
    this.subscription.add(this.researchService.getProgressStream(researchId).subscribe({
      next: (update: ProgressUpdate) => {
        const now = Date.now();
        this.timelineEvents = [...this.timelineEvents, { t: now, label: update.message }];

        const iterMatch = /Iteration\s+(\d+)/i.exec(update.message || '');
        const isSynthesizing = /(Synthesizing final report|creating\s+(the\s+)?final report|Synthesizing a coherent conclusion)/i.test(update.message || '');

        if (iterMatch) {
          const iter = Number(iterMatch[1]) || 0;
          if (iter > this.currentIteration) this.currentIteration = iter;
        }
        if (isSynthesizing) this.seenSynthesis = true;

        let target = Math.min(90, this.currentIteration * this.ITER_STEP);
        if (this.seenSynthesis) target = Math.max(target, 95);

        if (target > this.progress$.value) this.progress$.next(target);

        const t = this.synthesizeThought(update.message);
        if (t) {
          this.thoughts$.next([...this.thoughts$.value, t]);
        }

        if (update.knowledgeGraph) {
          this.graphData$.next(update.knowledgeGraph);
        }

        if (update.finalReport && update.finalReport.trim().length > 0) {
          this.finalReport$.next(update.finalReport);
        }

        if (update.isComplete) {
          this.thoughts$.next([...this.thoughts$.value, 'Synthesized a conclusion based on gathered facts.']);
          this.isLoading$.next(false);
          if ((this.finalReport$.value || '').trim().length === 0) {
            this.finalReport$.next(update.finalReport || 'No report generated.');
          }
          this.progress$.next(100);
        }
      }, error: (err) => {
        this.progressLog$.next([...this.progressLog$.value, `Error in progress stream: ${err.message || 'Connection lost'}`,]);
        this.isLoading$.next(false);
        this.progress$.next(0);
      },
    }));
  }

  private synthesizeThought(message: string): string | null {
    const m = message || '';
    if (/Searching for '(.+)'/i.test(m)) {
      const q = m.match(/Searching for '(.+)'/i)?.[1] ?? '';
      return `Exploring the web for: ${q}`;
    }
    if (/Scraping (https?:\/\/\S+)/i.test(m)) {
      try {
        const url = m.match(/Scraping (https?:\/\/\S+)/i)?.[1] ?? '';
        const host = new URL(url).host.replace(/^www\./, '');
        return `Visiting ${host} to extract insights.`;
      } catch { return 'Visiting a source to extract insights.'; }
    }
    if (/Analyzing content from (https?:\/\/\S+)/i.test(m)) {
      try {
        const url = m.match(/Analyzing content from (https?:\/\/\S+)/i)?.[1] ?? '';
        const host = new URL(url).host.replace(/^www\./, '');
        return `Analyzing findings from ${host}.`;
      } catch { return 'Analyzing findings from a source.'; }
    }
    if (/Found (\d+) new facts\./i.test(m)) {
      const counts = m.match(/Found (\d+) new facts\.[^\d]*(\d+).*Sources with facts: (\d+)/i);
      if (counts) {
        const x = counts[1], y = counts[2], z = counts[3];
        return `Extracted ${x} new facts (total ${y}) across ${z} sources.`;
      }
      return 'Extracted new facts from sources.';
    }
    if (/Ensuring at least \d+ sources/i.test(m)) {
      return 'Ensuring multiple independent sources are used.';
    }
    if (/Synthesizing final report/i.test(m)) {
      return 'Synthesizing a coherent conclusion from the gathered facts.';
    }
    if (/Research complete/i.test(m)) {
      return 'Conclusion is ready.';
    }
    return null;
  }

  get hasFinalReport(): boolean { return (this.finalReport$.value || '').trim().length > 0; }

  openOverlay(which: 'argument'|'flow'|'timeline'|'topics'|'matrix'): void {
    if (!this.hasFinalReport) return; this.overlayOpen = which;
    if (which === 'matrix' && this.currentResearchId) {
      this.researchService.getEvidenceMatrix(this.currentResearchId).subscribe({
        next: (m) => this.evidenceMatrix$.next(m),
        error: () => this.evidenceMatrix$.next(null)
      });
    }
  }
  closeOverlay(): void { this.overlayOpen = false; }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }
}
