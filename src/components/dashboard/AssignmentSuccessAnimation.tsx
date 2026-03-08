import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, Sparkles } from 'lucide-react';

interface AssignmentSuccessAnimationProps {
  show: boolean;
  roomCount: number;
  staffCount: number;
  onComplete: () => void;
}

export function AssignmentSuccessAnimation({ show, roomCount, staffCount, onComplete }: AssignmentSuccessAnimationProps) {
  useEffect(() => {
    if (show) {
      const timer = setTimeout(onComplete, 2500);
      return () => clearTimeout(timer);
    }
  }, [show, onComplete]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Success card */}
          <motion.div
            className="relative bg-card border-2 border-green-500/50 rounded-2xl p-8 shadow-2xl text-center max-w-sm mx-4"
            initial={{ scale: 0.5, y: 40, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.9, y: -20, opacity: 0 }}
            transition={{ type: 'spring', damping: 15, stiffness: 300 }}
          >
            {/* Animated check icon */}
            <motion.div
              className="mx-auto mb-4 w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center"
              initial={{ scale: 0 }}
              animate={{ scale: [0, 1.2, 1] }}
              transition={{ delay: 0.2, duration: 0.5 }}
            >
              <CheckCircle className="h-10 w-10 text-green-600 dark:text-green-400" />
            </motion.div>

            {/* Title */}
            <motion.h3
              className="text-xl font-bold text-foreground mb-2"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
            >
              Rooms Assigned! ✨
            </motion.h3>

            {/* Stats */}
            <motion.div
              className="flex items-center justify-center gap-4 text-sm text-muted-foreground"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
            >
              {roomCount > 0 && (
                <span className="font-semibold text-green-700 dark:text-green-400">
                  {roomCount} rooms
                </span>
              )}
              {staffCount > 0 && (
                <>
                  <span>→</span>
                  <span className="font-semibold text-blue-700 dark:text-blue-400">
                    {staffCount} staff
                  </span>
                </>
              )}
            </motion.div>

            {/* Sparkle particles */}
            {[...Array(6)].map((_, i) => (
              <motion.div
                key={i}
                className="absolute"
                style={{
                  top: `${20 + Math.random() * 60}%`,
                  left: `${10 + Math.random() * 80}%`,
                }}
                initial={{ opacity: 0, scale: 0 }}
                animate={{
                  opacity: [0, 1, 0],
                  scale: [0, 1, 0],
                  y: [0, -20 - Math.random() * 30],
                }}
                transition={{
                  delay: 0.3 + i * 0.1,
                  duration: 1.2,
                  ease: 'easeOut',
                }}
              >
                <Sparkles className="h-4 w-4 text-yellow-500" />
              </motion.div>
            ))}

            {/* Auto-refreshing indicator */}
            <motion.p
              className="text-xs text-muted-foreground mt-3"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7 }}
            >
              Refreshing all views...
            </motion.p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
