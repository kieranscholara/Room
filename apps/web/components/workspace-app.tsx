'use client';
import { WorkspaceFrame } from './workspace-frame';
import { CataloguePanel } from './catalogue-panel';
import { CustomerPanel } from './customer-panel';
import { ProjectsPanel } from './projects-panel';
import './workspace-business.css';

export function WorkspaceApp() {
  return (
    <WorkspaceFrame
      panels={[
        { id: 'projects', label: 'Projects', render: (context) => <ProjectsPanel context={context} /> },
        {
          id: 'catalogue',
          label: 'Catalogue',
          roles: ['owner', 'admin', 'salesperson', 'designer'],
          render: (context) => <CataloguePanel context={context} />,
        },
        {
          id: 'customers',
          label: 'Customers',
          roles: ['owner', 'admin', 'salesperson', 'designer'],
          render: (context) => <CustomerPanel context={context} />,
        },
      ]}
    />
  );
}
