import { AfterViewInit, Component, ElementRef, Input, OnChanges, Renderer2, SimpleChanges, ViewChild, OnDestroy } from '@angular/core';
import { KnowledgeGraph } from '../../../../shared/models/research.model';
import * as d3 from 'd3';

@Component({
  selector: 'app-knowledge-graph',
  imports: [],
  templateUrl: './knowledge-graph.component.html',
  styleUrl: './knowledge-graph.component.css',
})
export class KnowledgeGraphComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() graphData: KnowledgeGraph | null = null;
  @ViewChild('networkContainer') networkContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('overlay') overlay!: ElementRef<HTMLDivElement>;
  private maxLabelChars = 25;

  constructor(private renderer: Renderer2) {}

  private ready = false;
  private focusedId: string | null = null;
  private ro?: ResizeObserver;
  private rootId: string | null = null;
  private focusedPathEdgeSet: Set<string> = new Set();
  private focusedPathNodeSet: Set<string> = new Set();

  ngAfterViewInit(): void { this.ready = true; this.setupResizeObserver(); this.render(); }
  ngOnChanges(_: SimpleChanges): void { this.render(); }
  ngOnDestroy(): void { this.ro?.disconnect(); }

  private setupResizeObserver() {
    try {
      this.ro = new ResizeObserver(() => this.render());
      this.ro.observe(this.networkContainer.nativeElement);
    } catch {}
  }

  private render(): void {
    if (!this.ready) return;
    const host = this.networkContainer.nativeElement;
    host.innerHTML = '';

    const width = host.clientWidth || 800;
    const height = host.clientHeight || 420;

    const svgRoot = d3.select(host).append('svg')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('preserveAspectRatio', 'none');

    const svg = svgRoot.append('g').attr('transform', `translate(${width/2},${height/2})`);

    if (!this.graphData) return;

    const trunc = (s: string) => {
      const max = this.maxLabelChars;
      if (!s) return '';
      return s.length > max ? s.slice(0, Math.max(0, max - 3)) + '...' : s;
    };

    const overlayEl = this.overlay?.nativeElement;
    if (overlayEl) overlayEl.innerHTML = '';

    const allNodes = this.graphData.nodes ?? [];
    const nodesById = new Map(allNodes.map(n => [n.id, n] as const));

    const isQuestion = (n: any) => (n?.type === 'question');
    const isSubQ = (n: any) => (n?.type === 'subquestion');
    const isFact = (n: any) => (n?.type === 'fact');
    const isSource = (n: any) => (n?.type === 'source');

    const questionNodes = allNodes.filter(isQuestion);
    const rootQ = questionNodes[0];

    let centerId: string | null = rootQ?.id ?? null;
    if (!centerId) {
      const deg = new Map<string, number>();
      const inc = (id: string) => deg.set(id, (deg.get(id) ?? 0) + 1);
      (this.graphData.edges || []).forEach(e => { inc(e.from); inc(e.to); });
      let maxId: string | null = null; let maxDeg = -1;
      for (const n of allNodes) {
        const d = deg.get(n.id) ?? 0;
        if (d > maxDeg) { maxDeg = d; maxId = n.id; }
      }
      centerId = maxId ?? (allNodes[0]?.id ?? null);
    }
    this.rootId = centerId;
    const extraQuestions = questionNodes.filter(q => !centerId || q.id !== centerId);
    const subQuestions = allNodes.filter(isSubQ);
    const facts = allNodes.filter(isFact);
    const sources = allNodes.filter(isSource);

    const colX = {
      question: -width * 0.35,
      subquestion: -width * 0.12,
      fact: width * 0.12,
      source: width * 0.35
    } as const;

    const layerR = { question: 1, subquestion: 1, fact: 1, source: 1 } as const;

    type NodeEx = { id: string; label: string; fullLabel: string; type: 'question'|'subquestion'|'fact'|'source'; x: number; y: number; ring: keyof typeof layerR; angle?: number };
    const placedNodes: Array<NodeEx> = [];

    const placeColumn = (ids: string[], x: number, type: NodeEx['type']) => {
      const filtered = ids;
      const n = filtered.length;
      if (!n) return;
      const padding = 30;
      const span = height - 2 * padding;
      filtered.forEach((id, idx) => {
        const src = nodesById.get(id)!;
        const y = -height/2 + padding + (span * (idx + 1)) / (n + 1);
        placedNodes.push({ id, label: trunc(src.label || ''), fullLabel: src.label || '', type, x, y, ring: type, angle: undefined });
      });
    };

    const subQIds = [...subQuestions.map(n => n.id), ...extraQuestions.map(n => n.id)];
    placeColumn(questionNodes.map(n => n.id), colX.question, 'question');
    placeColumn(subQIds, colX.subquestion, 'subquestion');
    placeColumn(facts.map(n => n.id), colX.fact, 'fact');
    placeColumn(sources.map(n => n.id), colX.source, 'source');

    const rawEdges = (this.graphData.edges || []).map(e => ({ source: e.from, target: e.to }));
    type Link = { source: string; target: string; kind: 'derived'|'answered'|'supported'|'related' };
    const links: Array<Link> = [];

    const getKind = (sId: string, tId: string): Link['kind'] => {
      const s = nodesById.get(sId); const t = nodesById.get(tId);
      if (!s || !t) return 'related';
      if ((isQuestion(s) || isSubQ(s)) && isSubQ(t)) return 'derived';
      if ((isQuestion(s) || isSubQ(s)) && isFact(t)) return 'answered';
      if (isFact(s) && isSource(t)) return 'supported';
      if ((isQuestion(t) || isSubQ(t)) && isSubQ(s)) return 'derived';
      if ((isQuestion(t) || isSubQ(t)) && isFact(s)) return 'answered';
      if (isFact(t) && isSource(s)) return 'supported';
      return 'related';
    };

    rawEdges.forEach(e => links.push({ source: e.source, target: e.target, kind: getKind(e.source, e.target) }));

    const nodeById = new Map(placedNodes.map(n => [n.id, n] as const));

    const existingEdgeSet = new Set<string>();
    for (const l of links) { existingEdgeSet.add(`${l.source}|${l.target}`); existingEdgeSet.add(`${l.target}|${l.source}`); }

    if (this.rootId) {
      for (const sq of placedNodes.filter(n => n.type === 'subquestion')) {
        if (!existingEdgeSet.has(`${this.rootId}|${sq.id}`)) {
          links.push({ source: this.rootId, target: sq.id, kind: 'derived' });
          existingEdgeSet.add(`${this.rootId}|${sq.id}`); existingEdgeSet.add(`${sq.id}|${this.rootId}`);
        }
      }
    }

    const subqPlaced = placedNodes.filter(n => n.type === 'subquestion');
    const factPlaced = placedNodes.filter(n => n.type === 'fact');
    const sourcePlaced = placedNodes.filter(n => n.type === 'source');

    const subqByIter = new Map<number, string>();
    for (const n of allNodes) {
      if (n.type === 'subquestion' && typeof n.iteration === 'number') {
        subqByIter.set(n.iteration, n.id);
      }
    }
    const factIterMap = new Map<string, number>();
    for (const n of allNodes) {
      if (n.type === 'fact' && typeof n.iteration === 'number') {
        factIterMap.set(n.id, n.iteration);
      }
    }

    for (const f of factPlaced) {
      const iter = factIterMap.get(f.id);
      if (typeof iter === 'number') {
        const sqId = subqByIter.get(iter);
        if (sqId && !existingEdgeSet.has(`${sqId}|${f.id}`)) {
          links.push({ source: sqId, target: f.id, kind: 'answered' });
          existingEdgeSet.add(`${sqId}|${f.id}`); existingEdgeSet.add(`${f.id}|${sqId}`);
        }
      }
    }

    const yDist = (a: number, b: number) => Math.abs(a - b);
    for (const f of factPlaced) {
      const hasSubqFact = subqPlaced.some(sq => existingEdgeSet.has(`${sq.id}|${f.id}`));
      if (hasSubqFact) continue;
      if (!subqPlaced.length) continue;
      let bestSq = subqPlaced[0]; let bestD = yDist(f.y, bestSq.y);
      for (let i = 1; i < subqPlaced.length; i++) {
        const sq = subqPlaced[i]; const d = yDist(f.y, sq.y);
        if (d < bestD) { bestD = d; bestSq = sq; }
      }
      if (!existingEdgeSet.has(`${bestSq.id}|${f.id}`)) {
        links.push({ source: bestSq.id, target: f.id, kind: 'answered' });
        existingEdgeSet.add(`${bestSq.id}|${f.id}`); existingEdgeSet.add(`${f.id}|${bestSq.id}`);
      }
    }

    for (const f of factPlaced) {
      const hasFactSource = sourcePlaced.some(src => existingEdgeSet.has(`${f.id}|${src.id}`));
      if (hasFactSource) continue;
      if (!sourcePlaced.length) continue;
      let bestSrc = sourcePlaced[0]; let bestD = yDist(f.y, bestSrc.y);
      for (let i = 1; i < sourcePlaced.length; i++) {
        const src = sourcePlaced[i]; const d = yDist(f.y, src.y);
        if (d < bestD) { bestD = d; bestSrc = src; }
      }
      if (!existingEdgeSet.has(`${f.id}|${bestSrc.id}`)) {
        links.push({ source: f.id, target: bestSrc.id, kind: 'supported' });
        existingEdgeSet.add(`${f.id}|${bestSrc.id}`); existingEdgeSet.add(`${bestSrc.id}|${f.id}`);
      }
    }

    const color = (t: string) => {
      if (t === 'question') return '#f59e0b';
      if (t === 'subquestion') return '#a78bfa';
      if (t === 'fact') return '#60a5fa';
      return '#10b981';
    };

    svg.append('g').attr('stroke-linecap','round')
      .selectAll<SVGPathElement, Link>('path')
      .data(links)
      .join('path')
      .attr('class','edge')
      .attr('d', (d) => {
        const s = nodeById.get(d.source); const t = nodeById.get(d.target);
        if (!s || !t) return '';
        const cx = 0, cy = 0;
        return `M${s.x},${s.y} Q${cx},${cy} ${t.x},${t.y}`;
      })
      .attr('fill','none')
      .attr('stroke', (d) => (
        d.kind === 'supported' ? 'rgba(148,163,184,0.5)'
      : d.kind === 'answered'  ? '#94a3b8'
      : d.kind === 'derived'   ? '#94a3b8'
      : '#64748b'
      ))
      .attr('stroke-width', (d) => d.kind === 'supported' ? 1.5 : 2.5)
      .attr('opacity', 0.8)
      .attr('data-edge', (d) => `${d.source}|${d.target}`);

    const overlayEl2 = overlayEl;
    const showHeader = (text: string) => {
      if (!overlayEl2) return;
      let header = overlayEl2.querySelector('.kg-header') as HTMLDivElement | null;
      if (!header) {
        header = this.renderer.createElement('div');
        this.renderer.addClass(header, 'kg-header');
        this.renderer.setStyle(header, 'position', 'absolute');
        this.renderer.setStyle(header, 'left', '12px');
        this.renderer.setStyle(header, 'right', '12px');
        this.renderer.setStyle(header, 'top', '12px');
        this.renderer.setStyle(header, 'background', 'transparent');
        this.renderer.setStyle(header, 'color', '#fff');
        this.renderer.setStyle(header, 'padding', '8px 12px');
        this.renderer.setStyle(header, 'borderRadius', '8px');
        this.renderer.setStyle(header, 'fontSize', '18px');
        this.renderer.setStyle(header, 'fontWeight', '600');
        this.renderer.setStyle(header, 'textAlign', 'center');
        this.renderer.setStyle(header, 'wordWrap', 'break-word');
        this.renderer.setStyle(header, 'whiteSpace', 'normal');
        this.renderer.setStyle(header, 'maxHeight', '30%');
        this.renderer.setStyle(header, 'overflow', 'auto');
        this.renderer.appendChild(overlayEl2, header);
      }

      header!.textContent = text || '';
    };

    const g = svg.append('g').selectAll<SVGGElement, NodeEx>('g.node')
      .data(placedNodes)
      .join('g')
      .attr('class','node')
      .attr('transform', (d) => `translate(${d.x},${d.y})`)
      .attr('data-id', (d) => d.id)
      .style('cursor','pointer')
      .on('mousemove', (_event: MouseEvent, d: any) => {
        showHeader(d.fullLabel || '');
      })
      .on('mouseleave', (_event: MouseEvent, _d: any) => {
        if (!this.focusedId) {
          showHeader('');
        } else {
          const nf = nodeById.get(this.focusedId);
          showHeader(nf?.fullLabel || '');
        }
      })
      .on('mouseover', function(this: SVGGElement){ d3.select(this).raise(); })
      .on('mouseout', function(this: SVGGElement){ /* noop */ })
      .on('click', (event: MouseEvent, d: NodeEx) => {
        event.stopPropagation();
        if (this.focusedId === d.id) {
          this.focusedId = null;
          this.focusedPathEdgeSet.clear();
          this.focusedPathNodeSet.clear();
          showHeader('');
        } else {
          this.focusedId = d.id;
          this.computeAndSetFourLayerPath(d.id, placedNodes, links);
          showHeader(d.fullLabel || '');
        }
        this.highlight(svg, placedNodes, links);
      });

    g.append('circle')
      .attr('r', (d) => d.type === 'question' ? 12 : d.type === 'subquestion' ? 9 : d.type === 'fact' ? 6 : 8)
      .attr('fill', (d) => color(d.type))
      .attr('stroke', '#1f2937')
      .attr('stroke-width', 1.5);

    svg.append('g').attr('class','highlight-layer').style('pointer-events','none');

    svgRoot.on('click', () => {
      this.focusedId = null;
      this.focusedPathEdgeSet.clear();
      this.focusedPathNodeSet.clear();
      showHeader('');
      this.highlight(svg, placedNodes, links);
    });

    this.highlight(svg, placedNodes, links);
  }

  private computeAndSetFourLayerPath(clickedId: string, placedNodes: Array<{ id: string; type: string; angle?: number; x: number; y: number }>, links: Array<{ source: string; target: string; kind: string }>) {
    this.focusedPathEdgeSet.clear();
    this.focusedPathNodeSet.clear();

    const byId = new Map(placedNodes.map(n => [n.id, n] as const));
    const get = (id: string | undefined | null) => (id ? byId.get(id) : undefined);

    const ofType = (type: string) => placedNodes.filter(n => n.type === type);
    const neighborsOfType = (id: string, type: string) => {
      const ids = new Set<string>();
      for (const l of links) {
        if (l.source === id) {
          const t = get(l.target); if (t && t.type === type) ids.add(t.id);
        } else if (l.target === id) {
          const s = get(l.source); if (s && s.type === type) ids.add(s.id);
        }
      }
      return Array.from(ids);
    };

    const nearestByAngle = (target: any, candidates: any[]) => {
      if (!target || !candidates.length) return undefined as any;
      let best = candidates[0]; let bestD = Math.abs((target.y ?? 0) - (best.y ?? 0));
      for (let i = 1; i < candidates.length; i++) {
        const c = candidates[i]; const d = Math.abs((target.y ?? 0) - (c.y ?? 0));
        if (d < bestD) { bestD = d; best = c; }
      }
      return best;
    };

    const clicked = get(clickedId);
    if (!clicked) return;

    const q = this.rootId ? get(this.rootId) : undefined;

    let sq: any | undefined;
    let f: any | undefined;
    let s: any | undefined;

    if (clicked.type === 'question') {
      sq = neighborsOfType(clicked.id, 'subquestion').map(get).filter(Boolean)[0] || nearestByAngle(clicked, ofType('subquestion'));
      f = sq ? (neighborsOfType(sq.id, 'fact').map(get).filter(Boolean)[0] || nearestByAngle(sq, ofType('fact'))) : undefined;
      s = f ? (neighborsOfType(f.id, 'source').map(get).filter(Boolean)[0] || nearestByAngle(f, ofType('source'))) : undefined;
    } else if (clicked.type === 'subquestion') {
      sq = clicked;
      f = neighborsOfType(sq.id, 'fact').map(get).filter(Boolean)[0] || nearestByAngle(sq, ofType('fact'));
      s = f ? (neighborsOfType(f.id, 'source').map(get).filter(Boolean)[0] || nearestByAngle(f, ofType('source'))) : undefined;
    } else if (clicked.type === 'fact') {
      f = clicked;
      sq = neighborsOfType(f.id, 'subquestion').map(get).filter(Boolean)[0] || nearestByAngle(f, ofType('subquestion'));
      s = neighborsOfType(f.id, 'source').map(get).filter(Boolean)[0] || nearestByAngle(f, ofType('source'));
    } else if (clicked.type === 'source') {
      s = clicked;
      f = neighborsOfType(s.id, 'fact').map(get).filter(Boolean)[0] || nearestByAngle(s, ofType('fact'));
      sq = f ? (neighborsOfType(f.id, 'subquestion').map(get).filter(Boolean)[0] || nearestByAngle(f, ofType('subquestion'))) : undefined;
    }

    const pathIds: string[] = [];
    if (q) pathIds.push(q.id);
    if (sq && (!pathIds.length || pathIds[pathIds.length - 1] !== sq.id)) pathIds.push(sq.id);
    if (f && pathIds[pathIds.length - 1] !== f.id) pathIds.push(f.id);
    if (s && pathIds[pathIds.length - 1] !== s.id) pathIds.push(s.id);

    if (!pathIds.includes(clicked.id)) pathIds.push(clicked.id);

    const linkSet = new Set(links.map(l => `${l.source}|${l.target}`));
    for (let i = 0; i < pathIds.length - 1; i++) {
      const a = pathIds[i], b = pathIds[i+1];
      if (linkSet.has(`${a}|${b}`) || linkSet.has(`${b}|${a}`)) {
        this.focusedPathEdgeSet.add(`${a}|${b}`);
        this.focusedPathEdgeSet.add(`${b}|${a}`);
      }
    }

    for (const id of pathIds) this.focusedPathNodeSet.add(id);
  }

  private highlight(svg: d3.Selection<SVGGElement, unknown, null, undefined>, _nodes: any[], links: Array<{ source: string; target: string; kind: string }>) {
    const focus = this.focusedId;
    const hasPath = this.focusedPathEdgeSet.size > 0;

    const edgeSel = svg.selectAll<SVGPathElement, { source: string; target: string; kind: any }>('path.edge');
    edgeSel
      .attr('opacity', (d) => {
        if (!focus) return 0.8;
        if (hasPath) {
          return this.focusedPathEdgeSet.has(`${d.source}|${d.target}`) ? 1 : 0.08;
        }
        return (d.source === focus || d.target === focus) ? 1 : 0.08;
      })
      .attr('stroke-width', (d) => {
        if (!focus) return d.kind === 'supported' ? 1.5 : 2.5;
        if (hasPath) return this.focusedPathEdgeSet.has(`${d.source}|${d.target}`) ? 3.5 : 1;
        return (d.source === focus || d.target === focus) ? 3 : 1;
      })
      .attr('stroke', (d) => {
        if (!focus) {
          return d.kind === 'supported' ? 'rgba(148,163,184,0.5)'
               : d.kind === 'answered'  ? '#94a3b8'
               : d.kind === 'derived'   ? '#94a3b8'
               : '#64748b';
        }
        if (hasPath && this.focusedPathEdgeSet.has(`${d.source}|${d.target}`)) return '#fbbf24';
        return (d.kind === 'supported' ? 'rgba(148,163,184,0.5)' : d.kind === 'answered' ? '#94a3b8' : d.kind === 'derived' ? '#eab308' : '#64748b');
      });

    if (focus && hasPath) {
      edgeSel.filter((d) => this.focusedPathEdgeSet.has(`${d.source}|${d.target}`)).each(function(){ d3.select(this as SVGPathElement).raise(); });
    }

    const nodeSel = svg.selectAll<SVGGElement, any>('g.node');
    nodeSel
      .attr('opacity', (d: any) => {
        if (!focus) return 1;
        if (hasPath) return this.focusedPathNodeSet.has(d.id) ? 1 : 0.15;
        const connected = links.some((l) => l.source === d.id || l.target === d.id);
        return (d.id === focus || connected) ? 1 : 0.15;
      })
      .attr('transform', (d: any) => `translate(${d.x},${d.y}) scale(${this.focusedPathNodeSet.has(d.id) ? 1.05 : 1})`);

    if (focus && hasPath) {
      nodeSel.filter((d: any) => this.focusedPathNodeSet.has(d.id)).each(function(){ d3.select(this as SVGGElement).raise(); });
    }

    const hl = svg.select<SVGGElement>('g.highlight-layer');
    const nodesById = new Map<string, any>(_nodes.map((n: any) => [n.id, n]));

    const highlightedEdges = hasPath ? links.filter(l => this.focusedPathEdgeSet.has(`${l.source}|${l.target}`)) : [];

    const edgeOverlay = hl.selectAll<SVGPathElement, typeof highlightedEdges[number]>('path.hl-edge')
      .data(highlightedEdges, (d: any) => `${d.source}|${d.target}`);

    edgeOverlay.join(
      enter => enter.append('path')
        .attr('class','hl-edge')
        .attr('fill','none')
        .attr('stroke','#fbbf24')
        .attr('stroke-width', 4.5)
        .attr('opacity', 0.95)
        .attr('d', (d: any) => {
          const s = nodesById.get(d.source); const t = nodesById.get(d.target);
          if (!s || !t) return '';
          const cx = 0, cy = 0;
          return `M${s.x},${s.y} Q${cx},${cy} ${t.x},${t.y}`;
        }),
      update => update
        .attr('stroke','#fbbf24')
        .attr('stroke-width', 4.5)
        .attr('opacity', 0.95)
        .attr('d', (d: any) => {
          const s = nodesById.get(d.source); const t = nodesById.get(d.target);
          if (!s || !t) return '';
          const cx = 0, cy = 0;
          return `M${s.x},${s.y} Q${cx},${cy} ${t.x},${t.y}`;
        }),
      exit => exit.remove()
    );

    const haloNodes = hasPath ? _nodes.filter((n: any) => this.focusedPathNodeSet.has(n.id)) : [];
    const halo = hl.selectAll<SVGCircleElement, any>('circle.hl-halo')
      .data(haloNodes, (d: any) => d.id);

    halo.join(
      enter => enter.append('circle')
        .attr('class','hl-halo')
        .attr('r', (d: any) => d.type === 'question' ? 16 : d.type === 'subquestion' ? 13 : d.type === 'fact' ? 10 : 12)
        .attr('cx', (d: any) => d.x)
        .attr('cy', (d: any) => d.y)
        .attr('fill','none')
        .attr('stroke','#fde68a')
        .attr('stroke-width', 3)
        .attr('opacity', 0.85),
      update => update
        .attr('cx', (d: any) => d.x)
        .attr('cy', (d: any) => d.y)
        .attr('stroke','#fde68a')
        .attr('opacity', 0.85),
      exit => exit.remove()
    );

    if (!focus || !hasPath) {
      hl.selectAll('*').remove();
    }
  }
}
