if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(err => console.error('SW registration failed:', err));
}

const $ = id => document.getElementById(id);

// One site, two roles: index.html = controller, index.html?gallery = the page being controlled.
const isGallery = new URLSearchParams(location.search).has('gallery');
$('controller').hidden = isGallery;
$('gallery').hidden = !isGallery;
if (isGallery) initGallery(); else initController();

// ---------------- Captured side (?gallery) ----------------
function initGallery() {
  document.title = 'Gallery - Hello Kennet';

  const config = {
    handle: crypto.randomUUID(),
    exposeOrigin: true,
    permittedOrigins: ['*'] // narrow to your own origin for production
  };
  if (navigator.mediaDevices?.setCaptureHandleConfig) {
    navigator.mediaDevices.setCaptureHandleConfig(config);
  }

  const slides = [...document.querySelectorAll('.slide')];
  let current = 0;
  const show = i => {
    current = (i + slides.length) % slides.length;
    slides.forEach((s, n) => s.classList.toggle('active', n === current));
  };

  const channel = new BroadcastChannel('capture-handle');
  channel.addEventListener('message', ({ data }) => {
    const { handle, command } = data;
    if (handle !== config.handle) return; // only accept commands meant for this page
    if (command === 'previous') show(current - 1);
    if (command === 'next') show(current + 1);
    $('status').textContent = `Last command: ${command}`;
  });
}

// ---------------- Capturing side (index.html) ----------------
function initController() {
  const openBtn = $('open-page-button');
  const shareBtn = $('share-screen-button');
  const stopBtn = $('stop-share-screen-button');
  const previousButton = $('previous-button');
  const nextButton = $('next-button');
  const enableScrollingButton = $('enable-scrolling-button');
  const zoomInButton = $('zoom-in-button');
  const zoomOutButton = $('zoom-out-button');
  const preview = $('preview');

  const hasScreenCapture = !!navigator.mediaDevices?.getDisplayMedia;
  const hasCaptureHandle = hasScreenCapture && 'getCaptureHandle' in MediaStreamTrack.prototype;
  const hasSurfaceControl = 'CaptureController' in window && 'sendWheel' in CaptureController.prototype;

  $('no-support-screencapture').hidden = hasScreenCapture;
  $('no-support-capture-handle').hidden = hasCaptureHandle;
  $('no-support-surface-control').hidden = hasSurfaceControl;
  shareBtn.disabled = !hasScreenCapture;

  const zoomLevels = hasSurfaceControl ? CaptureController.getSupportedZoomLevels() : [];
  const channel = new BroadcastChannel('capture-handle');

  let controller, stream, captureHandle;

  function updateControls() {
    const sharing = !!stream;
    shareBtn.hidden = sharing;
    stopBtn.hidden = !sharing;
    previousButton.disabled = !captureHandle;
    nextButton.disabled = !captureHandle;
    enableScrollingButton.disabled = !(sharing && controller);
    zoomInButton.disabled = !(sharing && controller);
    zoomOutButton.disabled = !(sharing && controller);
  }

  openBtn.addEventListener('click', () => {
    window.open('./?gallery', 'gallery', 'popup,width=900,height=700');
  });

  // getDisplayMedia() needs a user gesture, so it lives in the click handler.
  shareBtn.addEventListener('click', async () => {
    try {
      controller = undefined;
      if (hasSurfaceControl && 'setFocusBehavior' in CaptureController.prototype) {
        controller = new CaptureController();
        controller.setFocusBehavior('no-focus-change'); // before getDisplayMedia()
      }
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'browser' },
        audio: true,
        surfaceSwitching: 'exclude',
        selfBrowserSurface: 'exclude',
        preferCurrentTab: false,
        systemAudio: 'include',
        monitorTypeSurfaces: 'exclude',
        ...(controller && { controller })
      });
    } catch (err) {
      console.error('Screen share failed:', err.name, err.message);
      stream = undefined;
      updateControls();
      return;
    }

    preview.srcObject = stream;
    const [videoTrack] = stream.getVideoTracks();
    captureHandle = videoTrack.getCaptureHandle?.() ?? undefined;
    videoTrack.addEventListener('capturehandlechange', () => {
      captureHandle = videoTrack.getCaptureHandle() ?? undefined;
      updateControls();
    });
    videoTrack.addEventListener('ended', stopSharing); // browser's "Stop sharing" bar
    updateControls();
  });

  function stopSharing() {
    stream?.getTracks().forEach(t => t.stop());
    stream = controller = captureHandle = undefined;
    preview.srcObject = null;
    updateControls();
  }
  stopBtn.addEventListener('click', stopSharing);

  const sendCommand = command => {
    if (captureHandle) channel.postMessage({ handle: captureHandle.handle, command });
  };
  previousButton.addEventListener('click', () => sendCommand('previous'));
  nextButton.addEventListener('click', () => sendCommand('next'));

  enableScrollingButton.addEventListener('click', async () => {
    try { await controller.sendWheel({}); } catch (err) { console.log('enable scrolling error', err); }
  });

  async function changeZoom(step) {
    try {
      const i = zoomLevels.indexOf(controller.getZoomLevel());
      await controller.setZoomLevel(zoomLevels[Math.min(Math.max(i + step, 0), zoomLevels.length - 1)]);
    } catch (err) { console.log('zoom error', err); }
  }
  zoomInButton.addEventListener('click', () => changeZoom(+1));
  zoomOutButton.addEventListener('click', () => changeZoom(-1));

  preview.addEventListener('wheel', async e => {
    if (!controller || !stream) return;
    const box = preview.getBoundingClientRect();
    const { width, height } = stream.getVideoTracks()[0].getSettings();
    const x = Math.floor((width * e.offsetX) / box.width);
    const y = Math.floor((height * e.offsetY) / box.height);
    try {
      await controller.sendWheel({ x, y, wheelDeltaX: -e.deltaX, wheelDeltaY: -e.deltaY });
    } catch (err) { console.log(err); }
  });

  updateControls();
}
