import React, { useEffect, useRef } from 'react';

type StarSpec = {
  left: string;
  top: string;
  size: number;
  opacity: number;
  duration: string;
  twinkle: string;
  delay: string;
  driftX: string;
  driftY: string;
};

type BlobSpec = {
  orbitX: number;
  orbitY: number;
  size: number;
  speed: number;
  phase: number;
  alpha: number;
  pull: number;
  color: [number, number, number];
};

const STARS: StarSpec[] = [
  { left: '5%', top: '9%', size: 2.2, opacity: 0.78, duration: '15s', twinkle: '3.6s', delay: '-1.1s', driftX: '18px', driftY: '-14px' },
  { left: '11%', top: '26%', size: 1.8, opacity: 0.58, duration: '19s', twinkle: '4.4s', delay: '-2.7s', driftX: '-10px', driftY: '16px' },
  { left: '16%', top: '63%', size: 2.6, opacity: 0.7, duration: '17s', twinkle: '3.9s', delay: '-3.4s', driftX: '12px', driftY: '-12px' },
  { left: '22%', top: '18%', size: 1.5, opacity: 0.5, duration: '21s', twinkle: '5.2s', delay: '-0.8s', driftX: '20px', driftY: '10px' },
  { left: '28%', top: '79%', size: 2.1, opacity: 0.74, duration: '14s', twinkle: '3.2s', delay: '-4.8s', driftX: '-14px', driftY: '-18px' },
  { left: '34%', top: '41%', size: 1.7, opacity: 0.56, duration: '22s', twinkle: '4.9s', delay: '-2.1s', driftX: '14px', driftY: '12px' },
  { left: '42%', top: '13%', size: 2.8, opacity: 0.82, duration: '16s', twinkle: '3.8s', delay: '-5.2s', driftX: '-16px', driftY: '14px' },
  { left: '47%', top: '57%', size: 1.4, opacity: 0.46, duration: '18s', twinkle: '5.6s', delay: '-1.6s', driftX: '12px', driftY: '-10px' },
  { left: '53%', top: '31%', size: 1.9, opacity: 0.62, duration: '20s', twinkle: '4.1s', delay: '-3.9s', driftX: '-18px', driftY: '12px' },
  { left: '59%', top: '74%', size: 2.5, opacity: 0.76, duration: '15s', twinkle: '3.4s', delay: '-0.4s', driftX: '16px', driftY: '-14px' },
  { left: '65%', top: '20%', size: 1.6, opacity: 0.55, duration: '23s', twinkle: '5.1s', delay: '-2.9s', driftX: '-12px', driftY: '15px' },
  { left: '71%', top: '47%', size: 2.4, opacity: 0.68, duration: '17s', twinkle: '4s', delay: '-4.5s', driftX: '18px', driftY: '10px' },
  { left: '78%', top: '12%', size: 1.7, opacity: 0.52, duration: '20s', twinkle: '4.7s', delay: '-1.3s', driftX: '-10px', driftY: '-12px' },
  { left: '83%', top: '66%', size: 2.7, opacity: 0.8, duration: '16s', twinkle: '3.3s', delay: '-5.8s', driftX: '14px', driftY: '-16px' },
  { left: '89%', top: '29%', size: 1.5, opacity: 0.48, duration: '22s', twinkle: '5.4s', delay: '-2.2s', driftX: '-15px', driftY: '13px' },
  { left: '93%', top: '81%', size: 2.1, opacity: 0.7, duration: '18s', twinkle: '4.2s', delay: '-3.1s', driftX: '10px', driftY: '-10px' },
  { left: '37%', top: '88%', size: 1.6, opacity: 0.54, duration: '19s', twinkle: '4.9s', delay: '-4.1s', driftX: '-12px', driftY: '11px' },
  { left: '74%', top: '87%', size: 1.8, opacity: 0.6, duration: '21s', twinkle: '5s', delay: '-0.9s', driftX: '17px', driftY: '-9px' },
];

const DESKTOP_BLOBS: BlobSpec[] = [
  { orbitX: 0.18, orbitY: 0.16, size: 0.3, speed: 0.12, phase: 0.2, alpha: 0.2, pull: 0.22, color: [82, 39, 255] },
  { orbitX: 0.26, orbitY: 0.2, size: 0.36, speed: -0.1, phase: 1.3, alpha: 0.16, pull: 0.14, color: [255, 159, 252] },
  { orbitX: 0.12, orbitY: 0.28, size: 0.33, speed: 0.08, phase: 2.8, alpha: 0.14, pull: 0.16, color: [177, 158, 239] },
  { orbitX: 0.22, orbitY: 0.09, size: 0.24, speed: 0.14, phase: 4.4, alpha: 0.11, pull: 0.25, color: [83, 110, 255] },
  { orbitX: 0.28, orbitY: 0.24, size: 0.28, speed: -0.07, phase: 5.7, alpha: 0.11, pull: 0.18, color: [140, 96, 255] },
];

const MOBILE_BLOBS: BlobSpec[] = [
  { orbitX: 0.14, orbitY: 0.14, size: 0.34, speed: 0.1, phase: 0.6, alpha: 0.18, pull: 0.18, color: [82, 39, 255] },
  { orbitX: 0.2, orbitY: 0.16, size: 0.4, speed: -0.08, phase: 2.1, alpha: 0.14, pull: 0.12, color: [255, 159, 252] },
  { orbitX: 0.1, orbitY: 0.22, size: 0.32, speed: 0.07, phase: 4.7, alpha: 0.12, pull: 0.16, color: [177, 158, 239] },
];

const lerp = (from: number, to: number, alpha: number) => from + (to - from) * alpha;

export const GlobalStarfield: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext('2d', { alpha: true });
    if (!context) {
      return;
    }

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let prefersReducedMotion = motionQuery.matches;
    let animationFrame = 0;
    let width = 0;
    let height = 0;
    let lastTime = 0;
    let blobSet = DESKTOP_BLOBS;
    const pointer = {
      currentX: 0.64,
      currentY: 0.34,
      targetX: 0.64,
      targetY: 0.34,
      active: false,
    };

    const updateMotionPreference = (event: MediaQueryListEvent) => {
      prefersReducedMotion = event.matches;
    };

    const resizeCanvas = () => {
      const nextWidth = Math.max(window.innerWidth, 1);
      const nextHeight = Math.max(window.innerHeight, 1);
      const devicePixelRatio = Math.min(window.devicePixelRatio || 1, nextWidth < 768 ? 1.15 : 1.5);

      width = nextWidth;
      height = nextHeight;
      blobSet = nextWidth < 768 ? MOBILE_BLOBS : DESKTOP_BLOBS;
      canvas.width = Math.round(nextWidth * devicePixelRatio);
      canvas.height = Math.round(nextHeight * devicePixelRatio);
      canvas.style.width = `${nextWidth}px`;
      canvas.style.height = `${nextHeight}px`;
      context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    };

    const handlePointerMove = (event: PointerEvent) => {
      pointer.targetX = Math.min(Math.max(event.clientX / Math.max(window.innerWidth, 1), 0), 1);
      pointer.targetY = Math.min(Math.max(event.clientY / Math.max(window.innerHeight, 1), 0), 1);
      pointer.active = true;
    };

    const handlePointerLeave = () => {
      pointer.active = false;
      pointer.targetX = 0.64;
      pointer.targetY = 0.34;
    };

    const draw = (timestamp: number) => {
      if (!width || !height) {
        resizeCanvas();
      }

      const delta = lastTime ? Math.min((timestamp - lastTime) / 1000, 0.033) : 0.016;
      lastTime = timestamp;

      const pointerEase = pointer.active && !prefersReducedMotion ? 0.075 : 0.025;
      pointer.currentX = lerp(pointer.currentX, pointer.targetX, pointerEase);
      pointer.currentY = lerp(pointer.currentY, pointer.targetY, pointerEase);

      context.clearRect(0, 0, width, height);

      const backgroundGradient = context.createLinearGradient(0, 0, width, height);
      backgroundGradient.addColorStop(0, 'rgba(12, 10, 24, 0.28)');
      backgroundGradient.addColorStop(0.45, 'rgba(7, 8, 16, 0.12)');
      backgroundGradient.addColorStop(1, 'rgba(15, 10, 32, 0.3)');
      context.fillStyle = backgroundGradient;
      context.fillRect(0, 0, width, height);

      const focusX = width * pointer.currentX;
      const focusY = height * pointer.currentY;
      const minSide = Math.min(width, height);

      context.save();
      context.globalCompositeOperation = 'screen';
      context.filter = `blur(${width < 768 ? 42 : 58}px) saturate(125%)`;

      blobSet.forEach((blob, index) => {
        const speedMultiplier = prefersReducedMotion ? 0.18 : 1;
        const motion = timestamp * 0.001 * blob.speed * speedMultiplier;
        const phase = blob.phase + motion;
        const orbitX = width * blob.orbitX;
        const orbitY = height * blob.orbitY;
        const pulse = 1 + Math.sin(timestamp * 0.00055 + index) * 0.08;
        const wobbleX = Math.sin(timestamp * 0.00037 + blob.phase * 2.3) * width * 0.028;
        const wobbleY = Math.cos(timestamp * 0.00031 + blob.phase * 1.8) * height * 0.022;
        const centerX = width * 0.5 + Math.cos(phase) * orbitX + wobbleX + (focusX - width * 0.5) * blob.pull;
        const centerY = height * 0.48 + Math.sin(phase * 1.15) * orbitY + wobbleY + (focusY - height * 0.45) * blob.pull;
        const radius = minSide * blob.size * pulse;
        const [r, g, b] = blob.color;
        const gradient = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);

        gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${blob.alpha})`);
        gradient.addColorStop(0.42, `rgba(${r}, ${g}, ${b}, ${blob.alpha * 0.62})`);
        gradient.addColorStop(0.78, `rgba(${r}, ${g}, ${b}, ${blob.alpha * 0.18})`);
        gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

        context.fillStyle = gradient;
        context.beginPath();
        context.arc(centerX, centerY, radius, 0, Math.PI * 2);
        context.fill();
      });

      context.restore();

      const highlight = context.createLinearGradient(width * 0.1, height * 0.2, width * 0.82, height * 0.88);
      highlight.addColorStop(0, 'rgba(255, 255, 255, 0.02)');
      highlight.addColorStop(0.4, 'rgba(255, 255, 255, 0)');
      highlight.addColorStop(1, 'rgba(180, 155, 255, 0.05)');
      context.fillStyle = highlight;
      context.fillRect(0, 0, width, height);

      animationFrame = window.requestAnimationFrame(draw);
    };

    resizeCanvas();
    animationFrame = window.requestAnimationFrame(draw);
    motionQuery.addEventListener('change', updateMotionPreference);
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerdown', handlePointerMove, { passive: true });
    window.addEventListener('pointerleave', handlePointerLeave);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      motionQuery.removeEventListener('change', updateMotionPreference);
      window.removeEventListener('resize', resizeCanvas);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerdown', handlePointerMove);
      window.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, []);

  return (
    <div className="global-starfield" aria-hidden="true">
      <canvas ref={canvasRef} className="global-starfield-canvas" />
      <div className="global-starfield-vignette" />
      <div className="global-starfield-noise" />

      {STARS.map((star, index) => (
        <span
          key={`${star.left}-${star.top}-${index}`}
          className="global-star"
          style={
            {
              '--star-left': star.left,
              '--star-top': star.top,
              '--star-size': star.size,
              '--star-opacity': star.opacity,
              '--star-duration': star.duration,
              '--star-twinkle': star.twinkle,
              '--star-delay': star.delay,
              '--star-drift-x': star.driftX,
              '--star-drift-y': star.driftY,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
};
