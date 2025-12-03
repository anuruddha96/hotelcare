import { motion, AnimatePresence } from 'framer-motion';

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface TrainingSpotlightProps {
  targetRect: TargetRect | null;
}

export function TrainingSpotlight({ targetRect }: TrainingSpotlightProps) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0"
        style={{
          background: 'rgba(0, 0, 0, 0.75)',
          maskImage: targetRect
            ? `radial-gradient(
                ellipse ${targetRect.width * 0.7}px ${targetRect.height * 0.7}px at ${targetRect.left + targetRect.width / 2}px ${targetRect.top + targetRect.height / 2}px,
                transparent 60%,
                black 100%
              )`
            : undefined,
          WebkitMaskImage: targetRect
            ? `radial-gradient(
                ellipse ${targetRect.width * 0.7}px ${targetRect.height * 0.7}px at ${targetRect.left + targetRect.width / 2}px ${targetRect.top + targetRect.height / 2}px,
                transparent 60%,
                black 100%
              )`
            : undefined,
        }}
      />

      {/* Animated highlight ring around target */}
      {targetRect && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ 
            opacity: [0.5, 1, 0.5],
            scale: [1, 1.02, 1],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
          className="absolute rounded-lg border-2 border-primary shadow-lg"
          style={{
            top: targetRect.top,
            left: targetRect.left,
            width: targetRect.width,
            height: targetRect.height,
            boxShadow: '0 0 20px hsl(var(--primary) / 0.5), 0 0 40px hsl(var(--primary) / 0.3)',
          }}
        />
      )}
    </AnimatePresence>
  );
}
