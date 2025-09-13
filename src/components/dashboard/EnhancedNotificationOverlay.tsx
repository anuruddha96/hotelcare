import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bell, X, ExternalLink } from 'lucide-react';
import { useNotifications } from '@/hooks/useNotifications';

interface NotificationData {
  title: string;
  message: string;
  type: 'success' | 'info' | 'warning';
}

export function EnhancedNotificationOverlay() {
  const [notifications, setNotifications] = useState<NotificationData[]>([]);
  const [showPermissionBanner, setShowPermissionBanner] = useState(false);
  const { requestNotificationPermission, notificationPermission } = useNotifications();

  useEffect(() => {
    // Check if we should show permission banner
    if (notificationPermission === 'default') {
      setShowPermissionBanner(true);
    }

    // Listen for visual notifications
    const handleVisualNotification = (event: CustomEvent<NotificationData>) => {
      const notification = event.detail;
      setNotifications(prev => [...prev, notification]);
      
      // Auto-remove after 8 seconds
      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n !== notification));
      }, 8000);
    };

    window.addEventListener('visual-notification', handleVisualNotification as EventListener);
    
    return () => {
      window.removeEventListener('visual-notification', handleVisualNotification as EventListener);
    };
  }, [notificationPermission]);

  const handleRequestPermission = async () => {
    const granted = await requestNotificationPermission();
    if (granted) {
      setShowPermissionBanner(false);
    }
  };

  const removeNotification = (notification: NotificationData) => {
    setNotifications(prev => prev.filter(n => n !== notification));
  };

  const getNotificationColor = (type: string) => {
    switch (type) {
      case 'success': return 'border-green-200 bg-green-50';
      case 'warning': return 'border-orange-200 bg-orange-50';
      default: return 'border-blue-200 bg-blue-50';
    }
  };

  const getTextColor = (type: string) => {
    switch (type) {
      case 'success': return 'text-green-800';
      case 'warning': return 'text-orange-800';
      default: return 'text-blue-800';
    }
  };

  return (
    <>
      {/* Permission Banner */}
      {showPermissionBanner && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 max-w-md w-full mx-4">
          <Card className="border-yellow-200 bg-yellow-50 p-4 shadow-lg">
            <div className="flex items-start gap-3">
              <Bell className="h-5 w-5 text-yellow-600 mt-0.5" />
              <div className="flex-1">
                <h4 className="font-medium text-yellow-800 mb-1">Enable Notifications</h4>
                <p className="text-sm text-yellow-700 mb-3">
                  Get real-time updates about room assignments, approvals, and break requests even when the app is not active.
                </p>
                <div className="flex gap-2">
                  <Button 
                    onClick={handleRequestPermission}
                    size="sm"
                    className="bg-yellow-600 hover:bg-yellow-700 text-white"
                  >
                    Enable Notifications
                  </Button>
                  <Button 
                    onClick={() => setShowPermissionBanner(false)}
                    variant="outline"
                    size="sm"
                  >
                    Maybe Later
                  </Button>
                </div>
              </div>
              <Button
                onClick={() => setShowPermissionBanner(false)}
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Notification Stack */}
      <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm">
        {notifications.map((notification, index) => (
          <Card 
            key={index}
            className={`p-4 shadow-lg transition-all duration-500 ease-in-out transform ${getNotificationColor(notification.type)}`}
            style={{
              animation: 'slideInRight 0.3s ease-out'
            }}
          >
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className={`font-medium ${getTextColor(notification.type)}`}>
                    {notification.title}
                  </h4>
                  <Badge 
                    variant="outline" 
                    className={notification.type === 'warning' ? 'border-orange-400' : 
                              notification.type === 'success' ? 'border-green-400' : 'border-blue-400'}
                  >
                    {notification.type}
                  </Badge>
                </div>
                <p className={`text-sm ${getTextColor(notification.type)} mb-2`}>
                  {notification.message}
                </p>
                <Button
                  onClick={() => window.focus()}
                  size="sm"
                  variant="outline"
                  className="text-xs h-6"
                >
                  <ExternalLink className="h-3 w-3 mr-1" />
                  Open App
                </Button>
              </div>
              <Button
                onClick={() => removeNotification(notification)}
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <style>{`
        @keyframes slideInRight {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </>
  );
}