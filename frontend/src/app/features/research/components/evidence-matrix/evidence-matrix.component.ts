import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  SimpleChanges,
  ViewChild,
  Renderer2,
  OnDestroy
} from '@angular/core';
import {CommonModule} from '@angular/common';
import {EvidenceSupportMatrix, KnowledgeGraph} from '../../../../shared/models/research.model';

@Component({
  selector: 'app-evidence-matrix',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './evidence-matrix.component.html',
  styleUrl: './evidence-matrix.component.css'
})
export class EvidenceMatrixComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() graphData: KnowledgeGraph | null = null;
  @Input() matrix: EvidenceSupportMatrix | null = null;
  @Input() labelMode: 'off' | 'hover' | 'auto' = 'hover';
  @Input() maxLabelChars = 25;
  @Input() labelDensity: 'high' | 'medium' | 'low' = 'medium';
  @ViewChild('cnv') canvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('overlay') overlay!: ElementRef<HTMLDivElement>;
  private ready = false;
  private ro?: ResizeObserver;
  private focusedLabel?: string | null = null;

  constructor(private renderer: Renderer2) {}

  ngAfterViewInit(): void {
    this.ready = true;
    try { this.ro = new ResizeObserver(() => this.paint()); this.ro.observe(this.canvas.nativeElement.parentElement as Element); } catch {}
    this.paint();
  }

  ngOnChanges(_: SimpleChanges): void { this.paint(); }
  ngOnDestroy(): void { this.ro?.disconnect(); }

  private colorForScore(v: number): string {
    const t = Math.max(0, Math.min(1, v));
    if (t <= 0.5) {
      const u = t/0.5;
      const r = Math.round(96 + u*(255-96));
      const g = Math.round(165 + u*(235-165));
      const b = Math.round(250 + u*(59-250));
      return `rgb(${r},${g},${b})`;
    } else {
      const u = (t-0.5)/0.5;
      const r = Math.round(255);
      const g = Math.round(235 - u*(235-99));
      const b = Math.round(59 - u*(59-71));
      return `rgb(${r},${g},${b})`;
    }
  }

  private paint() {
    if (!this.ready) return;
    const cnv = this.canvas.nativeElement;
    const rect = cnv.getBoundingClientRect();
    cnv.width = rect.width || 800;
    cnv.height = rect.height || 420;
    const ctx = cnv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, cnv.width, cnv.height);

    const ov = this.overlay?.nativeElement; if (ov) ov.innerHTML = '';
    const showHeader = (text: string) => {
      if (!ov) return;
      let header = ov.querySelector('.em-header') as HTMLDivElement | null;
      if (!header) {
        header = this.renderer.createElement('div');
        this.renderer.addClass(header, 'em-header');
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

    let rowLabels: string[] = [];
    let colLabels: string[] = [];
    let scores: number[][] = [];

    if (this.matrix && this.matrix.sources.length && this.matrix.facts.length) {
      rowLabels = this.matrix.sources.map(s => s.label);
      colLabels = this.matrix.facts.map(f => f.label);
      scores = this.matrix.scores;
    } else if (this.graphData) {
      const sources = this.graphData.nodes.filter(n => n.type === 'source');
      const facts = this.graphData.nodes.filter(n => n.type === 'fact');
      const has = new Set(this.graphData.edges.map(e => `${e.from}|${e.to}`));
      rowLabels = sources.map(s => s.label || s.id);
      colLabels = facts.map(f => f.label || f.id);
      scores = sources.map(s => facts.map(f => has.has(`${s.id}|${f.id}`) ? 1 : 0));
    } else {
      return;
    }

    const pad = 16;
    const rows = scores.length; const cols = rows? scores[0].length : 0;
    const cellW = Math.max(10, Math.floor((cnv.width - 2 * pad) / Math.max(1, cols)));
    const cellH = Math.max(10, Math.floor((cnv.height - 2 * pad) / Math.max(1, rows)));
    const gridW = cellW * Math.max(1, cols);
    const gridH = cellH * Math.max(1, rows);
    const marginX = Math.max(pad, Math.floor((cnv.width - gridW) / 2));
    const marginY = Math.max(pad, Math.floor((cnv.height - gridH) / 2));

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = marginX + c * cellW;
        const y = marginY + r * cellH;
        const v = scores[r][c] ?? 0;
        ctx.fillStyle = this.colorForScore(v);
        ctx.fillRect(x, y, cellW - 2, cellH - 2);
      }
    }

    const cnvEl = cnv;
    cnvEl.onmousemove = (evt) => {
      const rect = cnvEl.getBoundingClientRect();
      const mx = evt.clientX - rect.left;
      const my = evt.clientY - rect.top;
      const c = Math.floor((mx - marginX) / cellW);
      const r = Math.floor((my - marginY) / cellH);
      if (c >= 0 && c < cols && r >= 0 && r < rows) {
        const v = scores[r][c] ?? 0;
        const pct = Math.round(v*100);
        const row = rowLabels[r] || `Source ${r+1}`;
        const col = colLabels[c] || `Fact ${c+1}`;
        showHeader(`${row} • ${col} • ${pct}%`);
      } else {
        if (!this.focusedLabel) showHeader('');
      }
    };
  }
}
