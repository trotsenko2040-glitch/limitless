import React from 'react';

const STARS = [
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

export const GlobalStarfield: React.FC = () => {
  return (
    <div className="global-starfield" aria-hidden="true">
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
