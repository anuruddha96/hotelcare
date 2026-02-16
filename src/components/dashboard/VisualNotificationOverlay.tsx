import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Bell, X, AlertTriangle, CheckCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VisualNotification {
  id: string;
  title: string;
  message: string;
  type: 'success' | 'info' | 'warning';
  timestamp: Date;
}

interface VisualNotificationOverlayProps {
  notifications: VisualNotification[];
  onDismiss: (id: string) => void;
}

export function VisualNotificationOverlay({ notifications, onDismiss }: VisualNotificationOverlayProps) {
  const [animatingNotifications, setAnimatingNotifications] = useState<Set<string>>(new Set());

  const getIcon = (type: 'success' | 'info' | 'warning') => {
    switch (type) {
      case 'success':
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-orange-600" />;
      case 'info':
      default:
        return <Info className="h-5 w-5 text-blue-600" />;
    }
  };

  const getColors = (type: 'success' | 'info' | 'warning') => {
    switch (type) {
      case 'success':
        return 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';
      case 'warning':
        return 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800';
      case 'info':
      default:
        return 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800';
    }
  };

  const handleDismiss = (id: string) => {
    setAnimatingNotifications(prev => new Set(prev).add(id));
    setTimeout(() => {
      onDismiss(id);
      setAnimatingNotifications(prev => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
    }, 300);
  };

  if (notifications.length === 0) {
    return null;
  }

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm">
      {notifications.map((notification) => (
        <Card
          key={notification.id}
          className={cn(
            "shadow-lg transition-all duration-300 animate-in slide-in-from-right-full",
            getColors(notification.type),
            animatingNotifications.has(notification.id) && "animate-out slide-out-to-right-full"
          )}
        >
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-0.5">
                {getIcon(notification.type)}
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Bell className="h-4 w-4 animate-pulse" />
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {notification.title}
                  </h4>
                </div>
                <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                  {notification.message}
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {notification.timestamp.toLocaleTimeString()}
                </p>
              </div>
              
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleDismiss(notification.id)}
                className="h-6 w-6 p-0 hover:bg-gray-200 dark:hover:bg-gray-700"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// Hook for managing visual notifications
export function useVisualNotifications() {
  const [notifications, setNotifications] = useState<VisualNotification[]>([]);

  const addNotification = (title: string, message: string, type: 'success' | 'info' | 'warning' = 'info') => {
    const id = `notification-${Date.now()}-${Math.random()}`;
    const newNotification: VisualNotification = {
      id,
      title,
      message,
      type,
      timestamp: new Date()
    };

    setNotifications(prev => [...prev, newNotification]);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);

    return id;
  };

  const removeNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  return {
    notifications,
    addNotification,
    removeNotification
  };
}