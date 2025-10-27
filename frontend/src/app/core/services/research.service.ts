import {Injectable, NgZone} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Observable, share, tap} from 'rxjs';
import {EvidenceSupportMatrix, KnowledgeGraph, ProgressUpdate} from '../../shared/models/research.model';

@Injectable({ providedIn: 'root' })
export class ResearchService {
  private apiUrl = 'http://localhost:8080/api/research';

  private researchState = new Map<string, { query: string; maxIteration: number; subqByIter: Map<number, string> }>();

  constructor(private http: HttpClient, private zone: NgZone) {}

  startResearch(query: string): Observable<{ researchId: string }> {
    return this.http.post<{ researchId: string }>(`${this.apiUrl}/start`, { query }).pipe(
      tap(({ researchId }) => {
        if (researchId) this.researchState.set(researchId, { query, maxIteration: 0, subqByIter: new Map() });
      })
    );
  }

  getProgressStream(researchId: string): Observable<ProgressUpdate> {
    return new Observable<ProgressUpdate>((observer) => {
      const eventSource = new EventSource(`${this.apiUrl}/${researchId}/progress`);
      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        try {
          const msg: string = String(data.message ?? '');
          const iterMatch = /Iteration\s+(\d+)/i.exec(msg);
          const it = iterMatch ? (Number(iterMatch[1]) || 0) : undefined;
          const st = this.researchState.get(researchId);
          if (st) {
            if (typeof it === 'number' && it > st.maxIteration) {
              this.researchState.set(researchId, { ...st, maxIteration: it });
            }
            const subq = this.extractSubquestionFromMessage(msg);
            if (typeof it === 'number' && subq) {
              st.subqByIter.set(it, subq);
            }
          }
        } catch {}
        const normalized = this.normalizeUpdate(data, researchId);
        this.zone.run(() => observer.next(normalized));
      };
      eventSource.onerror = (error) => {
        this.zone.run(() => observer.error(error));
        eventSource.close();
      };
      return () => eventSource.close();
    }).pipe(share());
  }

  getEvidenceMatrix(researchId: string): Observable<EvidenceSupportMatrix> {
    return this.http.get<EvidenceSupportMatrix>(`${this.apiUrl}/${researchId}/evidence-matrix`);
  }

  private extractSubquestionFromMessage(msg: string): string | undefined {
    const s = msg.trim();
    const patterns: RegExp[] = [
      /sub-?question\s*[:\-]\s*["'“”]?(.+?)["'“”]?$/i,
      /follow-?up\s+question\s*[:\-]\s*["'“”]?(.+?)["'“”]?$/i,
      /derived\s+question\s*[:\-]\s*["'“”]?(.+?)["'“”]?$/i,
      /asking\s+(?:a\s+)?sub-?question\s*[:\-]?\s*["'“”]?(.+?)["'“”]?$/i,
      /iteration\s+\d+\s*[:\-]\s*(.+)$/i
    ];
    for (const re of patterns) {
      const m = re.exec(s);
      if (m && m[1]) return m[1].trim();
    }
    return undefined;
  }

  private normalizeUpdate(raw: any, researchId?: string): ProgressUpdate {
    const kg = raw.knowledgeGraph as any | undefined;
    const normalizedKg: KnowledgeGraph | undefined = kg ? {
      nodes: (kg.nodes ?? []).map((n: any) => {
        const iteration = (typeof n.iteration === 'number') ? n.iteration : undefined;
        const tRaw = String(n.type ?? '').toLowerCase();

        const toCanonical = (t: string | undefined): 'source'|'fact'|'question'|'subquestion' => {
          switch (t) {
            case 'source': return 'source';
            case 'fact': return 'fact';
            case 'question':
            case 'root':
            case 'root-question':
            case 'query':
              return (typeof iteration === 'number' && iteration > 0) ? 'subquestion' : 'question';
            case 'subquestion':
            case 'sub-question':
            case 'followup':
            case 'follow-up':
            case 'follow_up':
            case 'derived-question':
              return 'subquestion';
            default:
              if (typeof iteration === 'number') {
                return iteration > 0 ? 'subquestion' : 'question';
              }
              return 'fact';
          }
        };
        const type = toCanonical(tRaw);
        return {
          id: String(n.id),
          label: n.label ?? String(n.id),
          type,
          iteration
        };
      }),
      edges: (kg.edges ?? []).map((e: any, idx: number) => ({
        id: String(e.id ?? idx),
        from: String(e.from),
        to: String(e.to)
      }))
    } : undefined;

    if (normalizedKg && researchId) {
      const st = this.researchState.get(researchId);
      const questions = normalizedKg.nodes.filter(n => n.type === 'question');
      const hasQuestion = questions.length > 0;
      const hasSubQ = normalizedKg.nodes.some(n => n.type === 'subquestion');
      if (!hasQuestion && st?.query) {
        normalizedKg.nodes = [
          { id: `question:${researchId}`, label: st.query, type: 'question', iteration: 0 },
          ...normalizedKg.nodes
        ];
      }

      if (st) {
        normalizedKg.nodes = normalizedKg.nodes.map(n => {
          if (n.type === 'subquestion' && typeof n.iteration === 'number') {
            const lbl = st.subqByIter.get(n.iteration);
            if (lbl && (/^iteration\b/i.test(n.label || '') || !n.label || /^sub-?question\b/i.test(n.label))) {
              return { ...n, label: lbl };
            }
          }
          return n;
        });
      }

      const questionCount = (hasQuestion ? questions.length : 0);
      if (!hasSubQ && questionCount <= 1 && (st?.maxIteration ?? 0) > 0) {
        const subs = Array.from({ length: st!.maxIteration }, (_, i) => {
          const iter = i + 1;
          const lbl = st!.subqByIter.get(iter) || `Iteration ${iter}`;
          return ({ id: `subq:${researchId}:${iter}`, label: lbl, type: 'subquestion' as const, iteration: iter });
        });
        normalizedKg.nodes = [
          ...normalizedKg.nodes,
          ...subs
        ];
      }
    }

    return {
      researchId: String(raw.researchId),
      message: String(raw.message ?? ''),
      isComplete: !!raw.isComplete,
      finalReport: raw.finalReport ?? undefined,
      knowledgeGraph: normalizedKg
    };
  }
}
