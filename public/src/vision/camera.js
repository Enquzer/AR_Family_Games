/** Camera helpers with friendly error messages. */

export function cameraSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

export async function listCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'videoinput');
}

/**
 * Start a camera stream into a <video> element.
 * @returns {Promise<MediaStream>}
 */
export async function startCamera(video, { deviceId = null, width = 640, height = 360, facingMode = 'user' } = {}) {
  if (!cameraSupported()) {
    throw new Error(
      'Camera access is not available. Use Chrome/Edge on http://localhost, or serve the app over HTTPS.'
    );
  }
  stopCamera(video);
  const constraints = {
    audio: false,
    video: deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: width }, height: { ideal: height } }
      : {
          facingMode: { ideal: facingMode },
          width: { ideal: width, max: 960 },
          height: { ideal: height, max: 540 },
          frameRate: { ideal: 60, max: 60 },
        },
  };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    console.warn('[camera] First constraints attempt failed, trying fallback...', err);
    try {
      // Fallback 1: Flexible resolution without strict framerate
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          width: { ideal: width },
          height: { ideal: height },
        },
      });
    } catch (err2) {
      try {
        // Fallback 2: Any video input device without resolution constraints
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: true,
        });
      } catch (err3) {
        if (err3.name === 'NotAllowedError') {
          throw new Error('Camera permission blocked. Click "Allow" or click the camera button to enable.');
        }
        if (err3.name === 'NotFoundError' || err3.name === 'DevicesNotFoundError') {
          throw new Error('No camera found. Connect a webcam and reload.');
        }
        if (err3.name === 'NotReadableError') {
          throw new Error('Camera is in use by another app or tab (Zoom/Teams/browser tab). Please close it and reload.');
        }
        throw err3;
      }
    }
  }
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play().catch(() => {});
  if (!video.videoWidth) {
    await new Promise((resolve) => {
      const done = () => {
        video.removeEventListener('loadedmetadata', done);
        resolve();
      };
      video.addEventListener('loadedmetadata', done);
      setTimeout(done, 2500);
    });
  }
  return stream;
}

export function stopCamera(video) {
  const stream = video?.srcObject;
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  }
}
