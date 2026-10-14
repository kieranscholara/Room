'use client';
import { WorkspaceFrame } from './workspace-frame';
import { CataloguePanel } from './catalogue-panel';
import { CustomerPanel } from './customer-panel';
import { ProjectsPanel } from './projects-panel';
import { PricingPanel } from './pricing-panel';
import { InventoryPanel } from './inventory-panel';
import './workspace-business.css';

export function WorkspaceApp() {
  return (
    <WorkspaceFrame
      panels={[
        {
          id: 'pricing',
          label: 'Pricing',
          roles: ['owner', 'admin'],
          render: (context) => <PricingPanel context={context} />,
        },
        {
          id: 'inventory',
          label: 'Inventory',
          roles: ['owner', 'admin'],
          render: (context) => <InventoryPanel context={context} />,
        },
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
