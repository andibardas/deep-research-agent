import { Routes } from '@angular/router';
import { ResearchDashboardComponent } from './features/research/pages/research-dashboard/research-dashboard.component';

export const routes: Routes = [
  {
    path: '',
    component: ResearchDashboardComponent,
  },
  { path: '**', redirectTo: '' },
];
