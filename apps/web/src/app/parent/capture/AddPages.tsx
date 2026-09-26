'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { parentCopy } from '@/copy/parent';
import { ACCEPTED_IMAGE_TYPES, splitSelection } from '@/lib/library-selection';
import { density } from '@/theme/tokens';
import { CameraViewfinder } from './CameraViewfinder';
import { controlSx } from './PageStrip';

/**
 * Where the camera stands for this screen.
 *
 * `unknown` is "not asked yet" and is distinct from both failures: it must not
 * render guidance about a refusal that has not happened. `denied` is the pair of
 * rejections whose remedy is site settings — `NotAllowedError`, which the
 * permission prompt raises, and `SecurityError`, which a blocked origin raises —
 * and `unavailable` is everything else, including the API simply not being there
 * on a non-secure origin and a track ending mid-session.
 */
export type CameraStatus = 'unknown' | 'ready' | 'denied' | 'unavailable';

/** What the captured frame is encoded as. The same format ingest stores. */
const CAPTURE_MIME = 'image/jpeg';
/** Matches ingest's re-encode, so the wire carries no more than it must. */
const CAPTURE_QUALITY = 0.85;

/**
 * The frame size asked of the camera.
 *
 * Without a hint a browser hands back whatever its default is — commonly
 * 640×480, which is a quarter of the detail a library photo of the same page
 * carries. These pages are read by a vision model, so the resolution is the
 * difference between a question that extracts and one that does not, and a
 * capture path that quietly produced worse pages than the picker beside it would
 * be the story's own trap.
 *
 * `ideal` rather than `min` on purpose: a device that cannot reach this must
 * still open the camera rather than refuse it.
 */
const CAPTURE_IDEAL_WIDTH = 1920;
const CAPTURE_IDEAL_HEIGHT = 1440;

export interface AddPagesProps {
  /** The pages the server says the upload holds, and the ceiling it states. */
  pageCount: number;
  maxPages: number;
  /** Whether page management is offered at all — false for a submitted upload. */
  editable: boolean;
  /** A write is in flight; every control here locks with the strip. */
  busy: boolean;
  /**
   * Hands the screen an ordered array. One call per parent action, whether that
   * action was one shutter press or a nine-photo multi-select: the screen's
   * `write` drops a second call while one is pending, so a per-file loop here
   * would silently lose pages.
   *
   * `rejectedCount` rides along rather than being announced here, because the
   * screen has one polite region and a second message into it would overwrite the
   * first: the parent would hear that pages were added and never that some were
   * not. The screen says both in one sentence once the server has answered.
   */
  onAdd(files: readonly File[], rejectedCount: number): void;
  /** Says something in the screen's one polite region. */
  onAnnounce(message: string): void;
}

/**
 * The whole of adding pages: the camera, the photo library, and the guidance
 * when the camera cannot be used.
 *
 * It owns the stream and nothing else. Every figure it shows — the count, the
 * ceiling — arrives as a prop from the server's answer, and every string comes
 * from the copy module. The two controls are one affordance from the parent's
 * side: a page added by either is just the next page, and nothing here records
 * or surfaces which one added it.
 */
export function AddPages({
  pageCount,
  maxPages,
  editable,
  busy,
  onAdd,
  onAnnounce,
}: AddPagesProps) {
  const camera = parentCopy.capture.camera;
  const [status, setStatus] = useState<CameraStatus>('unknown');
  const [open, setOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  /**
   * The live stream, in a ref rather than state: stopping it is a cleanup, and
   * a cleanup that read it out of a render's closure could stop a stream that
   * had already been replaced — or miss the one that had.
   */
  const streamRef = useRef<MediaStream | null>(null);
  /**
   * Whether this component is still mounted, and which open request is still
   * wanted.
   *
   * `getUserMedia` resolves on its own schedule — after a permission prompt, so
   * possibly many seconds later. By then the parent may have pressed Done or left
   * the screen entirely, and cleanup will already have run. Storing the stream at
   * that point would leave the camera light on with nothing rendering it, which
   * is the one thing the media-track criterion forbids. The counter distinguishes
   * "a later open superseded this one" from "nothing wants a camera any more".
   */
  const mountedRef = useRef(true);
  const openRequestRef = useRef(0);
  /**
   * Whether a frame is already on its way to the screen.
   *
   * `canvas.toBlob` is asynchronous, so `busy` is still false when a second
   * shutter press arrives and the control is still enabled. Two `onAdd` calls
   * would then reach one `write`, which drops the second silently — the parent
   * would press twice and get one page with no sign the other was lost.
   */
  const capturingRef = useRef(false);
  /**
   * Whether an open is already awaiting `getUserMedia`.
   *
   * The `streamRef.current !== null` guard alone only blocks a *second* open
   * once the first has resolved — two clicks before the permission prompt
   * settles both pass it, since neither has stored a stream yet, and both would
   * call `getUserMedia`. This ref closes that window.
   */
  const openingRef = useRef(false);

  /** The cap, mirrored from the API's figure. The server refuses either way. */
  const full = pageCount >= maxPages;
  const addable = editable && !full;

  /**
   * Stops every track this screen obtained, detaches the element, and forgets
   * the stream. Idempotent, because it is called from the close control, from
   * unmount, from a track ending and from the failure path of a re-open.
   *
   * This is the criterion about media tracks, in one place: nothing else in this
   * tree holds a `MediaStream`, so there is nowhere else a track can survive.
   */
  const stopStream = useCallback(() => {
    const stream = streamRef.current;
    streamRef.current = null;
    if (videoRef.current !== null) videoRef.current.srcObject = null;
    if (stream === null) return;
    for (const track of stream.getTracks()) track.stop();
  }, []);

  /**
   * A track ending underneath us: the permission revoked from the address bar,
   * the webcam unplugged, another app preempting the device on iOS.
   *
   * The viewfinder would otherwise sit there frozen on its last frame, with a
   * shutter that still worked and posted that stale frame — or a blank one — as
   * a page. So the surface closes and the guidance appears, exactly as it would
   * have if the camera had never opened.
   */
  const handleTrackEnded = useCallback(() => {
    stopStream();
    setOpen(false);
    setStatus('unavailable');
  }, [stopStream]);

  // Unmount — the parent leaving the screen, or Parent View ending and tearing
  // this tree down — stops the tracks exactly as closing the viewfinder does,
  // and tells any `getUserMedia` still in flight that nothing wants its stream.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopStream();
    };
  }, [stopStream]);

  /**
   * Attaches whatever stream is held to whatever `<video>` is mounted.
   *
   * The element does not exist while the viewfinder is closed, so the stream
   * cannot be attached at the moment `getUserMedia` resolves; this runs on the
   * render that first mounts it. Re-running is harmless — assigning the same
   * `srcObject` twice is a no-op.
   */
  useEffect(() => {
    if (!open) return;
    const video = videoRef.current;
    if (video === null || streamRef.current === null) return;
    video.srcObject = streamRef.current;
  }, [open]);

  /**
   * Opens the camera, or explains why it cannot open.
   *
   * The API being absent is checked before it is called: a non-secure origin has
   * no `mediaDevices` at all, and reading through it would throw rather than
   * produce the guidance that case is owed.
   */
  const openCamera = useCallback(async () => {
    // A stream is already held, or an open is already awaiting the permission
    // prompt: re-entering either would orphan a stream this ref can no longer
    // reach, or fire a second `getUserMedia` call before the first has answered.
    if (streamRef.current !== null || openingRef.current) return;
    const devices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    if (devices === undefined || typeof devices.getUserMedia !== 'function') {
      setStatus('unavailable');
      setOpen(false);
      return;
    }
    openingRef.current = true;
    const request = openRequestRef.current + 1;
    openRequestRef.current = request;
    try {
      const stream = await devices.getUserMedia({
        video: {
          // The rear camera where there is a choice — a page on a desk is in
          // front of the device, not behind it. A hint, not a requirement: a
          // laptop with one camera must still open.
          facingMode: { ideal: 'environment' },
          // Enough detail for the vision model to read the page.
          width: { ideal: CAPTURE_IDEAL_WIDTH },
          height: { ideal: CAPTURE_IDEAL_HEIGHT },
        },
        audio: false,
      });
      // Unmounted, or superseded by a close or a later open, while the prompt was
      // up. The stream is stopped here rather than stored: `stopStream` cannot
      // reach a stream that was never in the ref.
      if (!mountedRef.current || openRequestRef.current !== request) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      streamRef.current = stream;
      // Losing the device mid-session is a failure like any other, and it can
      // arrive at any moment after this point.
      for (const track of stream.getTracks()) {
        track.addEventListener('ended', handleTrackEnded);
      }
      if (videoRef.current !== null) videoRef.current.srcObject = stream;
      setStatus('ready');
      setOpen(true);
    } catch (cause) {
      // A refusal has a remedy and is named as such; everything else is simply
      // unavailable. Either way the viewfinder closes and the library stays.
      stopStream();
      setOpen(false);
      setStatus(
        cause instanceof Error &&
          (cause.name === 'NotAllowedError' || cause.name === 'SecurityError')
          ? 'denied'
          : 'unavailable',
      );
    } finally {
      openingRef.current = false;
    }
  }, [stopStream, handleTrackEnded]);

  /** Closing keeps every page already captured; only the stream goes. */
  const closeCamera = useCallback(() => {
    // Discards any open still in flight, so a stream that arrives after this
    // point is stopped rather than stored.
    openRequestRef.current += 1;
    setOpen(false);
    stopStream();
  }, [stopStream]);

  /**
   * One frame, as one file, as one page.
   *
   * The viewfinder deliberately stays open: continuous capture is the story's
   * point, and a surface that closed after every page would make a ten-page
   * test ten trips through the permission-shaped flow.
   */
  const capture = useCallback(() => {
    // One frame at a time. Cleared on every path out of the callback below, so a
    // frame that never becomes a file does not lock the shutter for good.
    if (capturingRef.current) return;
    const video = videoRef.current;
    if (video === null) return;
    const width = video.videoWidth;
    const height = video.videoHeight;
    // No frame yet: the stream has been attached but has not produced one. There
    // is nothing to post, and a zero-sized canvas would post a blank page.
    if (width === 0 || height === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context === null) return;
    context.drawImage(video, 0, 0, width, height);
    capturingRef.current = true;
    canvas.toBlob(
      (blob) => {
        capturingRef.current = false;
        if (blob === null) return;
        onAdd([new File([blob], 'page.jpg', { type: CAPTURE_MIME })], 0);
      },
      CAPTURE_MIME,
      CAPTURE_QUALITY,
    );
  }, [onAdd]);

  /**
   * A multi-select, as one parent action.
   *
   * The selection is trimmed against the slots that are left by the pure rule.
   * The trim is stated out loud — told only what was added, a parent with nine
   * pages who picked three photos would have to count the strip to find out what
   * happened — but it is stated *by the screen*, in the same sentence as the
   * count that landed, because there is one polite region and the second message
   * into it replaces the first.
   */
  function chooseFromLibrary(chosen: readonly File[]): void {
    const { accepted, rejectedCount } = splitSelection(chosen, pageCount, maxPages);
    // Nothing fits: nothing is posted, so no answer is coming from the server and
    // this is the only chance to say anything at all.
    if (accepted.length === 0) {
      if (rejectedCount > 0) onAnnounce(parentCopy.capture.rejectedCount(rejectedCount));
      return;
    }
    onAdd(accepted, rejectedCount);
  }

  return (
    <Box sx={{ display: 'grid', gap: `${density.gap}px` }}>
      {open && status === 'ready' && (
        <CameraViewfinder
          videoRef={videoRef}
          pageCount={pageCount}
          maxPages={maxPages}
          busy={busy}
          onCapture={capture}
          onClose={closeCamera}
        />
      )}

      <Box
        sx={{ display: 'flex', alignItems: 'center', gap: `${density.gap}px`, flexWrap: 'wrap' }}
      >
        {!open && (
          <Button
            type="button"
            variant="outlined"
            disabled={busy || !addable}
            onClick={() => void openCamera()}
            data-testid="use-camera"
            sx={controlSx}
          >
            {camera.useCamera}
          </Button>
        )}

        {/*
          The library, beside the camera and never behind it: it is the fallback
          when the camera cannot be used, and it is also the faster path for a
          test that was already photographed.

          The visible `<label>` is the input's accessible name, through `htmlFor`.
          An `aria-label` carrying the same words would override it with a second
          copy of itself and be announced twice.
        */}
        <Typography component="label" htmlFor="capture-add-page">
          {camera.libraryLabel}
        </Typography>
        <Box
          component="input"
          id="capture-add-page"
          type="file"
          multiple
          accept={ACCEPTED_IMAGE_TYPES}
          disabled={busy || !addable}
          sx={controlSx}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            const chosen = Array.from(event.target.files ?? []);
            // Cleared before anything is posted, so re-picking the same photo
            // fires a change event again.
            event.target.value = '';
            if (chosen.length > 0) chooseFromLibrary(chosen);
          }}
        />
      </Box>

      <CameraGuidance status={status} />
    </Box>
  );
}

/**
 * What each camera status says, as a component with no hooks in it.
 *
 * Split out for the reason everything else on this screen is: `apps/web` runs
 * its tests without a DOM, so guidance reachable only by driving `getUserMedia`
 * to reject is guidance no test can state. Rendered from a status rather than
 * from a caught error, so the mapping from failure to sentence lives in
 * `openCamera` alone.
 *
 * `unknown` and `ready` say nothing, because nothing has gone wrong: guidance
 * about a refusal that has not happened is noise. Neither failure is a dead end
 * — each names its own remedy and both say the library is still there.
 */
export function CameraGuidance({ status }: { status: CameraStatus }) {
  const camera = parentCopy.capture.camera;
  if (status === 'unavailable') {
    return (
      <Typography component="p" data-testid="camera-unavailable">
        {camera.cameraUnavailable} {camera.cameraFallback}
      </Typography>
    );
  }
  if (status === 'denied') {
    return (
      <Typography component="p" data-testid="camera-denied">
        {camera.cameraDenied} {camera.cameraFallback}
      </Typography>
    );
  }
  return null;
}
