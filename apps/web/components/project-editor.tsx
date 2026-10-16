'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Button, Field } from '@roomsell/ui';
import { Editor } from './editor';
import { ProjectAssistant } from './project-assistant';
import { ProjectOrders } from './project-orders';
import { PhotoConsultationHeader, PhotoDesignReview } from './photo-consultation';
import type { PhotoConsultationStatus, PhotoPlacementRequest } from '../lib/photo-consultation-status';
import { AccountRequestError, accountRequest, type OrganisationRole } from './workspace-frame';
import type { ProjectRecord } from './workspace-business-types';
import './workspace-business.css';

interface ProjectDetails extends ProjectRecord {
  canEdit: boolean;
  role: OrganisationRole;
}
interface CustomerMember {
  userId: string;
  email: string;
  role: OrganisationRole;
}
interface Access {
  userId: string;
  canEdit: boolean;
  canOrder: boolean;
}
export function ProjectEditor({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [project, setProject] = useState<ProjectDetails | null>(null);
  const [error, setError] = useState('');
  const [photoRefreshKey, setPhotoRefreshKey] = useState(0);
  const [assistantPhotoPending, setAssistantPhotoPending] = useState(false);
  const [placementRequest, setPlacementRequest] = useState<PhotoPlacementRequest>();
  const chooseProduct = useCallback((variantId: string, sku: string) => {
    setPlacementRequest({ requestId: crypto.randomUUID(), variantId, sku });
    document.getElementById('consultation-room')?.scrollIntoView({ behavior: 'smooth' });
  }, []);
  const [photoStatus, setPhotoStatus] = useState<PhotoConsultationStatus>({
    referenceId: null,
    photoRevision: 0,
    calibrated: false,
    imageReady: false,
  });
  const refreshPhoto = useCallback(() => {
    setPhotoStatus((status) => ({ ...status, imageReady: false }));
    setPhotoRefreshKey((key) => key + 1);
  }, []);
  const reviewPhotoStatus = assistantPhotoPending ? { ...photoStatus, imageReady: false } : photoStatus;
  const load = useCallback(async () => {
    setError('');
    try {
      setProject(await accountRequest<ProjectDetails>(`/api/projects/${projectId}`));
    } catch (reason) {
      if (reason instanceof AccountRequestError && reason.status === 401)
        router.replace(`/auth/login?next=${encodeURIComponent(`/projects/${projectId}`)}`);
      else setError(reason instanceof Error ? reason.message : 'Could not open your project.');
    }
  }, [projectId, router]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!project || project.id !== projectId)
    return (
      <main className="account-loading">
        {error ? (
          <div role="alert">
            <p>{error}</p>
            <Button onClick={() => void load()}>Retry project</Button>
            <Link className="business-text-link" href="/workspace?panel=projects">
              Back to projects
            </Link>
          </div>
        ) : (
          <p role="status">Opening project…</p>
        )}
      </main>
    );
  return (
    <div className="project-business-page">
      <PhotoConsultationHeader />
      <div id="consultation-room">
        <Editor
          projectId={projectId}
          title={project.name}
          subtitle={`${project.roomType.replace('_', ' ')}${project.style ? ` · ${project.style}` : ''}`}
          readOnly={!project.canEdit}
          photoOnly
          onPhotoStatusChange={setPhotoStatus}
          photoRefreshKey={photoRefreshKey}
          placementRequest={placementRequest}
        />
      </div>
      <div className="project-business-tools">
        <ProjectAssistant
          key={`assistant-${projectId}`}
          projectId={projectId}
          canEdit={project.canEdit}
          staff={project.role !== 'customer'}
          photoContext={photoStatus}
          onPhotoAdviceApplied={refreshPhoto}
          onPhotoPendingChange={setAssistantPhotoPending}
          onChooseProduct={chooseProduct}
        />
        <PhotoDesignReview key={`review-${projectId}`} project={project} photoStatus={reviewPhotoStatus} />
        <details className="photo-consultation-details">
          <summary>Orders and customer access</summary>
          <div>
            <ProjectOrders key={`orders-${projectId}`} projectId={projectId} />
            {['owner', 'admin'].includes(project.role) && <ProjectAccess project={project} />}
          </div>
        </details>
        <Link
          className="business-text-link"
          href={`/workspace?organisation=${project.organisationId}&panel=projects`}
        >
          Back to organisation projects
        </Link>
      </div>
    </div>
  );
}
function ProjectAccess({ project }: { project: ProjectDetails }) {
  const [members, setMembers] = useState<CustomerMember[]>([]);
  const [access, setAccess] = useState<Access[]>([]);
  const [userId, setUserId] = useState('');
  const [canEdit, setCanEdit] = useState(false);
  const [canOrder, setCanOrder] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    try {
      const [people, grants] = await Promise.all([
        accountRequest<CustomerMember[]>(`/api/organisations/${project.organisationId}/members`),
        accountRequest<Access[]>(`/api/projects/${project.id}/access`),
      ]);
      setMembers(people.filter((person) => person.role === 'customer'));
      setAccess(grants);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load project access.');
    }
  }, [project.organisationId, project.id]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="account-panel" aria-label="Project customer access">
      <div>
        <h2>Customer access</h2>
        <p className="account-muted">
          Share only this project with a customer who has joined your organisation. Staff access follows their
          team role.
        </p>
      </div>
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="account-notice" role="status">
          {message}
        </p>
      )}
      <form
        className="business-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!userId) return;
          setBusy(true);
          setError('');
          try {
            await accountRequest(`/api/projects/${project.id}/access`, {
              method: 'POST',
              body: { userId, canEdit, canOrder },
            });
            setMessage('Project access saved.');
            await load();
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Could not grant access.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Customer account">
          <select
            aria-label="Customer account"
            required
            value={userId}
            disabled={busy}
            onChange={(event) => {
              const id = event.target.value;
              setUserId(id);
              setCanEdit(access.find((grant) => grant.userId === id)?.canEdit || false);
            }}
          >
            <option value="">Choose a joined customer</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.email}
              </option>
            ))}
          </select>
        </Field>
        <label className="business-checkbox">
          <input
            type="checkbox"
            checked={canEdit}
            disabled={busy}
            onChange={(event) => setCanEdit(event.target.checked)}
          />
          Allow this customer to edit their design
        </label>
        <label>
          <input
            type="checkbox"
            aria-label="Allow this customer to place orders"
            checked={canOrder}
            onChange={(event) => setCanOrder(event.target.checked)}
            disabled={busy}
          />{' '}
          Allow this customer to place orders
        </label>
        <Button variant="primary" type="submit" disabled={busy || !userId}>
          Save customer access
        </Button>
      </form>
      <div className="business-card-list">
        {access.map((grant) => (
          <div className="business-record" key={grant.userId}>
            <p>
              {members.find((member) => member.userId === grant.userId)?.email || 'Customer account'} ·{' '}
              {grant.canEdit ? 'Can edit' : 'View only'}
            </p>
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await accountRequest(`/api/projects/${project.id}/access?userId=${grant.userId}`, {
                    method: 'DELETE',
                  });
                  setMessage('Customer access removed.');
                  await load();
                } catch (reason) {
                  setError(reason instanceof Error ? reason.message : 'Could not remove access.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Remove customer access
            </Button>
          </div>
        ))}
      </div>
      {!members.length && (
        <Link
          className="business-text-link"
          href={`/workspace?organisation=${project.organisationId}&panel=team`}
        >
          Invite a customer from Team before sharing this project
        </Link>
      )}
    </section>
  );
}
