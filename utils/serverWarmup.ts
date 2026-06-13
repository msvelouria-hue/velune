let lastWarmupTime = 0;
const DEBOUNCE_MS = 60000;

export const warmupBackgroundRemovalServer = async (): Promise<void> => {
  const now = Date.now();

  if (now - lastWarmupTime < DEBOUNCE_MS) {
    return;
  }

  lastWarmupTime = now;

  try {
    fetch('https://rembg.vuxo.com/rembg-status', {
      method: 'GET',
    }).catch(() => {});
  } catch {
  }
};
