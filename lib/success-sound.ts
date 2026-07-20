const dustySuccessSoundPath = "/sounds/dusty-success.mp3";

export function playDustySuccessSound() {
  if (typeof window === "undefined") return;

  try {
    const audio = new Audio(dustySuccessSoundPath);
    const playPromise = audio.play();

    if (playPromise) {
      playPromise.catch(() => {
        // Browser autoplay restrictions should never interrupt the seller flow.
      });
    }
  } catch {
    // Sound is celebratory only; publication and signup must continue silently.
  }
}
