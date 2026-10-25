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
    if (err.name === 'NotAllowedError') {
      throw new Error('Camera permission was blocked. Click the camera icon in the address bar and allow access.');
    }
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      throw new Error('No camera found. Connect a webcam and reload.');
    }
    if (err.name === 'NotReadableError') {
      throw new Error('The camera is busy in another app (Zoom/Teams?). Close it and try again.');
    }
    if (err.name === 'OverconstrainedError' || err.name === 'ConstraintNotSatisfiedError') {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { deviceId: deviceId ? { exact: deviceId } : undefined, frameRate: { ideal: 30 } } });
    } else {
      throw err;
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
