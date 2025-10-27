import { Component, EventEmitter, Input, Output, OnChanges, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { marked } from 'marked';
import { HttpClient } from '@angular/common/http';

export interface PlainLine { text: string; heading: boolean }

@Component({
  selector: 'app-research-form',
  standalone: true,
  imports: [FormsModule, CommonModule],
  templateUrl: './research-form.component.html',
  styleUrl: './research-form.component.css',
})
export class ResearchFormComponent implements OnChanges {
  @Input() isLoading = false;
  @Input() answerMd: string = '';
  @Input() thoughts: string[] = [];
  @Input() progress: number = 0;

  @Output() startResearch = new EventEmitter<string>();

  query: string = '';
  plainLines: PlainLine[] = [];
  plainAnswerText: string = '';
  showThoughts = false;

  constructor(private http: HttpClient) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['answerMd']) {
      const { lines, text } = this.mdToPlainStructured(this.answerMd ?? '');
      this.plainLines = lines;
      this.plainAnswerText = text;
    }
    if (changes['isLoading'] && this.isLoading) {
      this.showThoughts = false;
    }
  }

  trackLine = (_: number, l: { text: string; heading: boolean }) => l.text + '|' + l.heading;

  onStartClick(): void {
    if (this.query.trim()) {
      this.startResearch.emit(this.query);
    }
  }

  private mdToPlainStructured(md: string): { lines: PlainLine[]; text: string } {
    if (!md) return { lines: [], text: '' };
    const html = marked.parse(md, { async: false }) as string;
    const root = document.createElement('div');
    root.innerHTML = html;

    const lines: PlainLine[] = [];

    const pushText = (txt: string, heading = false) => {
      const t = txt.replace(/\s+/g, ' ').trim();
      if (!t) return;
      if (heading) {
        const last = lines[lines.length - 1];
        if (last && last.text !== '') {
          lines.push({ text: '', heading: false });
        }
      }
      lines.push({ text: t, heading });
    };

    const walk = (node: Node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        const tag = el.tagName.toLowerCase();
        if (/^h[1-6]$/.test(tag)) { pushText(el.textContent || '', true); return; }
        if (tag === 'p' || tag === 'div' || tag === 'section' || tag === 'article' || tag === 'pre') { pushText(el.textContent || '', false); return; }
        if (tag === 'li') { pushText('- ' + (el.textContent || ''), false); return; }
        if (tag === 'ul' || tag === 'ol') { el.childNodes.forEach(walk); return; }
        el.childNodes.forEach(walk); return;
      }
      if (node.nodeType === Node.TEXT_NODE) { pushText(node.textContent || '', false); }
    };

    root.childNodes.forEach(walk);

    const text = lines.map(l => l.text).join('\n');
    return { lines, text };
  }

  downloadMarkdown(): void {
    if (!this.answerMd) return;
    const blob = new Blob([this.answerMd], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'research-report.md';
    a.click();
    URL.revokeObjectURL(url);
  }

  async downloadPdf(): Promise<void> {
    if (!this.answerMd) return;

    try {
      const blob = await this.http.post('http://localhost:8080/api/export/pdf', { markdown: this.answerMd, filename: 'research-report' }, { responseType: 'blob' as const }).toPromise();
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'research-report.pdf';
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
    } catch (e) {

    }

    const { jsPDF } = await import('jspdf').then((m: any) => m);
    const pdf = new jsPDF('p', 'pt', 'a4');

    const margin = 32;
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const usableWidth = pageWidth - margin * 2;
    const lineHeight = 16;

    const wrapped = pdf.splitTextToSize(this.plainAnswerText, usableWidth) as string[];

    let y = margin;
    wrapped.forEach((line) => {
      if (y + lineHeight > pageHeight - margin) {
        pdf.addPage();
        y = margin;
      }
      pdf.text(line, margin, y);
      y += lineHeight;
    });

    pdf.save('research-report.pdf');
  }

  get statusHint(): string {
    if (!this.isLoading) return '';
    if (this.progress >= 95) return 'Creating final report';
    const hints = [
      'Diving deep into the topic',
      'Analyzing multiple sources',
      'Cross-checking claims',
      'Extracting relevant facts',
      'Synthesizing insights'
    ];
    const idx = Math.min(hints.length - 1, Math.floor(this.progress / (100 / hints.length)));
    return hints[idx] || hints[0];
  }

  protected readonly Math = Math;
}
