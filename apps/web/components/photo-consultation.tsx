'use client';

import { useEffect, useState } from 'react';
import { Button } from '@roomsell/ui';
import type { SelectedProjectProducts } from '@roomsell/catalogue';
import type { PhotoConsultationStatus } from '../lib/photo-consultation-status';
import { useEditor } from '../lib/editor-store';
import { accountRequest, type OrganisationRole } from './workspace-frame';
import { ProjectQuotations } from './project-quotations';
import { formatMoney, type ProjectRecord } from './workspace-business-types';
import './photo-consultation.css';

interface ConsultationProject extends ProjectRecord {
  canEdit: boolean;
  role: OrganisationRole;
}

export function PhotoConsultationHeader() {
  return (
    <section className="photo-consultation-intro" aria-label="Sales consultation steps">
      <div>
        <p className="photo-consultation-eyebrow">CLIENT ROOM CONSULTATION</p>
        <h2>See the furniture in your client’s room</h2>
        <p>
          Work together from the room photograph. Review what to keep, choose store furniture, and confirm the
          positions before preparing a quotation.
        </p>
      </div>
      <nav aria-label="Room consultation">
        <ol>
          <li>
            <a href="#consultation-room">
              <span>1</span>Upload, scan and measure
            </a>
          </li>
          <li>
            <a href="#project-design-assistant">
              <span>2</span>Complete the room
            </a>
          </li>
          <li>
            <a href="#consultation-room">
              <span>3</span>Choose and position furniture
            </a>
          </li>
          <li>
            <a href="#consultation-confirmation">
              <span>4</span>Confirm and quote
            </a>
          </li>
        </ol>
      </nav>
    </section>
  );
}

/** Confirmation records a review of this photo and saved scene in this consultation. */
export function PhotoDesignReview({
  project,
  photoStatus,
}: {
  project: ConsultationProject;
  photoStatus: PhotoConsultationStatus;
}) {
  const { scene, endpoint, proposal, busy, select } = useEditor();
  const current = endpoint === `/api/projects/${project.id}/scene` ? scene : null;
  const sceneKey = current ? `${current.id}:${current.version}` : '';
  const [products, setProducts] = useState<{ key: string; value: SelectedProjectProducts } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState('');
  const [agreementKey, setAgreementKey] = useState<string | null>(null);
  const [confirmedKey, setConfirmedKey] = useState<string | null>(null);
  const staff = project.role !== 'customer';
  const selected = products?.key === sceneKey ? products.value : null;

  useEffect(() => {
    if (!sceneKey) return;
    const controller = new AbortController();
    setError('');
    void accountRequest<SelectedProjectProducts>(`/api/projects/${project.id}/products`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setProducts({ key: sceneKey, value });
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : 'Could not review the chosen furniture.');
      });
    return () => controller.abort();
  }, [project.id, sceneKey, refresh]);

  const reviewKey = JSON.stringify([
    sceneKey,
    photoStatus.referenceId,
    photoStatus.photoRevision,
    selected?.items.map((item) => [item.objectId, item.sku, item.priceMinor, item.available, item.stale]),
  ]);
  const hasPreview = Boolean(proposal);
  useEffect(() => {
    setAgreementKey(null);
    setConfirmedKey(null);
  }, [reviewKey, hasPreview, photoStatus.calibrated, photoStatus.imageReady]);

  const ready = Boolean(
    staff &&
    project.canEdit &&
    current?.room.measurementsConfirmed &&
    current.objects.length > 0 &&
    photoStatus.referenceId &&
    photoStatus.calibrated &&
    photoStatus.imageReady &&
    selected &&
    selected.items.length === current.objects.length &&
    selected.totalMinor !== null &&
    !selected.stale &&
    selected.items.every((item) => item.available) &&
    !hasPreview &&
    !busy &&
    !error,
  );
  const confirmed = ready && confirmedKey === reviewKey && agreementKey === reviewKey;

  return (
    <>
      <section
        id="consultation-confirmation"
        className="account-panel photo-design-review"
        aria-label="Confirm furniture and positions"
        data-testid="photo-design-review"
        data-confirmed={confirmed ? 'true' : 'false'}
      >
        <div>
          <p className="photo-consultation-eyebrow">CONFIRM THE CLIENT’S CHOICES</p>
          <h2>Products and budget</h2>
          <p className="account-muted">
            Review the furniture saved in the photograph, then confirm the choices and positions with your
            client. Quotations use these accepted products and current retailer prices.
          </p>
        </div>
        {error && (
          <p className="account-error" role="alert">
            {error}
          </p>
        )}
        <Button
          disabled={busy}
          onClick={() => {
            setProducts(null);
            setAgreementKey(null);
            setConfirmedKey(null);
            setRefresh((value) => value + 1);
          }}
        >
          Refresh product prices and assets
        </Button>
        {!selected && !error && <p role="status">Loading the saved furniture choices…</p>}
        {selected && (
          <>
            <div className="business-budget" aria-label="Project budget totals">
              <div>
                <span>Catalogue subtotal</span>
                <strong>
                  {selected.totalMinor === null
                    ? 'Requires catalogue review'
                    : formatMoney(selected.totalMinor, selected.currency)}
                </strong>
              </div>
              <div>
                <span>Project budget</span>
                <strong>{formatMoney(selected.budgetMinor, selected.currency)}</strong>
              </div>
              {selected.totalMinor !== null && (
                <div>
                  <span>{selected.overBudget ? 'Over budget' : 'Budget remaining'}</span>
                  <strong>
                    {formatMoney(Math.abs(selected.budgetMinor - selected.totalMinor), selected.currency)}
                  </strong>
                </div>
              )}
            </div>
            <p className="account-muted">
              The subtotal covers furniture. Review taxes, delivery and installation in the quotation below.
            </p>
            {selected.stale && (
              <p className="account-error" role="status">
                Some saved products differ from the current catalogue. Review their SKU, measurements and
                availability before confirming this design.
              </p>
            )}
            {selected.overBudget && (
              <p className="business-warning">The chosen furniture exceeds the saved project budget.</p>
            )}
            <div className="business-card-list">
              {selected.items.map((item) => {
                const image = item.assets.find((asset) => asset.kind === 'image' && asset.url);
                const object = current?.objects.find((candidate) => candidate.id === item.objectId);
                return (
                  <article className="business-record photo-review-product" key={item.objectId}>
                    {image?.url && (
                      <img className="business-item-image" alt={item.name} src={image.url} loading="lazy" />
                    )}
                    <div>
                      <h3>{item.name}</h3>
                      <p className="account-muted">
                        {item.sku}
                        {item.variantName && item.variantName !== item.name ? ` · ${item.variantName}` : ''}
                      </p>
                      {object && (
                        <p className="account-muted">
                          {object.dimensions.width} × {object.dimensions.depth} × {object.dimensions.height} m
                        </p>
                      )}
                      <p>
                        {item.priceMinor === null
                          ? 'Price unavailable'
                          : formatMoney(item.priceMinor, item.currency)}
                      </p>
                      {item.stale && <p className="business-warning">Catalogue details changed</p>}
                      {!item.available && <p className="business-warning">Unavailable for new placement</p>}
                    </div>
                    <Button
                      onClick={() => {
                        select(item.objectId);
                        document.getElementById('consultation-room')?.scrollIntoView({ behavior: 'smooth' });
                      }}
                    >
                      Review {item.name} in photograph
                    </Button>
                  </article>
                );
              })}
              {!selected.items.length && (
                <p className="account-empty">
                  Choose furniture from Store inventory in the photograph, position it, then accept the
                  preview to add it to this design.
                </p>
              )}
            </div>
          </>
        )}
        {staff && project.canEdit && (
          <div className="photo-confirmation-actions">
            {!photoStatus.calibrated && (
              <p className="account-muted">
                Upload the room photograph and save its measured floor calibration before confirming.
              </p>
            )}
            {current && !current.room.measurementsConfirmed && (
              <p className="account-muted">Confirm the room’s measured width, depth and height first.</p>
            )}
            {hasPreview && (
              <p className="account-notice">
                Accept or discard the open furniture preview before confirming the design.
              </p>
            )}
            <label className="business-checkbox">
              <input
                type="checkbox"
                checked={agreementKey === reviewKey}
                disabled={!ready || confirmed}
                onChange={(event) => {
                  setAgreementKey(event.target.checked ? reviewKey : null);
                  setConfirmedKey(null);
                }}
              />
              The client has reviewed these furniture choices and positions.
            </label>
            <Button
              variant="primary"
              disabled={!ready || agreementKey !== reviewKey || confirmed}
              onClick={() => {
                if (!ready || agreementKey !== reviewKey) return;
                setConfirmedKey(reviewKey);
                document.getElementById('consultation-quotation')?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              Confirm design for quotation
            </Button>
            {confirmed && (
              <p className="account-notice" role="status">
                Design confirmed for this consultation. Review the quotation below.
              </p>
            )}
            <p className="account-muted">
              Changing the furniture, photograph or photo selections requires another confirmation.
            </p>
          </div>
        )}
      </section>
      <div id="consultation-quotation" className="photo-consultation-quotation">
        <ProjectQuotations
          projectId={project.id}
          organisationId={project.organisationId}
          role={project.role}
          canPrepareQuote={confirmed}
        />
      </div>
    </>
  );
}
