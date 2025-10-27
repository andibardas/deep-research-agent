import { AfterViewInit, Component, ElementRef, Input, OnChanges, Renderer2, SimpleChanges, ViewChild, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as d3 from 'd3';
import { KnowledgeGraph } from '../../../../shared/models/research.model';

@Component({
  selector: 'app-topic-constellations',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './topic-constellations.component.html',
  styleUrl: './topic-constellations.component.css'
})
export class TopicConstellationsComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() graphData: KnowledgeGraph | null = null;
  @ViewChild('container') container!: ElementRef<HTMLDivElement>;
  @ViewChild('overlay') overlay!: ElementRef<HTMLDivElement>;
  private ready = false;
  private ro?: ResizeObserver;
  private sim?: d3.Simulation<any, any>;
  private focusedLabel?: string | null = null;

  constructor(private renderer: Renderer2) {}

  ngAfterViewInit(): void { this.ready = true; this.setupResizeObserver(); this.render(); }
  ngOnChanges(_: SimpleChanges): void { this.render(); }
  ngOnDestroy(): void { this.ro?.disconnect(); this.sim?.stop(); }

  private setupResizeObserver() {
    try {
      this.ro = new ResizeObserver(() => this.render());
      this.ro.observe(this.container.nativeElement);
    } catch {}
  }

  private render() {
    if (!this.ready) return;
    this.sim?.stop();
    const host = this.container.nativeElement; host.innerHTML = '';
    const width = host.clientWidth || 800; const height = host.clientHeight || 420;
    const svg = d3.select(host).append('svg')
      .attr('width','100%')
      .attr('height','100%')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('preserveAspectRatio','none');

    if (!this.graphData) return;

    const ov = this.overlay?.nativeElement;
    if (ov) ov.innerHTML = '';

    const showHeader = (text: string) => {
      if (!ov) return;
      let header = ov.querySelector('.tc-header') as HTMLDivElement | null;
      if (!header) {
        header = this.renderer.createElement('div');
        this.renderer.addClass(header, 'tc-header');
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
        this.renderer.appendChild(ov, header);
      }
      header!.textContent = text || '';
    };

    const clearTips = () => {
      if (!ov) return;
      ov.querySelectorAll('.tc-tip').forEach(t => t.remove());
    };

    const facts = this.graphData.nodes.filter(n => n.type==='fact');
    if (facts.length === 0) return;

    const clusterKey = (label: string | undefined) => {
      const words = (label || '').toLowerCase().replace(/[^a-z0-9\s]+/g,' ').trim().split(/\s+/).filter(Boolean);
      return words.slice(0, 2).join(' ') || 'misc';
    };

    const clustersMap = new Map<string, { key: string; items: any[] }>();
    facts.forEach(f => {
      const key = clusterKey(f.label);
      const c = clustersMap.get(key) || { key, items: [] };
      c.items.push(f);
      clustersMap.set(key, c);
    });

    const clusters = Array.from(clustersMap.values());

    const center = { x: width/2, y: height/2 };
    const pad = 16;
    const xScale = d3.scalePoint<string>()
      .domain(clusters.map((_, i) => String(i)))
      .range([pad, width - pad])
      .padding(0.5);
    const centers = clusters.map((_, i) => ({ x: xScale(String(i)) as number, y: center.y }));

    const nodes: any[] = [];
    clusters.forEach((c, ci) => {
      nodes.push(...c.items.map(f => ({ id: f.id, label: f.label || '', type: 'fact', ci, x: (xScale(String(ci)) as number) + (Math.random()-0.5)*30, y: center.y + (Math.random()-0.5)*30 })));
    });

    const fx = d3.forceX((d:any) => centers[d.ci].x).strength(0.15);
    const fy = d3.forceY((d:any) => centers[d.ci].y).strength(0.08);

    this.sim = d3.forceSimulation(nodes as any)
      .force('charge', d3.forceManyBody().strength(-26))
      .force('collide', d3.forceCollide(12))
      .force('x', fx)
      .force('y', fy)
      .on('tick', () => {
        dots
          .attr('cx', (d:any)=> d.x = Math.max(pad, Math.min(width - pad, d.x)))
          .attr('cy', (d:any)=> d.y = Math.max(pad, Math.min(height - pad, d.y)));
      });

    const g = svg.append('g');
    const color = d3.scaleOrdinal<string, string>(d3.schemeCategory10).domain(clusters.map(c => c.key));

    const dots = g.selectAll<SVGCircleElement, any>('circle').data(nodes).join('circle')
      .attr('r', 6)
      .attr('fill', (d:any) => color(clusters[d.ci].key))
      .attr('stroke', '#0f172a').attr('stroke-width', 1.2)
      .style('cursor','pointer');

    if (ov) {
      dots
        .on('mousemove', (_event: MouseEvent, d: any) => {
          showHeader(String(d.label || ''));
        })
        .on('mouseleave', () => {
          if (!this.focusedLabel) clearTips();
          if (!this.focusedLabel) showHeader('');
        })
    }
  }
}
