/** Transient photograph readiness; canonical furniture and quote authority stay on the server. */
export interface PhotoConsultationStatus {
  referenceId: string | null;
  photoRevision: number;
  calibrated: boolean;
  imageReady: boolean;
  compositionRevision?: number;
  renderedReferenceId?: string;
  imageSha256?: string;
}
/** A catalogue choice awaiting the salesperson's explicit click on the photo. */
export interface PhotoPlacementRequest {
  requestId: string;
  variantId: string;
  sku: string;
}
